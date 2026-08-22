const STORAGE_KEY = "questionQueueItems";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "qq-capture-selection",
    title: "记录为追问：%s",
    contexts: ["selection"]
  });
  updateBadge();
});

chrome.runtime.onStartup.addListener(updateBadge);

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) sendToTab(tab.id, { type: "QQ_TOGGLE" });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-question-queue") return;
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id) sendToTab(tab.id, { type: "QQ_TOGGLE" });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "qq-capture-selection" || !tab?.id) return;
  sendToTab(tab.id, {
    type: "QQ_CAPTURE",
    selection: info.selectionText || ""
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) updateBadge();
});

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // The current page is outside the supported model sites.
  });
}

async function updateBadge() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const items = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  const count = items.filter((item) => item.status === "pending").length;
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#6D5EF7" });
}

const AI_SETTINGS_KEY = "questionQueueAiSettings";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "QQ_ANALYZE_MINDMAP") return;
  analyzeMindMap(message.items || [])
    .then((mindMap) => sendResponse({ ok: true, mindMap }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "智能分析失败" }));
  return true;
});

async function analyzeMindMap(inputItems) {
  if (!Array.isArray(inputItems) || !inputItems.length) throw new Error("还没有可分析的问题");
  const stored = await chrome.storage.local.get(AI_SETTINGS_KEY);
  const settings = stored[AI_SETTINGS_KEY] || {};
  const apiKey = String(settings.apiKey || "").trim();
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (!apiKey || !baseUrl) throw new Error("请先点击扩展图标，配置新的千问 API Key 和 Base URL");

  const safeItems = inputItems.slice(0, 300).map((item) => ({
    id: String(item.id || ""),
    question: String(item.question || "").slice(0, 4000),
    status: String(item.status || "pending")
  }));
  const prompt = [
    "请分析这些用户在使用大语言模型过程中积累的问题，并构建适合复习的思维导图。",
    "将相近问题归入主题，提炼主题洞见，保留问题原意，不要编造用户没有提出的事实。",
    "只返回合法 JSON，不要使用 Markdown 代码块。结构必须为：",
    JSON.stringify({
      title: "总标题",
      summary: "整体回顾摘要",
      branches: [{
        title: "一级主题",
        insight: "该主题的核心理解",
        questions: [{ id: "原问题id", question: "原问题文本" }],
        children: [{ title: "子主题", insight: "子主题洞见", questions: [], children: [] }]
      }]
    }),
    "问题数据：",
    JSON.stringify(safeItems)
  ].join("\n\n");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "qwen3.8-max",
      messages: [
        { role: "system", content: "你是知识管理与学习复盘专家，擅长把问题整理成层级清晰的思维导图。" },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      enable_thinking: true,
      temperature: 0.2,
      max_tokens: 8000
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
    throw new Error(`千问请求失败：${detail}`);
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("千问没有返回可用内容");
  return parseMindMap(content);
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw || raw.includes("{WorkspaceId}") || raw.includes("YOUR-WORKSPACE-ID")) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("千问 Base URL 格式不正确");
  }
  const allowed = url.protocol === "https:" && (url.hostname.endsWith(".maas.aliyuncs.com") || url.hostname === "dashscope.aliyuncs.com");
  if (!allowed) throw new Error("为保护 API Key，Base URL 只允许阿里云百炼官方域名");
  return raw;
}

function parseMindMap(content) {
  const cleaned = String(content).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("千问返回内容不是有效的思维导图 JSON");
  const mindMap = JSON.parse(cleaned.slice(start, end + 1));
  if (!mindMap || !Array.isArray(mindMap.branches)) throw new Error("千问返回的思维导图结构不完整");
  return mindMap;
}
