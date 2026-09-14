(() => {
  const STORAGE_KEY = "questionQueueItems";
  const MINDMAP_KEY = "questionQueueMindMap";
  const AI_SETTINGS_KEY = "questionQueueAiSettings";
  const UI_SETTINGS_KEY = "questionQueueUiSettings";
  const CAPTURE_KEY = "questionQueueCaptureDraft";
  const SEARCH_DEBOUNCE_MS = 150;
  const DEFAULT_MODEL = "qwen-max";
  const STATUS = {
    note: { label: "笔记", color: "#596579" },
    pending: { label: "待输入", color: "#7C5CFC" },
    inserted: { label: "已输入", color: "#168AAD" },
    answered: { label: "已回答", color: "#E58A26" },
    learned: { label: "已掌握", color: "#2E9D64" }
  };
  const Sites = globalThis.QuestionQueueSites;
  const Store = globalThis.QuestionQueueStore;

  let items = [];
  let mindMap = null;
  let activeStatus = "pending";
  let activeConversation = "all";
  let activeTag = "all";
  let searchQuery = "";
  let selectedIds = new Set();
  let editingId = null;
  let captureMeta = null;
  let savedSettings = {};
  let uiSettings = {};
  let searchTimer = null;

  const $ = (selector) => document.querySelector(selector);
  const els = {
    question: $("#question"), context: $("#context"), tags: $("#tags"), notes: $("#notes"), details: $("#details"),
    tagSuggestions: $("#tagSuggestions"), conversationFilter: $("#conversationFilter"), tagFilter: $("#tagFilter"),
    save: $("#save"), cancelEdit: $("#cancelEdit"), statuses: $("#statuses"), search: $("#search"),
    fillAll: $("#fillAll"), bulkbar: $("#bulkbar"), selectAll: $("#selectAll"),
    fillSelected: $("#fillSelected"), list: $("#list"), word: $("#word"), import: $("#import"),
    export: $("#export"), exportScope: $("#exportScope"), importFile: $("#importFile"), analyze: $("#analyze"),
    mapTime: $("#mapTime"), mapContent: $("#mapContent"), baseUrl: $("#baseUrl"), model: $("#model"),
    apiKey: $("#apiKey"), saveSettings: $("#saveSettings"), clearSettings: $("#clearSettings"),
    settingsState: $("#settingsState"), fillPrefix: $("#fillPrefix"), saveFillPrefix: $("#saveFillPrefix"),
    resetFillPrefix: $("#resetFillPrefix"), toast: $("#toast")
  };

  bindEvents();
  initialize();

  async function initialize() {
    const stored = await chrome.storage.local.get([STORAGE_KEY, MINDMAP_KEY, AI_SETTINGS_KEY, UI_SETTINGS_KEY, CAPTURE_KEY]);
    items = readItems(stored[STORAGE_KEY]);
    mindMap = stored[MINDMAP_KEY] || null;
    savedSettings = stored[AI_SETTINGS_KEY] || {};
    uiSettings = stored[UI_SETTINGS_KEY] || {};
    render();
    renderMindMap();
    renderSettings();
    if (stored[CAPTURE_KEY]) await consumeCapture(stored[CAPTURE_KEY]);
  }

  function readItems(value) {
    return (Array.isArray(value) ? value : []).map(Store.sanitizeItem).filter(Boolean);
  }

  function bindEvents() {
    document.querySelectorAll(".view-tab").forEach((button) => {
      button.addEventListener("click", () => showView(button.dataset.view));
    });
    els.save.addEventListener("click", saveEditor);
    els.cancelEdit.addEventListener("click", resetEditor);
    els.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQuery = els.search.value.trim().toLocaleLowerCase();
        renderList();
        renderBulkbar();
      }, SEARCH_DEBOUNCE_MS);
    });
    els.conversationFilter.addEventListener("change", () => {
      activeConversation = els.conversationFilter.value;
      selectedIds.clear();
      render();
    });
    els.tagFilter.addEventListener("change", () => {
      activeTag = els.tagFilter.value;
      selectedIds.clear();
      render();
    });
    els.fillAll.addEventListener("click", () => fillItems(
      items.filter((item) => item.status === "pending")
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    ));
    els.selectAll.addEventListener("click", toggleSelectAll);
    els.fillSelected.addEventListener("click", () => {
      fillItems(getVisibleItems().filter((item) => selectedIds.has(item.id)));
    });
    els.word.addEventListener("click", exportWord);
    els.export.addEventListener("click", exportJson);
    els.import.addEventListener("click", () => els.importFile.click());
    els.importFile.addEventListener("change", importJson);
    els.analyze.addEventListener("click", analyzeQuestions);
    els.saveSettings.addEventListener("click", saveAiSettings);
    els.clearSettings.addEventListener("click", clearAiSettings);
    els.saveFillPrefix.addEventListener("click", saveFillPrefix);
    els.resetFillPrefix.addEventListener("click", resetFillPrefix);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[STORAGE_KEY]) {
        items = readItems(changes[STORAGE_KEY].newValue);
        render();
      }
      if (changes[MINDMAP_KEY]) {
        mindMap = changes[MINDMAP_KEY].newValue || null;
        renderMindMap();
      }
      if (changes[AI_SETTINGS_KEY]) {
        savedSettings = changes[AI_SETTINGS_KEY].newValue || {};
        renderSettings();
      }
      if (changes[UI_SETTINGS_KEY]) {
        uiSettings = changes[UI_SETTINGS_KEY].newValue || {};
        renderSettings();
      }
      if (changes[CAPTURE_KEY]?.newValue) consumeCapture(changes[CAPTURE_KEY].newValue);
    });
  }

  function showView(name) {
    document.querySelectorAll(".view-tab").forEach((tab) => {
      const active = tab.dataset.view === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll(".view").forEach((view) => {
      view.classList.toggle("is-active", view.id === `view-${name}`);
    });
    if (name === "map") renderMindMap();
  }

  async function consumeCapture(draft) {
    const selection = String(draft?.selection || "").trim();
    if (selection) {
      const existing = els.context.value.trim();
      els.context.value = existing ? `${existing}\n\n${selection}` : selection;
      els.details.open = true;
    }
    captureMeta = draft || null;
    if (draft?.autoSaved) {
      activeStatus = "note";
      selectedIds.clear();
      render();
    }
    showView("queue");
    await chrome.storage.local.remove(CAPTURE_KEY);
    setTimeout(() => els.question.focus(), 30);
    showToast(draft?.autoSaved
      ? `${draft.wasDuplicate ? "这段内容已在" : "已保存到"}“${draft.sectionTitle || "笔记"}”；可直接输入追问`
      : (selection ? "划词内容已追加到“相关上下文”" : "可以记录新疑问"));
  }

  // Storage writes can fail once the local quota is reached, and silently losing a
  // record is worse than telling the user immediately.
  async function persistItems() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: items });
      render();
      return true;
    } catch (error) {
      const detail = error?.message || "未知错误";
      showToast(`保存失败：${detail}；请先导出备份并删除部分记录`, true);
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      items = readItems(stored[STORAGE_KEY]);
      render();
      return false;
    }
  }

  function render() {
    renderStatuses();
    renderFilters();
    renderList();
    renderBulkbar();
    const pending = items.filter((item) => item.status === "pending").length;
    els.fillAll.disabled = pending === 0;
    els.fillAll.textContent = pending ? `一键填入待输入（${pending}）` : "暂无待输入";
  }

  function renderStatuses() {
    els.statuses.replaceChildren();
    Object.entries(STATUS).forEach(([key, config]) => {
      const count = items.filter((item) => item.status === key).length;
      const button = document.createElement("button");
      button.className = `status ${activeStatus === key ? "is-active" : ""}`;
      button.type = "button";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", activeStatus === key ? "true" : "false");
      button.style.setProperty("--status-color", config.color);
      button.textContent = `${config.label} ${count}`;
      button.addEventListener("click", () => {
        activeStatus = key;
        selectedIds.clear();
        render();
      });
      els.statuses.appendChild(button);
    });
  }

  function renderFilters() {
    const conversations = new Map();
    items.forEach((item) => {
      const key = conversationKeyForItem(item);
      const existing = conversations.get(key);
      if (!existing || new Date(item.updatedAt) > new Date(existing.updatedAt)) {
        conversations.set(key, { title: conversationTitleForItem(item), updatedAt: item.updatedAt });
      }
    });
    if (activeConversation !== "all" && !conversations.has(activeConversation)) activeConversation = "all";
    els.conversationFilter.replaceChildren(option("all", `全部来源（${conversations.size}）`));
    Array.from(conversations.entries())
      .sort((a, b) => new Date(b[1].updatedAt) - new Date(a[1].updatedAt))
      .forEach(([key, value]) => els.conversationFilter.appendChild(option(key, value.title)));
    els.conversationFilter.value = activeConversation;

    const tags = Array.from(new Set(items.flatMap((item) => normalizeTags(item.tags)))).sort((a, b) => a.localeCompare(b, "zh-CN"));
    if (activeTag !== "all" && !tags.includes(activeTag)) activeTag = "all";
    els.tagFilter.replaceChildren(option("all", `全部标签（${tags.length}）`));
    els.tagSuggestions.replaceChildren();
    tags.forEach((tag) => {
      els.tagFilter.appendChild(option(tag, tag));
      els.tagSuggestions.appendChild(option(tag, tag));
    });
    els.tagFilter.value = activeTag;
  }

  function option(value, label) {
    const node = document.createElement("option");
    node.value = value;
    node.textContent = label;
    return node;
  }

  function getVisibleItems() {
    return items
      .filter((item) => item.status === activeStatus)
      .filter((item) => activeConversation === "all" || conversationKeyForItem(item) === activeConversation)
      .filter((item) => activeTag === "all" || normalizeTags(item.tags).includes(activeTag))
      .filter((item) => !searchQuery || [
        item.title, item.content, item.question, item.context, item.notes, item.site,
        conversationTitleForItem(item), normalizeTags(item.tags).join(" ")
      ].some((value) => String(value || "").toLocaleLowerCase().includes(searchQuery)))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function renderList() {
    const visible = getVisibleItems();
    els.list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = searchQuery ? "没有匹配内容" : `还没有“${STATUS[activeStatus].label}”的问题`;
      els.list.appendChild(empty);
      return;
    }
    const groups = new Map();
    visible.forEach((item) => {
      const key = conversationKeyForItem(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    groups.forEach((groupItems) => {
      const group = document.createElement("section");
      group.className = "conversation-group";
      const head = document.createElement("header");
      head.className = "conversation-head";
      const heading = document.createElement("h3");
      heading.textContent = conversationTitleForItem(groupItems[0]);
      heading.title = heading.textContent;
      const count = document.createElement("span");
      count.textContent = `${groupItems.length} 条`;
      head.append(heading, count);
      group.appendChild(head);
      groupItems.forEach((item) => group.appendChild(createItem(item)));
      els.list.appendChild(group);
    });
  }

  function createItem(item) {
    const card = document.createElement("article");
    card.className = "item";
    card.style.setProperty("--status-color", STATUS[item.status]?.color || "#8d8797");

    const meta = document.createElement("div");
    meta.className = "item-meta";
    if (item.status === "pending" || item.status === "inserted") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedIds.has(item.id);
      checkbox.setAttribute("aria-label", `选择：${item.question}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedIds.add(item.id);
        else selectedIds.delete(item.id);
        renderBulkbar();
      });
      meta.appendChild(checkbox);
    }
    const sourceUrl = Store.safeHttpUrl(item.sourceUrl);
    const source = document.createElement(sourceUrl ? "a" : "span");
    source.textContent = item.site || "其他网页";
    if (sourceUrl) {
      source.href = sourceUrl;
      source.target = "_blank";
      source.rel = "noreferrer noopener";
      source.title = sourceUrl;
    }
    const time = document.createElement("time");
    time.textContent = formatTime(item.updatedAt);
    meta.append(source, time);

    if (item.kind === "note") {
      const title = document.createElement("p");
      title.className = "item-note-title";
      title.textContent = item.title || "未命名笔记";
      const content = document.createElement("p");
      content.className = "item-note-content";
      content.textContent = item.content || item.context || "";
      card.append(meta, title, content);
    } else {
      const question = document.createElement("p");
      question.className = "item-question";
      question.textContent = item.question;
      card.append(meta, question);
    }

    if (item.kind !== "note" && item.context) {
      const context = document.createElement("p");
      context.className = "item-context";
      context.textContent = item.context;
      card.appendChild(context);
    }
    if (item.notes) {
      const notes = document.createElement("p");
      notes.className = "item-notes";
      notes.textContent = `笔记：${item.notes}`;
      card.appendChild(notes);
    }
    const answerUrl = Store.safeHttpUrl(item.answerUrl);
    if (answerUrl) {
      const answer = document.createElement("a");
      answer.className = "item-answer";
      answer.textContent = "打开回答所在页面";
      answer.href = answerUrl;
      answer.target = "_blank";
      answer.rel = "noreferrer noopener";
      answer.title = answerUrl;
      card.appendChild(answer);
    }
    const itemTags = normalizeTags(item.tags);
    if (itemTags.length) {
      const tags = document.createElement("div");
      tags.className = "item-tags";
      itemTags.forEach((tag) => {
        const chip = document.createElement("button");
        chip.className = "tag-chip";
        chip.type = "button";
        chip.textContent = `# ${tag}`;
        chip.title = `只看标签：${tag}`;
        chip.addEventListener("click", () => {
          activeTag = tag;
          selectedIds.clear();
          render();
        });
        tags.appendChild(chip);
      });
      card.appendChild(tags);
    }

    const actions = document.createElement("div");
    actions.className = "item-actions";
    if (item.kind === "note") actions.appendChild(actionButton("基于此笔记追问", () => askFromNote(item), "accent"));
    if (item.status === "pending") actions.appendChild(actionButton("填入", () => fillItems([item])));
    if (item.status === "inserted") {
      actions.appendChild(actionButton("再次填入", () => fillItems([item])));
      actions.appendChild(actionButton("标为已回答", () => setStatus(item.id, "answered")));
    }
    if (item.status === "answered") actions.appendChild(actionButton("标为已掌握", () => setStatus(item.id, "learned"), "accent"));
    if (item.status === "learned") actions.appendChild(actionButton("重新追问", () => setStatus(item.id, "pending")));
    actions.appendChild(actionButton("编辑", () => editItem(item)));
    actions.appendChild(actionButton("删除", () => deleteItem(item), "danger"));
    card.appendChild(actions);
    return card;
  }

  function actionButton(label, handler, kind = "") {
    const button = document.createElement("button");
    button.className = `small ${kind}`;
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  async function saveEditor() {
    const question = els.question.value.trim();
    const editingItem = editingId ? items.find((entry) => entry.id === editingId) : null;
    const editingNote = editingItem?.kind === "note";
    if (!question) return showToast(editingNote ? "请填写笔记标题" : "请先写下疑问", true);
    const duplicate = editingNote ? null : Store.findDuplicate(items, question, editingId || "");
    if (duplicate && !confirm(`已经记录过高度相似的问题（${STATUS[duplicate.status]?.label || duplicate.status}）：\n\n${duplicate.question}\n\n仍然保存这一条？`)) {
      return;
    }
    const now = new Date().toISOString();
    if (editingId) {
      const item = editingItem;
      if (item?.kind === "note") Object.assign(item, {
        title: question, content: els.context.value.trim(), tags: parseTags(els.tags.value),
        notes: els.notes.value.trim(), updatedAt: now
      });
      else if (item) Object.assign(item, {
          question, context: els.context.value.trim(), tags: parseTags(els.tags.value),
          notes: els.notes.value.trim(), updatedAt: now
        });
      showToast("已更新");
    } else {
      const source = normalizeSourceMeta(captureMeta || await currentTabMeta());
      items.push({
        id: crypto.randomUUID(), kind: "question", question, context: els.context.value.trim(), tags: parseTags(els.tags.value),
        notes: els.notes.value.trim(), status: "pending", site: source.site,
        sourceType: source.sourceType, sourceTitle: source.sourceTitle, sourceUrl: source.sourceUrl,
        conversationId: source.conversationId, conversationTitle: source.conversationTitle,
        parentNoteId: captureMeta?.noteId || "",
        createdAt: now, updatedAt: now
      });
      activeStatus = "pending";
      showToast("已加入待输入清单");
    }
    resetEditor();
    await persistItems();
  }

  function editItem(item) {
    editingId = item.id;
    els.question.value = item.kind === "note" ? (item.title || "") : (item.question || "");
    els.context.value = item.kind === "note" ? (item.content || item.context || "") : (item.context || "");
    els.tags.value = normalizeTags(item.tags).join(", ");
    els.notes.value = item.notes || "";
    els.details.open = item.kind === "note" || Boolean(item.context || item.notes);
    els.save.textContent = item.kind === "note" ? "保存笔记" : "保存修改";
    els.question.placeholder = item.kind === "note" ? "笔记标题" : "写下疑问…";
    els.cancelEdit.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
    els.question.focus();
  }

  function askFromNote(item) {
    resetEditor();
    els.context.value = item.content || item.context || "";
    els.tags.value = normalizeTags(item.tags).join(", ");
    els.details.open = true;
    captureMeta = {
      noteId: item.id, site: item.site, sourceType: item.sourceType,
      sourceTitle: item.sourceTitle, sourceUrl: item.sourceUrl,
      conversationId: item.conversationId, conversationTitle: item.conversationTitle
    };
    window.scrollTo({ top: 0, behavior: "smooth" });
    els.question.focus();
    showToast(`正在基于“${item.title || "该笔记"}”追问`);
  }

  function resetEditor() {
    editingId = null;
    captureMeta = null;
    els.question.value = "";
    els.question.placeholder = "写下疑问；划词右键会直接保存为笔记…";
    els.context.value = "";
    els.tags.value = "";
    els.notes.value = "";
    els.details.open = false;
    els.save.textContent = "加入追问";
    els.cancelEdit.classList.add("hidden");
  }

  async function setStatus(id, status) {
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    const now = new Date().toISOString();
    item.status = status;
    item.updatedAt = now;
    item[`${status}At`] = now;
    if (status === "answered" && !item.answerUrl) {
      const answerUrl = await currentTabUrl();
      if (answerUrl) item.answerUrl = answerUrl;
    }
    selectedIds.delete(id);
    await persistItems();
  }

  async function deleteItem(item) {
    if (!confirm(`删除这条${item.kind === "note" ? "笔记" : "疑问"}？\n\n${item.title || item.question}`)) return;
    items = items.filter((entry) => entry.id !== item.id);
    selectedIds.delete(item.id);
    if (editingId === item.id) resetEditor();
    if (await persistItems()) showToast("已删除");
  }

  function renderBulkbar() {
    const available = activeStatus === "pending" || activeStatus === "inserted";
    els.bulkbar.classList.toggle("hidden", !available);
    if (!available) return;
    const visible = getVisibleItems();
    const selected = visible.filter((item) => selectedIds.has(item.id));
    els.selectAll.disabled = visible.length === 0;
    els.selectAll.textContent = visible.length && selected.length === visible.length ? "取消全选" : "全选当前";
    els.selectAll.setAttribute("aria-pressed", visible.length && selected.length === visible.length ? "true" : "false");
    els.fillSelected.disabled = selected.length === 0;
    const verb = activeStatus === "inserted" ? "再次填入所选" : "填入所选";
    els.fillSelected.textContent = selected.length ? `${verb}（${selected.length}）` : verb;
  }

  function toggleSelectAll() {
    const visible = getVisibleItems();
    const all = visible.length && visible.every((item) => selectedIds.has(item.id));
    visible.forEach((item) => {
      if (all) selectedIds.delete(item.id);
      else selectedIds.add(item.id);
    });
    renderList();
    renderBulkbar();
  }

  async function fillItems(targetItems) {
    if (!targetItems.length) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const host = hostname(tab?.url);
    if (!tab?.id || !Sites.isChatSite(host)) {
      showToast("请先在左侧打开受支持的大模型对话页面", true);
      return;
    }
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "QQ_APPEND_QUESTIONS",
        prefix: fillPrefix(),
        items: targetItems.map(({ id, question }) => ({ id, question }))
      });
      if (!response?.ok) throw new Error(response?.error || "填入失败");
      const now = new Date().toISOString();
      const ids = new Set(targetItems.map((item) => item.id));
      items.forEach((item) => {
        if (!ids.has(item.id)) return;
        item.status = "inserted";
        item.insertedAt = now;
        item.updatedAt = now;
        selectedIds.delete(item.id);
      });
      if (await persistItems()) showToast(`已追加 ${targetItems.length} 条；左侧已有输入未被覆盖`);
    } catch (error) {
      showToast(error.message || "无法连接当前页面；更新扩展后请刷新该页面", true);
    }
  }

  async function analyzeQuestions() {
    const questions = items.filter((item) => item.kind !== "note" && item.question);
    if (!questions.length) return showToast("还没有可分析的问题", true);
    els.analyze.disabled = true;
    els.analyze.textContent = "千问分析中…";
    try {
      const safeItems = questions.map(({ id, question, status }) => ({ id, question, status }));
      const response = await chrome.runtime.sendMessage({ type: "QQ_ANALYZE_MINDMAP", items: safeItems });
      if (!response?.ok) throw new Error(response?.error || "智能分析失败");
      mindMap = { ...response.mindMap, generatedAt: new Date().toISOString(), sourceCount: questions.length };
      await chrome.storage.local.set({ [MINDMAP_KEY]: mindMap });
      renderMindMap();
      showToast("思维导图已生成");
    } catch (error) {
      showToast(error.message || "智能分析失败", true);
      if (/配置|Base URL|API Key|模型/.test(error.message || "")) showView("settings");
    } finally {
      els.analyze.disabled = false;
      els.analyze.textContent = mindMap ? "重新分析" : "生成思维导图";
    }
  }

  function renderMindMap() {
    els.mapContent.replaceChildren();
    els.analyze.textContent = mindMap ? "重新分析" : "生成思维导图";
    els.mapTime.textContent = mindMap?.generatedAt
      ? `${formatTime(mindMap.generatedAt)} · ${mindMap.sourceCount || items.length} 个问题`
      : "尚未生成";
    if (!mindMap?.branches?.length) {
      const empty = document.createElement("div");
      empty.className = "map-empty";
      empty.textContent = "生成后，会按主题整理已有问题，方便复盘自己的疑问路径。";
      els.mapContent.appendChild(empty);
      return;
    }
    const title = document.createElement("h2");
    title.className = "map-title";
    title.textContent = mindMap.title || "问题知识结构";
    els.mapContent.appendChild(title);
    if (mindMap.summary) {
      const summary = document.createElement("p");
      summary.className = "map-summary";
      summary.textContent = mindMap.summary;
      els.mapContent.appendChild(summary);
    }
    mindMap.branches.forEach((branch) => els.mapContent.appendChild(createBranch(branch, 0)));
  }

  function createBranch(branch, level) {
    const node = document.createElement("article");
    node.className = "map-branch";
    node.style.setProperty("--map-depth", Math.min(level, 5));
    const heading = document.createElement("h3");
    heading.textContent = branch?.title || "未命名主题";
    node.appendChild(heading);
    if (branch?.insight) {
      const insight = document.createElement("p");
      insight.className = "map-insight";
      insight.textContent = branch.insight;
      node.appendChild(insight);
    }
    (Array.isArray(branch?.questions) ? branch.questions : []).forEach((question) => {
      const line = document.createElement("p");
      line.className = "map-question";
      line.textContent = typeof question === "string" ? question : question?.question || "";
      node.appendChild(line);
    });
    if (Array.isArray(branch?.children) && branch.children.length) {
      const children = document.createElement("div");
      children.className = "map-children";
      branch.children.forEach((child) => children.appendChild(createBranch(child, level + 1)));
      node.appendChild(children);
    }
    return node;
  }

  function exportScopeItems() {
    const scope = els.exportScope.value;
    if (scope === "filtered") return getVisibleItems();
    if (scope === "selected") return getVisibleItems().filter((item) => selectedIds.has(item.id));
    return items;
  }

  function exportScopeLabel() {
    return els.exportScope.selectedOptions[0]?.textContent || "全部记录";
  }

  // A partial export carries a mind map pruned to the exported questions.
  function exportScopeMindMap(scoped) {
    if (!mindMap) return null;
    return els.exportScope.value === "all" ? mindMap : Store.filterMindMap(mindMap, scoped);
  }

  async function exportWord() {
    const scoped = exportScopeItems();
    if (!scoped.length) return showToast(`当前范围（${exportScopeLabel()}）没有可导出的内容`, true);
    if (!globalThis.QuestionQueueDocx) return showToast("Word 导出模块未加载", true);
    els.word.disabled = true;
    try {
      const blob = await globalThis.QuestionQueueDocx.build(scoped, exportScopeMindMap(scoped), "blob");
      downloadBlob(blob, `追问簿-${new Date().toISOString().slice(0, 10)}.docx`);
      showToast(`Word 文档已导出（${scoped.length} 条）`);
    } catch (error) {
      showToast(`Word 导出失败：${error.message}`, true);
    } finally {
      els.word.disabled = false;
    }
  }

  function exportJson() {
    const scoped = exportScopeItems();
    if (!scoped.length) return showToast(`当前范围（${exportScopeLabel()}）没有可导出的内容`, true);
    const payload = JSON.stringify({
      schemaVersion: 6,
      exportedAt: new Date().toISOString(),
      scope: els.exportScope.value,
      mindMap: exportScopeMindMap(scoped),
      items: scoped
    }, null, 2);
    downloadBlob(new Blob([payload], { type: "application/json" }),
      `question-queue-${new Date().toISOString().slice(0, 10)}.json`);
    showToast(`已导出 ${scoped.length} 条备份`);
  }

  async function importJson(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : data?.items;
      if (!Array.isArray(incoming)) throw new Error("Invalid data");
      const result = Store.mergeImportedItems(items, incoming);
      if (!result.added && !result.replaced) {
        showToast(`导入完成：没有可用记录，已跳过 ${result.skipped} 条`, true);
        return;
      }
      items = result.items;
      if (!Array.isArray(data) && data?.mindMap?.branches) {
        mindMap = data.mindMap;
        await chrome.storage.local.set({ [MINDMAP_KEY]: mindMap });
      }
      if (await persistItems()) {
        showToast(`导入完成：新增 ${result.added}，更新 ${result.replaced}，跳过 ${result.skipped}`);
      }
    } catch {
      showToast("导入失败：文件格式不正确", true);
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

  function fillPrefix() {
    const custom = String(uiSettings.fillPrefix ?? "").trim();
    return custom || Store.DEFAULT_FILL_PREFIX;
  }

  function renderSettings() {
    els.baseUrl.value = savedSettings.baseUrl || "";
    els.model.value = savedSettings.model || "";
    els.model.placeholder = DEFAULT_MODEL;
    els.apiKey.value = "";
    els.apiKey.placeholder = savedSettings.apiKey ? "已保存；留空则不修改" : "请输入重新生成的 API Key";
    els.settingsState.textContent = savedSettings.apiKey && savedSettings.baseUrl
      ? `已配置模型 ${savedSettings.model || DEFAULT_MODEL}`
      : "尚未配置";
    els.fillPrefix.value = uiSettings.fillPrefix ?? Store.DEFAULT_FILL_PREFIX;
  }

  async function saveAiSettings() {
    const baseUrl = els.baseUrl.value.trim().replace(/\/+$/, "");
    const apiKey = els.apiKey.value.trim() || savedSettings.apiKey || "";
    const model = els.model.value.trim() || DEFAULT_MODEL;
    if (!isAllowedBaseUrl(baseUrl)) return showToast("请填写阿里云百炼官方 Base URL", true);
    if (!apiKey) return showToast("请填写重新生成的 API Key", true);
    savedSettings = { baseUrl, apiKey, model, updatedAt: new Date().toISOString() };
    await chrome.storage.local.set({ [AI_SETTINGS_KEY]: savedSettings });
    renderSettings();
    showToast("AI 设置已保存");
  }

  async function clearAiSettings() {
    if (!confirm("清除本机保存的千问 Base URL、模型名和 API Key？")) return;
    savedSettings = {};
    await chrome.storage.local.remove(AI_SETTINGS_KEY);
    renderSettings();
    showToast("AI 设置已清除");
  }

  async function saveFillPrefix() {
    const value = els.fillPrefix.value.trim();
    uiSettings = { ...uiSettings, fillPrefix: value };
    await chrome.storage.local.set({ [UI_SETTINGS_KEY]: uiSettings });
    renderSettings();
    showToast(value ? "填入前缀已保存" : "已改为只填编号，不带前缀");
  }

  async function resetFillPrefix() {
    uiSettings = { ...uiSettings, fillPrefix: Store.DEFAULT_FILL_PREFIX };
    await chrome.storage.local.set({ [UI_SETTINGS_KEY]: uiSettings });
    renderSettings();
    showToast("填入前缀已恢复默认");
  }

  function isAllowedBaseUrl(value) {
    if (!value || value.includes("{WorkspaceId}") || value.includes("YOUR-WORKSPACE-ID")) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" &&
        (url.hostname.endsWith(".maas.aliyuncs.com") || url.hostname === "dashscope.aliyuncs.com");
    } catch {
      return false;
    }
  }

  async function currentTabUrl() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return Store.safeHttpUrl(tab?.url);
    } catch {
      return "";
    }
  }

  async function currentTabMeta() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const fallback = Sites.deriveSourceMeta({ url: tab?.url || "", title: tab?.title || "" });
    if (!tab?.id) return normalizeSourceMeta(fallback);
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "QQ_GET_SOURCE_META" });
      return normalizeSourceMeta(response?.sourceMeta || fallback);
    } catch {
      return normalizeSourceMeta(fallback);
    }
  }

  function normalizeSourceMeta(source = {}) {
    const derived = Sites.deriveSourceMeta({ url: source.sourceUrl || "", title: source.sourceTitle || "" });
    const site = source.site || derived.site;
    const sourceTitle = String(source.sourceTitle || derived.sourceTitle || "");
    const sourceUrl = Store.safeHttpUrl(source.sourceUrl || derived.sourceUrl);
    const sourceType = source.sourceType || derived.sourceType;
    return {
      site, sourceType, sourceTitle, sourceUrl,
      conversationId: source.conversationId || source.sourceId || conversationKey(sourceUrl, sourceTitle, site),
      conversationTitle: source.conversationTitle || sourceTitle || cleanConversationTitle(sourceTitle, site)
    };
  }

  function conversationKeyForItem(item) {
    return item.conversationId || conversationKey(item.sourceUrl, item.sourceTitle, item.site);
  }

  function conversationTitleForItem(item) {
    return item.conversationTitle || cleanConversationTitle(item.sourceTitle, item.site) || item.site || "未识别的来源";
  }

  function conversationKey(url, title, site) {
    return Sites.sourceKey(url, cleanConversationTitle(title, site), site);
  }

  function cleanConversationTitle(title, site) {
    const value = Sites.cleanTitle(title, site);
    if (!value || value.toLocaleLowerCase() === String(site || "").toLocaleLowerCase()) {
      return site ? `${site} 未命名来源` : "未命名来源";
    }
    return value;
  }

  function parseTags(value) {
    return Store.parseTags(value);
  }

  function normalizeTags(value) {
    return Store.normalizeTags(value);
  }

  function hostname(url) {
    return Sites.hostname(url);
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }

  function showToast(message, error = false) {
    els.toast.textContent = message;
    els.toast.classList.toggle("is-error", error);
    els.toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 3000);
  }
})();
