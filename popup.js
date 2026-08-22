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

let activeTab = null;
let ready = false;

initialize();

async function initialize() {
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

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
