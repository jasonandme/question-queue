import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));

const iconSizes = [16, 32, 48, 128];
const requiredFiles = [
  "site-adapters.js", "question-store.js", "background.js", "content.js", "docx-export.js",
  "sidepanel.html", "sidepanel.css", "sidepanel.js",
  "vendor/jszip.min.js", "vendor/JSZIP-LICENSE.md",
  "scripts/test-site-adapters.mjs", "scripts/test-question-store.mjs", "scripts/make-icons.mjs",
  "README.md", "CHANGELOG.md", "LICENSE",
  ...iconSizes.map((size) => `icons/icon-${size}.png`)
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing required file: ${file}`);
}

if (manifest.manifest_version !== 3) throw new Error("manifest_version must be 3");
if (manifest.side_panel?.default_path !== "sidepanel.html") throw new Error("side panel entry is missing");
if (manifest.background?.service_worker !== "background.js") throw new Error("background service worker is missing");

for (const size of iconSizes) {
  const expected = `icons/icon-${size}.png`;
  if (manifest.icons?.[size] !== expected) throw new Error(`manifest.icons must map ${size} to ${expected}`);
  if (manifest.action?.default_icon?.[size] !== expected) {
    throw new Error(`action.default_icon must map ${size} to ${expected}`);
  }
}

const contentScripts = manifest.content_scripts || [];
const contentMatches = new Set(contentScripts.flatMap((script) => script.matches || []));
for (const pattern of ["https://*.csdn.net/*", "https://*.zhihu.com/*"]) {
  if (!contentMatches.has(pattern)) throw new Error(`Missing learning-site match: ${pattern}`);
  if (!(manifest.host_permissions || []).includes(pattern)) throw new Error(`Missing learning-site permission: ${pattern}`);
}

const expectedInjection = ["site-adapters.js", "question-store.js", "content.js"];
for (const script of contentScripts) {
  const files = script.js || [];
  if (files.join(",") !== expectedInjection.join(",")) {
    throw new Error(`content_scripts.js must be exactly ${expectedInjection.join(", ")}, got ${files.join(", ") || "(empty)"}`);
  }
  for (const file of files) {
    if (!fs.existsSync(path.join(root, file))) throw new Error(`content script does not exist: ${file}`);
  }
}

const allowedPermissions = new Set(["storage", "contextMenus", "activeTab", "sidePanel"]);
for (const permission of manifest.permissions || []) {
  if (!allowedPermissions.has(permission)) throw new Error(`Unexpected permission: ${permission}`);
}

// Every declared command must be reachable from the code that handles it.
const backgroundSource = read("background.js");
for (const command of Object.keys(manifest.commands || {})) {
  if (!backgroundSource.includes(`"${command}"`)) {
    throw new Error(`Command ${command} is declared in the manifest but never handled in background.js`);
  }
}

// The side panel must load the shared modules before its own script.
const panelHtml = read("sidepanel.html");
const panelOrder = ["site-adapters.js", "question-store.js", "sidepanel.js"]
  .map((file) => panelHtml.indexOf(`src="${file}"`));
if (panelOrder.some((index) => index < 0)) {
  throw new Error("sidepanel.html must load site-adapters.js, question-store.js and sidepanel.js");
}
if (panelOrder[0] > panelOrder[1] || panelOrder[1] > panelOrder[2]) {
  throw new Error("sidepanel.html must load question-store.js after site-adapters.js and before sidepanel.js");
}

// Every element id used by the side panel script must exist in the markup.
const panelScript = read("sidepanel.js");
const usedIds = new Set(Array.from(panelScript.matchAll(/\$\("#([A-Za-z][\w-]*)"\)/g), (match) => match[1]));
for (const id of usedIds) {
  if (!new RegExp(`id="${id}"`).test(panelHtml)) {
    throw new Error(`sidepanel.js queries #${id} but sidepanel.html does not define it`);
  }
}

// The released version, the changelog and the release tag must agree.
const changelog = read("CHANGELOG.md");
const latestChangelogVersion = changelog.match(/^##\s*\[([0-9]+\.[0-9]+\.[0-9]+)\]/m)?.[1];
if (!latestChangelogVersion) throw new Error("CHANGELOG.md has no versioned section");
if (latestChangelogVersion !== manifest.version) {
  throw new Error(`manifest version ${manifest.version} does not match latest CHANGELOG entry ${latestChangelogVersion}`);
}
const refName = process.env.GITHUB_REF_NAME || "";
if (/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(refName) && refName.slice(1) !== manifest.version) {
  throw new Error(`tag ${refName} does not match manifest version ${manifest.version}`);
}

// README must stay in sync with the adapters and shortcut that actually ship.
await import("../site-adapters.js");
const readme = read("README.md");
for (const rule of globalThis.QuestionQueueSites.SITE_RULES) {
  if (!readme.includes(rule.name)) throw new Error(`README.md does not document the supported site: ${rule.name}`);
}
const shortcut = Object.values(manifest.commands || {})[0]?.suggested_key?.default;
if (shortcut && !readme.includes(shortcut)) {
  throw new Error(`README.md does not document the shortcut ${shortcut}`);
}

const firstPartyFiles = [
  "site-adapters.js", "question-store.js", "background.js", "content.js", "docx-export.js", "sidepanel.js",
  "sidepanel.html", "sidepanel.css",
  "scripts/validate.mjs", "scripts/test-site-adapters.mjs", "scripts/test-question-store.mjs", "scripts/make-icons.mjs",
  "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "PRIVACY.md", "SECURITY.md", "CODE_OF_CONDUCT.md",
  "docs/ARCHITECTURE.md", "docs/DEVELOPMENT_NOTES.md"
];
const suspicious = [
  /sk-[A-Za-z0-9_.-]{16,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /C:\\Users\\/i,
  /\/Users\//
];

for (const file of firstPartyFiles) {
  const source = read(file);
  for (const pattern of suspicious) {
    if (pattern.test(source)) throw new Error(`Sensitive-looking content in ${file}: ${pattern}`);
  }
}

console.log(`Question Queue ${manifest.version}: validation passed`);
