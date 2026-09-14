importScripts("site-adapters.js", "question-store.js");

const STORAGE_KEY = "questionQueueItems";
const CAPTURE_KEY = "questionQueueCaptureDraft";
const AI_SETTINGS_KEY = "questionQueueAiSettings";
const MENU_ID = "qq-capture-selection";
const DEFAULT_MODEL = "qwen-max";

chrome.runtime.onInstalled.addListener(() => {
  installContextMenu();
  enableNativeSidePanel();
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  installContextMenu();
  enableNativeSidePanel();
  updateBadge();
});

// onInstalled also fires on update, so the menu is rebuilt instead of created blindly.
function installContextMenu() {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "保存到追问簿：%s",
      contexts: ["selection"]
    }, () => void chrome.runtime.lastError);
  });
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) openSidePanel(tab.id);
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "open-question-queue") return;
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id) openSidePanel(tab.id);
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  const source = await getTabSourceMeta(tab);
  const selectionMeta = await getSelectionMeta(tab.id, info.frameId);
  const selection = String(selectionMeta.selection || info.selectionText || "").trim();
  if (!selection) return;
  const now = new Date().toISOString();
  const title = String(selectionMeta.sectionTitle || source.sourceTitle || "未命名笔记").trim();
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const items = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  const note = QuestionQueueStore.sanitizeItem({
    id: crypto.randomUUID(), kind: "note", status: "note", title, content: selection,
    site: source.site, sourceType: source.sourceType, sourceTitle: source.sourceTitle,
    sourceUrl: source.sourceUrl, conversationId: source.sourceId,
    conversationTitle: source.sourceTitle, createdAt: now, updatedAt: now
  });
  const duplicate = QuestionQueueStore.findDuplicateNote(items, note);
  if (!duplicate) {
    items.push(note);
    await chrome.storage.local.set({ [STORAGE_KEY]: items });
  }
  await chrome.storage.local.set({
    [CAPTURE_KEY]: {
      selection,
      sectionTitle: title,
      noteId: duplicate?.id || note.id,
      autoSaved: true,
      wasDuplicate: Boolean(duplicate),
      ...source,
      capturedAt: now
    }
  });
  const opened = await openSidePanel(tab.id);
  if (!opened) sendToTab(tab.id, { type: "QQ_CAPTURE", selection: info.selectionText || "" });
});

async function getSelectionMeta(tabId, frameId = 0) {
  if (!chrome.scripting?.executeScript) return {};
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: () => {
        const selected = window.getSelection();
        const selection = String(selected || "").trim();
        const node = selected?.rangeCount ? selected.getRangeAt(0).commonAncestorContainer : null;
        const start = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        const headingSelector = "h1,h2,h3,h4,h5,h6,[role='heading'],.article-title,.section-title,.chapter-title";
        const clean = (element) => String(element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300);
        let heading = start?.closest?.(headingSelector) || null;
        if (!heading && start) {
          const scope = start.closest("article,main,section,[role='main']") || document.body;
          const candidates = Array.from(scope.querySelectorAll(headingSelector));
          heading = candidates.filter((candidate) => {
            if (!candidate.isConnected || !clean(candidate)) return false;
            const relation = candidate.compareDocumentPosition(start);
            return Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING) || candidate.contains(start);
          }).at(-1) || null;
        }
        return { selection, sectionTitle: clean(heading) };
      }
    });
    return result || {};
  } catch {
    return {};
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) updateBadge();
});

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // The current page is outside the supported sites.
  });
}

async function updateBadge() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const items = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  const count = items.filter((item) => item.status === "pending").length;
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#6D5EF7" });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "QQ_OPEN_SIDE_PANEL") {
    const tabId = sender.tab?.id || message.tabId;
    if (!tabId) {
      sendResponse({ ok: false });
      return;
    }
    openSidePanel(tabId).then((ok) => sendResponse({ ok }));
    return true;
  }
  if (message.type !== "QQ_ANALYZE_MINDMAP") return;
  analyzeMindMap(message.items || [])
    .then((mindMap) => sendResponse({ ok: true, mindMap }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "智能分析失败" }));
  return true;
});

async function enableNativeSidePanel() {
  if (!chrome.sidePanel?.setPanelBehavior) return false;
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    return true;
  } catch {
    return false;
  }
}

async function openSidePanel(tabId) {
  if (!chrome.sidePanel?.open) return false;
  try {
    await chrome.sidePanel.open({ tabId });
    return true;
  } catch {
    return false;
  }
}

async function getTabSourceMeta(tab) {
  const fallback = QuestionQueueSites.deriveSourceMeta({ url: tab?.url || "", title: tab?.title || "" });
  if (!tab?.id) return fallback;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "QQ_GET_SOURCE_META" });
    return response?.sourceMeta ? { ...fallback, ...response.sourceMeta } : fallback;
  } catch {
    return fallback;
  }
}

async function analyzeMindMap(inputItems) {
  if (!Array.isArray(inputItems) || !inputItems.length) throw new Error("还没有可分析的问题");
  const stored = await chrome.storage.local.get(AI_SETTINGS_KEY);
  const settings = stored[AI_SETTINGS_KEY] || {};
  const apiKey = String(settings.apiKey || "").trim();
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const model = String(settings.model || "").trim() || DEFAULT_MODEL;
  if (!apiKey || !baseUrl) throw new Error("请在侧边栏“设置”中配置千问 Base URL 和 API Key");

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

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "你是知识管理与学习复盘专家，擅长把问题整理成层级清晰的思维导图。" },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 8000
      })
    });
  } catch {
    throw new Error("无法连接千问接口，请检查网络与 Base URL");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
    throw new Error(`千问请求失败（模型 ${model}）：${detail}`);
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
