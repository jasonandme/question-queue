(() => {
  if (window.__QUESTION_QUEUE_LOADED__) return;
  window.__QUESTION_QUEUE_LOADED__ = true;

  const STORAGE_KEY = "questionQueueItems";
  const Sites = globalThis.QuestionQueueSites;
  const Store = globalThis.QuestionQueueStore;

  // The answer watcher only needs coarse signals, so mutations are sampled
  // instead of inspected one by one, and it always stops on its own.
  const SAMPLE_INTERVAL_MS = 700;
  const SETTLE_DELAY_MS = 4500;
  const WATCH_TIMEOUT_MS = 10 * 60 * 1000;

  let answerWatch = null;

  const host = document.createElement("div");
  host.id = "question-queue-host";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>${styles()}</style>
    <button class="qq-fab" id="qqFab" title="打开追问簿（Alt+Shift+Q）" aria-label="打开追问簿">
      <span>?</span><b id="qqFabCount" class="qq-hidden"></b>
    </button>
    <div class="qq-toast" id="qqToast" role="status"></div>`;

  const els = {
    fab: shadow.querySelector("#qqFab"),
    fabCount: shadow.querySelector("#qqFabCount"),
    toast: shadow.querySelector("#qqToast")
  };

  els.fab.addEventListener("click", openSidePanel);
  refreshBadge();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) renderBadge(changes[STORAGE_KEY].newValue);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "QQ_PING") {
      sendResponse({ ready: true, site: Sites.getSiteName(location.hostname) });
      return;
    }
    if (message?.type === "QQ_GET_SOURCE_META") {
      sendResponse({ sourceMeta: currentSourceMeta() });
      return;
    }
    if (message?.type === "QQ_CAPTURE") {
      showToast("划词内容已保存，点击工具栏图标打开追问簿");
      return;
    }
    if (message?.type === "QQ_APPEND_QUESTIONS") {
      sendResponse(appendQuestions(message));
    }
  });

  function appendQuestions(message) {
    if (!Sites.isChatSite(location.hostname)) {
      return { ok: false, error: "知识学习网页仅用于记录；请切换到大模型对话页面后填入" };
    }
    const targetItems = Array.isArray(message.items) ? message.items : [];
    if (!targetItems.length) return { ok: false, error: "没有需要填入的问题" };
    const composer = findComposer();
    if (!composer) {
      return { ok: false, error: "未找到当前页面的输入框，请先点击输入框后重试" };
    }
    const text = Store.buildFillText(targetItems, message.prefix);
    if (!text) return { ok: false, error: "问题内容为空" };
    insertIntoComposer(composer, text);
    startAnswerWatch(targetItems.map((item) => item.id));
    composer.focus();
    return { ok: true };
  }

  async function openSidePanel() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "QQ_OPEN_SIDE_PANEL" });
      if (response?.ok) return;
    } catch {
      // The service worker may be restarting; the toast below explains the fallback.
    }
    showToast("请点击浏览器工具栏的追问簿图标打开侧边栏", true);
  }

  async function refreshBadge() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      renderBadge(stored[STORAGE_KEY]);
    } catch {
      renderBadge([]);
    }
  }

  function renderBadge(value) {
    const list = Array.isArray(value) ? value : [];
    const pending = list.filter((item) => item?.status === "pending").length;
    els.fabCount.textContent = pending ? String(pending) : "";
    els.fabCount.classList.toggle("qq-hidden", !pending);
  }

  function findComposer() {
    const selectors = [
      "#prompt-textarea",
      "textarea[data-id='root']",
      "textarea[placeholder*='Claude']",
      "textarea[placeholder*='Ask']",
      "textarea[placeholder*='输入']",
      "textarea[placeholder*='发送']",
      "textarea:not([disabled])",
      "[contenteditable='true'][role='textbox']",
      "div[contenteditable='true']",
      "[contenteditable='plaintext-only']"
    ];
    for (const selector of selectors) {
      const match = Array.from(document.querySelectorAll(selector)).find(isVisible);
      if (match) return match;
    }
    return null;
  }

  function insertIntoComposer(element, text) {
    const isFormField = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement;
    const existing = isFormField ? element.value : (element.innerText || element.textContent || "");
    const separator = existing ? (existing.endsWith("\n") ? "\n" : "\n\n") : "";
    const addition = `${separator}${text}`;
    if (isFormField) {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(element, `${existing}${addition}`);
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    } else {
      element.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand("insertText", false, addition)) {
        element.appendChild(document.createTextNode(addition));
      }
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: addition }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function answerWatchRoot() {
    const candidates = ["main", "[role='main']", "#__next", "#root"];
    for (const selector of candidates) {
      const node = document.querySelector(selector);
      if (node) return node;
    }
    return document.body;
  }

  function stopAnswerWatch() {
    if (!answerWatch) return;
    answerWatch.observer.disconnect();
    clearTimeout(answerWatch.settleTimer);
    clearTimeout(answerWatch.expiry);
    answerWatch = null;
  }

  function startAnswerWatch(ids) {
    stopAnswerWatch();
    const targetIds = ids.filter(Boolean);
    if (!targetIds.length) return;
    const baseline = countAssistantMessages();
    let lastSample = 0;
    const observer = new MutationObserver(() => {
      if (!answerWatch) return;
      const now = Date.now();
      if (now - lastSample < SAMPLE_INTERVAL_MS) return;
      lastSample = now;
      if (countAssistantMessages() <= baseline) return;
      clearTimeout(answerWatch.settleTimer);
      answerWatch.settleTimer = setTimeout(() => {
        const pending = answerWatch?.ids || [];
        stopAnswerWatch();
        markAnswered(pending);
      }, SETTLE_DELAY_MS);
    });
    answerWatch = {
      observer,
      ids: targetIds,
      settleTimer: null,
      expiry: setTimeout(stopAnswerWatch, WATCH_TIMEOUT_MS)
    };
    observer.observe(answerWatchRoot(), { childList: true, subtree: true });
  }

  // Statuses are re-read from storage right before writing so the side panel and
  // the content script never overwrite each other with a stale snapshot.
  async function markAnswered(ids) {
    if (!ids.length) return;
    const wanted = new Set(ids);
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const items = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
      const now = new Date().toISOString();
      const answerUrl = Store.safeHttpUrl(location.href);
      let changed = false;
      items.forEach((item) => {
        if (!wanted.has(item?.id) || item.status !== "inserted") return;
        item.status = "answered";
        item.answeredAt = now;
        item.updatedAt = now;
        if (answerUrl) item.answerUrl = answerUrl;
        changed = true;
      });
      if (changed) await chrome.storage.local.set({ [STORAGE_KEY]: items });
    } catch {
      // Quota or a closed context: the side panel can still mark answers manually.
    }
  }

  function countAssistantMessages() {
    const selectors = [
      "[data-message-author-role='assistant']",
      "[data-is-streaming]",
      "[data-testid*='assistant']",
      ".assistant-message",
      "message-content"
    ];
    const seen = new Set();
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => seen.add(node));
    });
    return seen.size;
  }

  function currentSourceMeta() {
    return Sites.deriveSourceMeta({ url: location.href, title: document.title, document });
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function showToast(message, error = false) {
    els.toast.textContent = message;
    els.toast.classList.toggle("is-error", error);
    els.toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 3200);
  }

  function styles() {
    return `
      :host { all: initial; }
      * { box-sizing: border-box; }
      button { font: inherit; cursor: pointer; }
      .qq-hidden { display: none !important; }
      .qq-fab {
        position: fixed; right: 20px; bottom: 96px; z-index: 2147483645;
        width: 48px; height: 48px; border: 0; border-radius: 16px;
        color: #fff; background: #6d5ef7; box-shadow: 0 10px 30px rgba(50,40,130,.28);
        font: 700 24px/1 system-ui, sans-serif; transition: transform .2s, box-shadow .2s;
      }
      .qq-fab:hover { transform: translateY(-2px); box-shadow: 0 14px 34px rgba(50,40,130,.34); }
      .qq-fab b {
        position: absolute; top: -6px; right: -6px; min-width: 20px; height: 20px; padding: 0 5px;
        border: 2px solid #fff; border-radius: 10px; background: #e05151;
        font: 700 11px/16px system-ui, sans-serif;
      }
      .qq-toast {
        position: fixed; right: 20px; bottom: 152px; z-index: 2147483646; max-width: 300px;
        padding: 9px 13px; border-radius: 9px; color: #fff; background: #393442;
        box-shadow: 0 8px 22px rgba(20,16,30,.2); opacity: 0; pointer-events: none;
        transform: translateY(8px); transition: .2s;
        font: 12px/1.5 Inter, "Microsoft YaHei", system-ui, sans-serif; text-align: left;
      }
      .qq-toast.is-visible { opacity: 1; transform: translateY(0); }
      .qq-toast.is-error { background: #a94949; }
      @media (prefers-reduced-motion: reduce) { .qq-fab, .qq-toast { transition: none; } }
    `;
  }

})();
