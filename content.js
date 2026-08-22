(() => {
  if (window.__QUESTION_QUEUE_LOADED__) return;
  window.__QUESTION_QUEUE_LOADED__ = true;

  const STORAGE_KEY = "questionQueueItems";
  const MINDMAP_KEY = "questionQueueMindMap";
  const STATUS = {
    pending: { label: "待输入", color: "#7C5CFC" },
    inserted: { label: "已输入", color: "#168AAD" },
    answered: { label: "已回答", color: "#E58A26" },
    learned: { label: "已掌握", color: "#2E9D64" }
  };
  const SITE_NAMES = {
    "chatgpt.com": "ChatGPT",
    "chat.openai.com": "ChatGPT",
    "claude.ai": "Claude",
    "gemini.google.com": "Gemini",
    "chat.deepseek.com": "DeepSeek",
    "grok.com": "Grok",
    "poe.com": "Poe",
    "copilot.microsoft.com": "Copilot",
    "www.doubao.com": "豆包",
    "yuanbao.tencent.com": "腾讯元宝"
  };

  let items = [];
  let activeStatus = "pending";
  let selectedIds = new Set();
  let editingId = null;
  let answerWatch = null;
  let panelOpen = false;
  let mindMap = null;

  const host = document.createElement("div");
  host.id = "question-queue-host";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>${styles()}</style>
    <button class="qq-fab" id="qqFab" title="追问簿（Alt+Shift+Q）" aria-label="打开追问簿">
      <span>?</span><b id="qqFabCount"></b>
    </button>
    <div class="qq-backdrop" id="qqBackdrop"></div>
    <aside class="qq-panel" id="qqPanel" aria-label="追问簿">
      <header class="qq-header">
        <div><h2>追问簿</h2><p>想到就记，下一轮一键输入</p></div>
        <button class="qq-icon" id="qqClose" aria-label="关闭">×</button>
      </header>

      <section class="qq-compose">
        <textarea id="qqQuestion" rows="3" placeholder="记录当前回答引发的新疑问…"></textarea>
        <details id="qqDetails">
          <summary>补充上下文与学习笔记</summary>
          <label>相关上下文<textarea id="qqContext" rows="3" placeholder="选中回答文字并右键记录时，会自动放到这里"></textarea></label>
          <label>标签<input id="qqTags" type="text" placeholder="例如：工作, 学习方法, 待验证"></label>
          <label>学习笔记<textarea id="qqNotes" rows="2" placeholder="写下自己的理解、结论或仍不确定之处"></textarea></label>
        </details>
        <div class="qq-compose-actions">
          <button class="qq-ghost qq-hidden" id="qqCancelEdit">取消编辑</button>
          <button class="qq-primary" id="qqSave">保存疑问</button>
        </div>
      </section>

      <nav class="qq-tabs" id="qqTabs"></nav>
      <section class="qq-toolbar">
        <input id="qqSearch" type="search" placeholder="搜索疑问或笔记">
        <button class="qq-primary qq-fill" id="qqFillAll">一键填入待输入</button>
      </section>
      <section class="qq-bulkbar" id="qqBulkBar">
        <button class="qq-ghost" id="qqSelectAll">全选当前</button>
        <button class="qq-primary" id="qqFillSelected" disabled>填入所选</button>
      </section>
      <main class="qq-list" id="qqList"></main>
      <footer class="qq-footer">
        <span>数据仅保存在本机</span>
        <div>
          <button class="qq-link" id="qqMindMap">思维导图</button>
          <button class="qq-link" id="qqWord">Word</button>
          <button class="qq-link" id="qqImport">导入</button>
          <button class="qq-link" id="qqExport">导出</button>
          <input class="qq-hidden" id="qqImportFile" type="file" accept="application/json">
        </div>
      </footer>
      <section class="qq-map-modal" id="qqMapModal" aria-label="问题思维导图">
        <header class="qq-map-header">
          <div>
            <h3>问题思维导图</h3>
            <p>由 qwen3.8-max 按需分析，仅发送问题文本和状态</p>
          </div>
          <button class="qq-icon" id="qqMapClose" aria-label="关闭">×</button>
        </header>
        <div class="qq-map-controls">
          <span id="qqMapTime">尚未生成</span>
          <button class="qq-primary" id="qqAnalyze">生成思维导图</button>
        </div>
        <div class="qq-map-content" id="qqMapContent"></div>
      </section>
      <div class="qq-toast" id="qqToast"></div>
    </aside>`;

  const $ = (selector) => shadow.querySelector(selector);
  const els = {
    fab: $("#qqFab"), fabCount: $("#qqFabCount"), panel: $("#qqPanel"),
    backdrop: $("#qqBackdrop"), close: $("#qqClose"), question: $("#qqQuestion"),
    context: $("#qqContext"), tags: $("#qqTags"), notes: $("#qqNotes"), details: $("#qqDetails"),
    save: $("#qqSave"), cancelEdit: $("#qqCancelEdit"), tabs: $("#qqTabs"),
    search: $("#qqSearch"), fillAll: $("#qqFillAll"), bulkBar: $("#qqBulkBar"),
    selectAll: $("#qqSelectAll"), fillSelected: $("#qqFillSelected"), list: $("#qqList"),
    toast: $("#qqToast"), import: $("#qqImport"), export: $("#qqExport"),
    importFile: $("#qqImportFile"), mindMapButton: $("#qqMindMap"),
    wordButton: $("#qqWord"), mapModal: $("#qqMapModal"), mapClose: $("#qqMapClose"),
    mapContent: $("#qqMapContent"), mapTime: $("#qqMapTime"), analyze: $("#qqAnalyze")
  };

  bindEvents();
  loadItems();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "QQ_PING") {
      sendResponse({ ready: true, site: SITE_NAMES[location.hostname] || location.hostname });
      return;
    }
    if (message.type === "QQ_TOGGLE") openBestPanel();
    if (message.type === "QQ_CAPTURE") {
      openPanel();
      startNewCapture(message.selection || "");
    }
    if (message.type === "QQ_APPEND_QUESTIONS") {
      const targetItems = Array.isArray(message.items) ? message.items : [];
      const composer = findComposer();
      if (!composer) {
        sendResponse({ ok: false, error: "未找到当前页面的输入框，请先点击输入框后重试" });
        return;
      }
      const text = targetItems.length === 1
        ? String(targetItems[0].question || "")
        : `请依次回答以下问题，并保留编号：\n\n${targetItems.map((item, index) => `${index + 1}. ${item.question}`).join("\n\n")}`;
      insertIntoComposer(composer, text);
      startAnswerWatch(targetItems.map((item) => item.id));
      composer.focus();
      sendResponse({ ok: true });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEY]) {
      items = Array.isArray(changes[STORAGE_KEY].newValue) ? changes[STORAGE_KEY].newValue : [];
      render();
    }
    if (changes[MINDMAP_KEY]) {
      mindMap = changes[MINDMAP_KEY].newValue || null;
      renderMindMap();
    }
  });

  function bindEvents() {
    els.fab.addEventListener("click", openBestPanel);
    els.close.addEventListener("click", closePanel);
    els.backdrop.addEventListener("click", closePanel);
    els.save.addEventListener("click", saveEditor);
    els.cancelEdit.addEventListener("click", resetEditor);
    els.search.addEventListener("input", () => { renderList(); renderBulkActions(); });
    els.fillAll.addEventListener("click", fillAllPending);
    els.selectAll.addEventListener("click", toggleSelectAll);
    els.fillSelected.addEventListener("click", fillSelectedItems);
    els.export.addEventListener("click", exportItems);
    els.import.addEventListener("click", () => els.importFile.click());
    els.importFile.addEventListener("change", importItems);
    els.mindMapButton.addEventListener("click", openMindMap);
    els.wordButton.addEventListener("click", exportWord);
    els.mapClose.addEventListener("click", closeMindMap);
    els.analyze.addEventListener("click", analyzeQuestions);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && panelOpen) closePanel();
    });
  }

  async function loadItems() {
    const data = await chrome.storage.local.get([STORAGE_KEY, MINDMAP_KEY]);
    items = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
    mindMap = data[MINDMAP_KEY] || null;
    render();
  }

  async function persist() {
    await chrome.storage.local.set({ [STORAGE_KEY]: items });
    render();
  }

  function render() {
    const pendingCount = items.filter((item) => item.status === "pending").length;
    els.fabCount.textContent = pendingCount ? String(pendingCount) : "";
    els.fabCount.classList.toggle("qq-hidden", !pendingCount);
    renderTabs();
    renderList();
    renderBulkActions();
    els.fillAll.disabled = pendingCount === 0;
    els.fillAll.textContent = pendingCount ? `一键填入待输入（${pendingCount}）` : "暂无待输入";
  }

  function renderTabs() {
    els.tabs.replaceChildren();
    Object.entries(STATUS).forEach(([key, config]) => {
      const count = items.filter((item) => item.status === key).length;
      const button = document.createElement("button");
      button.className = `qq-tab ${activeStatus === key ? "is-active" : ""}`;
      button.style.setProperty("--status-color", config.color);
      button.textContent = `${config.label} ${count}`;
      button.addEventListener("click", () => {
        activeStatus = key;
        selectedIds.clear();
        render();
      });
      els.tabs.appendChild(button);
    });
  }

  function renderList() {
    const visible = getVisibleItems();

    els.list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "qq-empty";
      empty.innerHTML = `<span>${activeStatus === "pending" ? "✦" : "✓"}</span><p>${query ? "没有匹配内容" : `还没有“${STATUS[activeStatus].label}”的疑问`}</p>`;
      els.list.appendChild(empty);
      return;
    }
    visible.forEach((item) => els.list.appendChild(createCard(item)));
  }

  function createCard(item) {
    const card = document.createElement("article");
    card.className = "qq-card";
    card.style.setProperty("--status-color", STATUS[item.status].color);

    const meta = document.createElement("div");
    meta.className = "qq-card-meta";
    if (item.status === "pending" || item.status === "inserted") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "qq-select-box";
      checkbox.checked = selectedIds.has(item.id);
      checkbox.setAttribute("aria-label", `选择：${item.question}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedIds.add(item.id);
        else selectedIds.delete(item.id);
        renderBulkActions();
      });
      meta.appendChild(checkbox);
    }
    const source = document.createElement(item.sourceUrl ? "a" : "span");
    source.textContent = item.site || "其他模型";
    if (item.sourceUrl) {
      source.href = item.sourceUrl;
      source.target = "_blank";
      source.rel = "noreferrer";
    }
    const time = document.createElement("time");
    time.textContent = formatTime(item.updatedAt);
    meta.append(source, time);

    const question = document.createElement("p");
    question.className = "qq-card-question";
    question.textContent = item.question;
    card.append(meta, question);

    if (item.context) {
      const context = document.createElement("p");
      context.className = "qq-card-context";
      context.textContent = item.context;
      card.appendChild(context);
    }
    if (item.notes) {
      const notes = document.createElement("p");
      notes.className = "qq-card-notes";
      notes.textContent = `笔记：${item.notes}`;
      card.appendChild(notes);
    }
    const itemTags = normalizeTags(item.tags);
    if (itemTags.length) {
      const tags = document.createElement("p");
      tags.className = "qq-card-tags";
      tags.textContent = itemTags.map((tag) => `#${tag}`).join("  ");
      card.appendChild(tags);
    }

    const actions = document.createElement("div");
    actions.className = "qq-card-actions";
    if (item.status === "pending") actions.appendChild(actionButton("填入", () => fillItems([item])));
    if (item.status === "inserted") {
      actions.appendChild(actionButton("再次填入", () => fillItems([item])));
      actions.appendChild(actionButton("标为已回答", () => setStatus(item.id, "answered")));
    }
    if (item.status === "answered") actions.appendChild(actionButton("标为已掌握", () => setStatus(item.id, "learned"), "accent"));
    if (item.status === "learned") actions.appendChild(actionButton("重新追问", () => setStatus(item.id, "pending")));
    actions.appendChild(actionButton("编辑", () => editItem(item)));
    actions.appendChild(actionButton("删除", () => deleteItem(item.id), "danger"));
    card.appendChild(actions);
    return card;
  }

  function actionButton(label, handler, kind = "") {
    const button = document.createElement("button");
    button.className = `qq-small ${kind}`;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function saveEditor() {
    const question = els.question.value.trim();
    if (!question) return showToast("请先写下疑问");
    const now = new Date().toISOString();
    if (editingId) {
      const item = items.find((entry) => entry.id === editingId);
      if (item) Object.assign(item, {
        question,
        context: els.context.value.trim(),
        tags: parseTags(els.tags.value),
        notes: els.notes.value.trim(),
        updatedAt: now
      });
      showToast("已更新");
    } else {
      items.push({
        id: crypto.randomUUID(),
        question,
        context: els.context.value.trim(),
        tags: parseTags(els.tags.value),
        notes: els.notes.value.trim(),
        status: "pending",
        site: SITE_NAMES[location.hostname] || location.hostname,
        sourceTitle: document.title,
        sourceUrl: location.href,
        conversationId: conversationKey(location.href, document.title),
        conversationTitle: cleanConversationTitle(document.title),
        createdAt: now,
        updatedAt: now
      });
      activeStatus = "pending";
      showToast("已加入待输入清单");
    }
    resetEditor();
    persist();
  }

  function startNewCapture(selection = "") {
    resetEditor();
    els.context.value = selection.trim();
    els.details.open = Boolean(selection.trim());
    setTimeout(() => els.question.focus(), 50);
  }

  function editItem(item) {
    editingId = item.id;
    els.question.value = item.question || "";
    els.context.value = item.context || "";
    els.tags.value = normalizeTags(item.tags).join(", ");
    els.notes.value = item.notes || "";
    els.details.open = Boolean(item.context || item.notes);
    els.save.textContent = "保存修改";
    els.cancelEdit.classList.remove("qq-hidden");
    els.question.focus();
    els.panel.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetEditor() {
    editingId = null;
    els.question.value = "";
    els.context.value = "";
    els.tags.value = "";
    els.notes.value = "";
    els.details.open = false;
    els.save.textContent = "保存疑问";
    els.cancelEdit.classList.add("qq-hidden");
  }

  async function setStatus(id, status) {
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    item.status = status;
    item.updatedAt = new Date().toISOString();
    item[`${status}At`] = item.updatedAt;
    selectedIds.delete(id);
    await persist();
  }

  async function deleteItem(id) {
    const item = items.find((entry) => entry.id === id);
    if (!item || !confirm(`删除这条疑问？\n\n${item.question}`)) return;
    items = items.filter((entry) => entry.id !== id);
    selectedIds.delete(id);
    if (editingId === id) resetEditor();
    await persist();
    showToast("已删除");
  }

  function fillAllPending() {
    const pending = items
      .filter((item) => item.status === "pending")
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    fillItems(pending);
  }

  async function fillItems(targetItems) {
    if (!targetItems.length) return;
    const composer = findComposer();
    if (!composer) {
      showToast("未找到当前页面的输入框，请点击输入框后重试", true);
      return;
    }
    const text = targetItems.length === 1
      ? targetItems[0].question
      : `请依次回答以下问题，并保留编号：\n\n${targetItems.map((item, index) => `${index + 1}. ${item.question}`).join("\n\n")}`;
    insertIntoComposer(composer, text);

    const now = new Date().toISOString();
    targetItems.forEach((target) => {
      const item = items.find((entry) => entry.id === target.id);
      if (!item) return;
      item.status = "inserted";
      item.insertedAt = now;
      item.updatedAt = now;
    });
    targetItems.forEach((item) => selectedIds.delete(item.id));
    await persist();
    startAnswerWatch(targetItems.map((item) => item.id));
    showToast(`已追加 ${targetItems.length} 条疑问，请确认后发送`);
    closePanel();
    composer.focus();
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
    const candidates = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    return candidates.find((element) => isVisible(element)) || null;
  }

  function insertIntoComposer(element, text) {
    const existing = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement ? element.value : (element.innerText || element.textContent || "");
    const separator = existing ? (existing.endsWith("\n") ? "\n" : "\n\n") : "";
    const addition = `${separator}${text}`;
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(element, `${existing}${addition}`);
    } else {
      element.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      const inserted = document.execCommand("insertText", false, addition);
      if (!inserted) {
        element.appendChild(document.createTextNode(addition));
      }
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: addition }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function startAnswerWatch(ids) {
    if (answerWatch?.observer) answerWatch.observer.disconnect();
    const baseline = countAssistantMessages();
    let timer = null;
    const observer = new MutationObserver(() => {
      if (countAssistantMessages() <= baseline) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const now = new Date().toISOString();
        let changed = false;
        ids.forEach((id) => {
          const item = items.find((entry) => entry.id === id && entry.status === "inserted");
          if (!item) return;
          item.status = "answered";
          item.answeredAt = now;
          item.updatedAt = now;
          changed = true;
        });
        if (changed) await persist();
        observer.disconnect();
        answerWatch = null;
      }, 4500);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    answerWatch = { observer, ids };
  }

  function countAssistantMessages() {
    const selectors = [
      "[data-message-author-role='assistant']",
      "[data-is-streaming]",
      "[data-testid*='assistant']",
      ".assistant-message",
      "message-content"
    ];
    return new Set(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))).size;
  }

  function exportItems() {
    const payload = JSON.stringify({
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      mindMap,
      items
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `question-queue-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("已导出备份");
  }

  async function importItems(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(incoming)) throw new Error("Invalid data");
      const byId = new Map(items.map((item) => [item.id, item]));
      incoming.forEach((item) => {
        if (item?.id && item?.question && STATUS[item.status]) byId.set(item.id, item);
      });
      items = Array.from(byId.values());
      if (!Array.isArray(data) && data.mindMap?.branches) {
        mindMap = data.mindMap;
        await chrome.storage.local.set({ [MINDMAP_KEY]: mindMap });
      }
      await persist();
      showToast(`已导入，共 ${items.length} 条`);
    } catch {
      showToast("导入失败：文件格式不正确", true);
    }
  }

  function getVisibleItems() {
    const query = els.search.value.trim().toLocaleLowerCase();
    return items
      .filter((item) => item.status === activeStatus)
      .filter((item) => !query || [item.question, item.context, item.notes, item.site, item.conversationTitle, normalizeTags(item.tags).join(" ")]
        .some((value) => String(value || "").toLocaleLowerCase().includes(query)))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function renderBulkActions() {
    const canBulkFill = activeStatus === "pending" || activeStatus === "inserted";
    els.bulkBar.classList.toggle("qq-hidden", !canBulkFill);
    if (!canBulkFill) return;
    const visible = getVisibleItems();
    const selected = visible.filter((item) => selectedIds.has(item.id));
    els.selectAll.disabled = visible.length === 0;
    els.selectAll.textContent = visible.length && selected.length === visible.length ? "取消全选" : "全选当前";
    els.fillSelected.disabled = selected.length === 0;
    const verb = activeStatus === "inserted" ? "再次填入所选" : "填入所选";
    els.fillSelected.textContent = selected.length ? `${verb}（${selected.length}）` : verb;
  }

  function toggleSelectAll() {
    const visible = getVisibleItems();
    const allSelected = visible.length && visible.every((item) => selectedIds.has(item.id));
    visible.forEach((item) => {
      if (allSelected) selectedIds.delete(item.id);
      else selectedIds.add(item.id);
    });
    renderList();
    renderBulkActions();
  }

  function fillSelectedItems() {
    const selected = getVisibleItems().filter((item) => selectedIds.has(item.id));
    fillItems(selected);
  }

  function openMindMap() {
    els.mapModal.classList.add("is-open");
    renderMindMap();
  }

  function closeMindMap() {
    els.mapModal.classList.remove("is-open");
  }

  async function analyzeQuestions() {
    if (!items.length) return showToast("还没有可分析的问题", true);
    els.analyze.disabled = true;
    els.analyze.textContent = "千问分析中…";
    try {
      const safeItems = items.map((item) => ({ id: item.id, question: item.question, status: item.status }));
      const response = await chrome.runtime.sendMessage({ type: "QQ_ANALYZE_MINDMAP", items: safeItems });
      if (!response?.ok) throw new Error(response?.error || "智能分析失败");
      mindMap = {
        ...response.mindMap,
        generatedAt: new Date().toISOString(),
        sourceCount: items.length
      };
      await chrome.storage.local.set({ [MINDMAP_KEY]: mindMap });
      renderMindMap();
      showToast("思维导图已生成");
    } catch (error) {
      showToast(error.message || "智能分析失败", true);
    } finally {
      els.analyze.disabled = false;
      els.analyze.textContent = mindMap ? "重新分析" : "生成思维导图";
    }
  }

  function renderMindMap() {
    if (!els.mapContent) return;
    els.mapContent.replaceChildren();
    els.analyze.textContent = mindMap ? "重新分析" : "生成思维导图";
    els.mapTime.textContent = mindMap?.generatedAt
      ? `${formatTime(mindMap.generatedAt)} · ${mindMap.sourceCount || items.length} 个问题`
      : "尚未生成";
    if (!mindMap?.branches?.length) {
      const empty = document.createElement("div");
      empty.className = "qq-map-empty";
      empty.textContent = "点击“生成思维导图”，千问会把已有问题按主题整理。";
      els.mapContent.appendChild(empty);
      return;
    }
    const title = document.createElement("h3");
    title.className = "qq-map-title";
    title.textContent = mindMap.title || "问题知识结构";
    els.mapContent.appendChild(title);
    if (mindMap.summary) {
      const summary = document.createElement("p");
      summary.className = "qq-map-summary";
      summary.textContent = mindMap.summary;
      els.mapContent.appendChild(summary);
    }
    const tree = document.createElement("div");
    tree.className = "qq-map-tree";
    mindMap.branches.forEach((branch) => tree.appendChild(createMindBranch(branch, 0)));
    els.mapContent.appendChild(tree);
  }

  function createMindBranch(branch, level) {
    const node = document.createElement("article");
    node.className = "qq-map-branch";
    node.style.setProperty("--map-depth", Math.min(level, 5));
    const heading = document.createElement("h4");
    heading.textContent = branch?.title || "未命名主题";
    node.appendChild(heading);
    if (branch?.insight) {
      const insight = document.createElement("p");
      insight.className = "qq-map-insight";
      insight.textContent = branch.insight;
      node.appendChild(insight);
    }
    (Array.isArray(branch?.questions) ? branch.questions : []).forEach((question) => {
      const item = document.createElement("p");
      item.className = "qq-map-question";
      item.textContent = typeof question === "string" ? question : question.question;
      node.appendChild(item);
    });
    if (Array.isArray(branch?.children) && branch.children.length) {
      const children = document.createElement("div");
      children.className = "qq-map-children";
      branch.children.forEach((child) => children.appendChild(createMindBranch(child, level + 1)));
      node.appendChild(children);
    }
    return node;
  }

  async function exportWord() {
    if (!items.length) return showToast("还没有可导出的内容", true);
    if (!globalThis.QuestionQueueDocx) return showToast("Word 导出模块未加载", true);
    els.wordButton.disabled = true;
    try {
      const blob = await globalThis.QuestionQueueDocx.build(items, mindMap, "blob");
      downloadBlob(blob, `追问簿-${new Date().toISOString().slice(0, 10)}.docx`);
      showToast("Word 文档已导出");
    } catch (error) {
      showToast(`Word 导出失败：${error.message}`, true);
    } finally {
      els.wordButton.disabled = false;
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openPanel() {
    panelOpen = true;
    els.panel.classList.add("is-open");
    els.backdrop.classList.add("is-open");
    setTimeout(() => els.question.focus(), 100);
  }

  function closePanel() {
    panelOpen = false;
    els.panel.classList.remove("is-open");
    els.backdrop.classList.remove("is-open");
  }

  function togglePanel() {
    panelOpen ? closePanel() : openPanel();
  }

  async function openBestPanel() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "QQ_OPEN_SIDE_PANEL" });
      if (response?.ok) return;
    } catch {
      // Older browsers fall back to the in-page drawer below.
    }
    togglePanel();
  }

  function showToast(message, error = false) {
    els.toast.textContent = message;
    els.toast.classList.toggle("is-error", error);
    els.toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function conversationKey(url, title) {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/\/+$/, "") || "/";
      if (path !== "/") return `${parsed.origin}${path}`;
    } catch {
      // Use title when the URL is unavailable.
    }
    return `title:${location.hostname}:${cleanConversationTitle(title)}`;
  }

  function cleanConversationTitle(title) {
    let value = String(title || "").trim();
    const site = SITE_NAMES[location.hostname] || location.hostname;
    [site, "ChatGPT", "Claude", "Gemini", "DeepSeek", "Grok", "Poe", "Microsoft Copilot", "豆包", "腾讯元宝"]
      .filter(Boolean)
      .forEach((suffix) => {
        value = value.replace(new RegExp(`\\s*[-|·—–]\\s*${String(suffix).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "").trim();
      });
    return value || `${site} 未命名对话`;
  }

  function parseTags(value) {
    return normalizeTags(String(value || "").split(/[,，;；\n]+/));
  }

  function normalizeTags(value) {
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    return Array.from(new Set(list.map((tag) => String(tag).trim().replace(/^#\s*/, "")).filter(Boolean))).slice(0, 20);
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function styles() {
    return `
      :host { all: initial; color-scheme: light; }
      * { box-sizing: border-box; }
      button, input, textarea { font: inherit; }
      button { cursor: pointer; }
      .qq-hidden { display: none !important; }
      .qq-fab { position: fixed; right: 20px; bottom: 96px; z-index: 2147483645; width: 48px; height: 48px; border: 0; border-radius: 16px; color: #fff; background: #6d5ef7; box-shadow: 0 10px 30px rgba(50,40,130,.28); font: 700 24px/1 system-ui,sans-serif; transition: transform .2s, box-shadow .2s; }
      .qq-fab:hover { transform: translateY(-2px); box-shadow: 0 14px 34px rgba(50,40,130,.34); }
      .qq-fab b { position: absolute; top: -6px; right: -6px; min-width: 20px; height: 20px; padding: 0 5px; border: 2px solid #fff; border-radius: 10px; background: #e05151; font: 700 11px/16px system-ui,sans-serif; }
      .qq-backdrop { position: fixed; inset: 0; z-index: 2147483645; visibility: hidden; opacity: 0; background: rgba(18,18,30,.18); transition: .22s; }
      .qq-backdrop.is-open { visibility: visible; opacity: 1; }
      .qq-panel { position: fixed; z-index: 2147483646; top: 0; right: 0; width: min(430px, 94vw); height: 100vh; display: flex; flex-direction: column; overflow: hidden; color: #292735; background: #faf9fd; border-left: 1px solid #e5e1ee; box-shadow: -20px 0 60px rgba(35,28,58,.16); font: 14px/1.45 Inter,"Microsoft YaHei",system-ui,sans-serif; transform: translateX(105%); transition: transform .24s ease; }
      .qq-panel.is-open { transform: translateX(0); }
      .qq-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 22px 14px; }
      .qq-header h2 { margin: 0; font-size: 20px; letter-spacing: -.02em; }
      .qq-header p { margin: 3px 0 0; color: #7a7587; font-size: 12px; }
      .qq-icon { width: 32px; height: 32px; border: 0; border-radius: 9px; color: #716b7b; background: transparent; font-size: 25px; line-height: 28px; }
      .qq-icon:hover { background: #eeebf4; }
      .qq-compose { margin: 0 16px 12px; padding: 13px; background: #fff; border: 1px solid #e3dfec; border-radius: 15px; box-shadow: 0 4px 16px rgba(45,37,66,.05); }
      textarea { width: 100%; resize: vertical; color: #292735; background: transparent; border: 1px solid #ddd8e8; border-radius: 9px; outline: none; padding: 9px 10px; line-height: 1.5; }
      textarea:focus, input:focus { border-color: #7c6cf6 !important; box-shadow: 0 0 0 3px rgba(124,108,246,.10); }
      #qqQuestion { min-height: 76px; border: 0; padding: 2px; font-size: 14px; }
      details { margin-top: 8px; border-top: 1px solid #efedf3; }
      summary { padding: 9px 0 5px; color: #7b7588; cursor: pointer; font-size: 12px; }
      label { display: block; margin-top: 7px; color: #6f697b; font-size: 11px; }
      label textarea { display: block; margin-top: 4px; font-size: 12px; }
      .qq-compose-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
      .qq-primary, .qq-ghost { border: 0; border-radius: 9px; padding: 8px 12px; font-weight: 650; }
      .qq-primary { color: #fff; background: #6d5ef7; }
      .qq-primary:hover { background: #5d4fe3; }
      .qq-primary:disabled { cursor: default; opacity: .5; }
      .qq-ghost { color: #625d6d; background: #efedf4; }
      .qq-tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; padding: 0 16px 11px; }
      .qq-tab { padding: 8px 2px; color: #706a7b; background: transparent; border: 0; border-bottom: 2px solid transparent; font-size: 12px; white-space: nowrap; }
      .qq-tab.is-active { color: var(--status-color); border-bottom-color: var(--status-color); font-weight: 700; }
      .qq-toolbar { display: flex; gap: 8px; padding: 0 16px 12px; }
      .qq-toolbar input { min-width: 0; flex: 1; padding: 8px 10px; color: #363140; background: #fff; border: 1px solid #ded9e7; border-radius: 9px; outline: none; }
      .qq-fill { padding: 8px 10px; font-size: 12px; white-space: nowrap; }
      .qq-list { flex: 1; overflow-y: auto; padding: 0 16px 24px; }
      .qq-card { margin-bottom: 10px; padding: 13px 13px 11px; background: #fff; border: 1px solid #e5e1ea; border-left: 3px solid var(--status-color); border-radius: 12px; box-shadow: 0 3px 12px rgba(45,37,66,.035); }
      .qq-card-meta { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 7px; color: #8b8595; font-size: 10px; }
      .qq-card-meta a { color: #6d5ef7; text-decoration: none; }
      .qq-card-question { margin: 0; color: #302c38; font-size: 14px; font-weight: 600; white-space: pre-wrap; }
      .qq-card-context, .qq-card-notes { display: -webkit-box; overflow: hidden; margin: 8px 0 0; color: #817b8a; font-size: 11px; white-space: pre-wrap; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
      .qq-card-notes { color: #5f776b; }
      .qq-card-tags { margin: 7px 0 0; color: #6557b8; font-size: 10px; }
      .qq-card-actions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 11px; }
      .qq-small { padding: 5px 8px; color: #625c6d; background: #f2f0f5; border: 0; border-radius: 7px; font-size: 11px; }
      .qq-small:hover { background: #e9e5ef; }
      .qq-small:first-child { color: #fff; background: var(--status-color); }
      .qq-small.danger { margin-left: auto; color: #a65050; background: transparent; }
      .qq-empty { display: grid; place-items: center; min-height: 180px; color: #958fa0; text-align: center; }
      .qq-empty span { font-size: 34px; color: #d0cadb; }
      .qq-empty p { margin: -40px 0 0; }
      .qq-footer { display: flex; justify-content: space-between; padding: 10px 17px; color: #958f9f; background: #f4f2f7; border-top: 1px solid #e4e0e9; font-size: 10px; }
      .qq-link { padding: 0 5px; color: #6d5ef7; background: transparent; border: 0; font-size: 11px; }
      .qq-bulkbar { display: flex; justify-content: flex-end; gap: 8px; padding: 0 16px 10px; }
      .qq-bulkbar button { padding: 6px 10px; font-size: 11px; }
      .qq-bulkbar button:disabled { cursor: default; opacity: .5; }
      .qq-select-box { flex: 0 0 auto; width: 15px; height: 15px; margin: 0; accent-color: var(--status-color); }
      .qq-footer > div { display: flex; flex-wrap: wrap; justify-content: flex-end; }
      .qq-map-modal { position: absolute; inset: 0; z-index: 4; display: flex; flex-direction: column; visibility: hidden; background: #faf9fd; transform: translateX(105%); transition: transform .22s ease, visibility .22s; }
      .qq-map-modal.is-open { visibility: visible; transform: translateX(0); }
      .qq-map-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 18px 12px; border-bottom: 1px solid #e4e0e9; }
      .qq-map-header h3 { margin: 0; color: #302c38; font-size: 18px; }
      .qq-map-header p { margin: 3px 0 0; color: #857f90; font-size: 10px; }
      .qq-map-controls { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 16px; }
      .qq-map-controls span { color: #8b8595; font-size: 10px; }
      .qq-map-controls button { padding: 7px 10px; font-size: 11px; }
      .qq-map-content { flex: 1; overflow: auto; padding: 4px 16px 30px; }
      .qq-map-empty { margin-top: 30px; padding: 24px; color: #8d8797; border: 1px dashed #d7d2df; border-radius: 12px; text-align: center; font-size: 12px; }
      .qq-map-title { margin: 8px 0 5px; color: #4d416f; font-size: 18px; text-align: center; }
      .qq-map-summary { margin: 0 0 16px; padding: 10px 12px; color: #5f5969; background: #f0edf7; border-radius: 10px; font-size: 11px; }
      .qq-map-tree { display: grid; gap: 12px; }
      .qq-map-branch { position: relative; margin-left: calc(var(--map-depth) * 13px); padding: 11px 12px; background: #fff; border: 1px solid #e2ddea; border-left: 3px solid #6d5ef7; border-radius: 10px; }
      .qq-map-branch h4 { margin: 0 0 5px; color: #40384f; font-size: 13px; }
      .qq-map-insight { margin: 0 0 7px; color: #746e7d; font-size: 11px; }
      .qq-map-question { margin: 5px 0 0; padding: 5px 7px; color: #4e4858; background: #f6f4f8; border-radius: 6px; font-size: 10px; }
      .qq-map-question::before { content: "? "; color: #6d5ef7; font-weight: 700; }
      .qq-map-children { display: grid; gap: 8px; margin-top: 9px; padding-left: 8px; border-left: 1px solid #d9d3e3; }
      .qq-toast { position: absolute; z-index: 6; left: 50%; bottom: 48px; max-width: 86%; padding: 9px 14px; color: #fff; background: #393442; border-radius: 9px; box-shadow: 0 8px 22px rgba(20,16,30,.2); opacity: 0; pointer-events: none; transform: translate(-50%, 10px); transition: .2s; font-size: 12px; text-align: center; }
      .qq-toast.is-visible { opacity: 1; transform: translate(-50%, 0); }
      .qq-toast.is-error { background: #a94949; }
      @media (prefers-reduced-motion: reduce) { .qq-panel, .qq-backdrop, .qq-fab, .qq-toast { transition: none; } }
    `;
  }
})();
