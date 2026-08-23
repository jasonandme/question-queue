import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const requiredFiles = [
  "site-adapters.js", "background.js", "content.js", "docx-export.js", "sidepanel.html",
  "sidepanel.css", "sidepanel.js", "vendor/jszip.min.js", "vendor/JSZIP-LICENSE.md"
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing required file: ${file}`);
}

if (manifest.manifest_version !== 3) throw new Error("manifest_version must be 3");
if (manifest.side_panel?.default_path !== "sidepanel.html") throw new Error("side panel entry is missing");
if (manifest.background?.service_worker !== "background.js") throw new Error("background service worker is missing");

const contentMatches = new Set((manifest.content_scripts || []).flatMap((script) => script.matches || []));
for (const pattern of ["https://*.csdn.net/*", "https://*.zhihu.com/*"]) {
  if (!contentMatches.has(pattern)) throw new Error(`Missing learning-site match: ${pattern}`);
  if (!(manifest.host_permissions || []).includes(pattern)) throw new Error(`Missing learning-site permission: ${pattern}`);
}
if (!(manifest.content_scripts || []).some((script) => script.js?.[0] === "site-adapters.js")) {
  throw new Error("site-adapters.js must load before content.js");
}

const allowedPermissions = new Set(["storage", "contextMenus", "activeTab", "sidePanel"]);
for (const permission of manifest.permissions || []) {
  if (!allowedPermissions.has(permission)) throw new Error(`Unexpected permission: ${permission}`);
}

const firstPartyFiles = [
  "site-adapters.js", "background.js", "content.js", "docx-export.js", "sidepanel.js",
  "README.md",
  "PRIVACY.md", "SECURITY.md", "CONTRIBUTING.md"
];
const suspicious = [
  /sk-[A-Za-z0-9_.-]{16,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /C:\\Users\\/i,
  /\/Users\//
];

for (const file of firstPartyFiles) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  for (const pattern of suspicious) {
    if (pattern.test(source)) throw new Error(`Sensitive-looking content in ${file}: ${pattern}`);
  }
}

console.log(`Question Queue ${manifest.version}: validation passed`);

