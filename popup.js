const AI_SETTINGS_KEY = "questionQueueAiSettings";
const supportedHosts = new Set([
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "chat.deepseek.com",
  "grok.com",
  "poe.com",
  "copilot.microsoft.com",
  "www.doubao.com",
  "yuanbao.tencent.com"
]);

const title = document.querySelector("#statusTitle");
const text = document.querySelector("#statusText");
const button = document.querySelector("#mainButton");
const baseUrlInput = document.querySelector("#baseUrl");
const apiKeyInput = document.querySelector("#apiKey");
const settingsSave = document.querySelector("#settingsSave");
const settingsState = document.querySelector("#settingsState");

let activeTab = null;
let ready = false;
let savedSettings = {};

initialize();

async function initialize() {
  await loadSettings();
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const hostname = getHostname(activeTab?.url);

  if (!supportedHosts.has(hostname)) {
    title.textContent = "当前页面不支持";
    text.textContent = "请先打开一个受支持的大模型网页。";
    button.textContent = "此页面无法打开侧边栏";
    button.disabled = true;
    button.style.opacity = ".55";
    button.style.cursor = "default";
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { type: "QQ_PING" });
    ready = Boolean(response?.ready);
  } catch {
    ready = false;
  }

  if (ready) {
    title.textContent = "可以使用";
    text.textContent = `已在 ${hostname} 中启用。`;
    button.textContent = "打开侧边栏";
  } else {
    title.textContent = "需要刷新页面";
    text.textContent = "这是安装或更新扩展后的正常步骤。";
    button.textContent = "刷新当前页面并启用";
  }
}

button.addEventListener("click", async () => {
  if (!activeTab?.id) return;
  if (!ready) {
    await chrome.tabs.reload(activeTab.id);
    window.close();
    return;
  }
  await chrome.tabs.sendMessage(activeTab.id, { type: "QQ_TOGGLE" });
  window.close();
});

settingsSave.addEventListener("click", saveSettings);

async function loadSettings() {
  const stored = await chrome.storage.local.get(AI_SETTINGS_KEY);
  savedSettings = stored[AI_SETTINGS_KEY] || {};
  baseUrlInput.value = savedSettings.baseUrl || "";
  apiKeyInput.value = "";
  apiKeyInput.placeholder = savedSettings.apiKey ? "已保存；留空则不修改" : "请输入新生成的 API Key";
  settingsState.textContent = savedSettings.apiKey && savedSettings.baseUrl ? "已配置 qwen3.8-max" : "尚未配置";
}

async function saveSettings() {
  const baseUrl = baseUrlInput.value.trim().replace(/\/+$/, "");
  const apiKey = apiKeyInput.value.trim() || savedSettings.apiKey || "";
  if (!isAllowedBaseUrl(baseUrl)) {
    settingsState.textContent = "请填写阿里云百炼控制台提供的官方 Base URL";
    return;
  }
  if (!apiKey) {
    settingsState.textContent = "请填写重新生成的 API Key";
    return;
  }
  savedSettings = { baseUrl, apiKey, model: "qwen3.8-max", updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [AI_SETTINGS_KEY]: savedSettings });
  apiKeyInput.value = "";
  apiKeyInput.placeholder = "已保存；留空则不修改";
  settingsState.textContent = "设置已保存";
}

function isAllowedBaseUrl(value) {
  if (!value || value.includes("{WorkspaceId}") || value.includes("YOUR-WORKSPACE-ID")) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname.endsWith(".maas.aliyuncs.com") || url.hostname === "dashscope.aliyuncs.com");
  } catch {
    return false;
  }
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
