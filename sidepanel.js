(() => {
  const STORAGE_KEY = "questionQueueItems";
  const MINDMAP_KEY = "questionQueueMindMap";
  const AI_SETTINGS_KEY = "questionQueueAiSettings";
  const CAPTURE_KEY = "questionQueueCaptureDraft";
  const STATUS = {
    pending: { label: "待输入", color: "#7C5CFC" },
    inserted: { label: "已输入", color: "#168AAD" },
    answered: { label: "已回答", color: "#E58A26" },
    learned: { label: "已掌握", color: "#2E9D64" }
  };
  const Sites = globalThis.QuestionQueueSites;

  let items = [];
  let mindMap = null;
  let activeStatus = "pending";
  let activeConversation = "all";
  let activeTag = "all";
  let selectedIds = new Set();
  let editingId = null;
  let captureMeta = null;
  let savedSettings = {};

  const $ = (selector) => document.querySelector(selector);
  const els = {
    question: $("#question"), context: $("#context"), tags: $("#tags"), notes: $("#notes"), details: $("#details"),
    tagSuggestions: $("#tagSuggestions"), conversationFilter: $("#conversationFilter"), tagFilter: $("#tagFilter"),
    save: $("#save"), cancelEdit: $("#cancelEdit"), statuses: $("#statuses"), search: $("#search"),
    fillAll: $("#fillAll"), bulkbar: $("#bulkbar"), selectAll: $("#selectAll"),
    fillSelected: $("#fillSelected"), list: $("#list"), word: $("#word"), import: $("#import"),
    export: $("#export"), importFile: $("#importFile"), analyze: $("#analyze"),
    mapTime: $("#mapTime"), mapContent: $("#mapContent"), baseUrl: $("#baseUrl"),
    apiKey: $("#apiKey"), saveSettings: $("#saveSettings"), clearSettings: $("#clearSettings"),
    settingsState: $("#settingsState"), toast: $("#toast")
  };

  bindEvents();
  initialize();

  async function initialize() {
    const stored = await chrome.storage.local.get([STORAGE_KEY, MINDMAP_KEY, AI_SETTINGS_KEY, CAPTURE_KEY]);
    items = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    mindMap = stored[MINDMAP_KEY] || null;
    savedSettings = stored[AI_SETTINGS_KEY] || {};
    render();
    renderMindMap();
    renderSettings();
    if (stored[CAPTURE_KEY]) await consumeCapture(stored[CAPTURE_KEY]);
  }

  function bindEvents() {
    document.querySelectorAll(".view-tab").forEach((button) => {
      button.addEventListener("click", () => showView(button.dataset.view));
    });
    els.save.addEventListener("click", saveEditor);
    els.cancelEdit.addEventListener("click", resetEditor);
    els.search.addEventListener("input", render);
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
      if (changes[AI_SETTINGS_KEY]) {
        savedSettings = changes[AI_SETTINGS_KEY].newValue || {};
        renderSettings();
      }
      if (changes[CAPTURE_KEY]?.newValue) consumeCapture(changes[CAPTURE_KEY].newValue);
    });
  }

  function showView(name) {
    document.querySelectorAll(".view-tab").forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.view === name);
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
    showView("queue");
    await chrome.storage.local.remove(CAPTURE_KEY);
    setTimeout(() => els.question.focus(), 30);
    showToast(selection ? "划词内容已追加到“相关上下文”" : "可以记录新疑问");
  }

  async function persistItems() {
    await chrome.storage.local.set({ [STORAGE_KEY]: items });
    render();
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
    const query = els.search.value.trim().toLocaleLowerCase();
    return items
      .filter((item) => item.status === activeStatus)
      .filter((item) => activeConversation === "all" || conversationKeyForItem(item) === activeConversation)
      .filter((item) => activeTag === "all" || normalizeTags(item.tags).includes(activeTag))
      .filter((item) => !query || [
        item.question, item.context, item.notes, item.site, conversationTitleForItem(item), normalizeTags(item.tags).join(" ")
      ].some((value) => String(value || "").toLocaleLowerCase().includes(query)))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function renderList() {
    const visible = getVisibleItems();
    els.list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = els.search.value.trim() ? "没有匹配内容" : `还没有“${STATUS[activeStatus].label}”的问题`;
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
    card.style.setProperty("--status-color", STATUS[item.status]?.color || "#999");

    const meta = document.createElement("div");
    meta.className = "item-meta";
    if (item.status === "pending" || item.status === "inserted") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedIds.has(item.id);
      checkbox.setAttribute("aria-label", `选择：${item.question}`);
      checkbox.addEventListener("change", () => {
        checkbox.checked ? selectedIds.add(item.id) : selectedIds.delete(item.id);
        renderBulkbar();
      });
      meta.appendChild(checkbox);
    }
    const source = document.createElement(item.sourceUrl ? "a" : "span");
    source.textContent = item.site || "其他网页";
    if (item.sourceUrl) {
      source.href = item.sourceUrl;
      source.target = "_blank";
      source.rel = "noreferrer";
    }
    const time = document.createElement("time");
    time.textContent = formatTime(item.updatedAt);
    meta.append(source, time);

    const question = document.createElement("p");
    question.className = "item-question";
    question.textContent = item.question;
    card.append(meta, question);

    if (item.context) {
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
    const itemTags = normalizeTags(item.tags);
    if (itemTags.length) {
      const tags = document.createElement("div");
      tags.className = "item-tags";
      itemTags.forEach((tag) => {
        const chip = document.createElement("button");
        chip.className = "tag-chip";
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
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  async function saveEditor() {
    const question = els.question.value.trim();
    if (!question) return showToast("请先写下疑问", true);
    const now = new Date().toISOString();
    if (editingId) {
      const item = items.find((entry) => entry.id === editingId);
      if (item) Object.assign(item, {
        question, context: els.context.value.trim(), tags: parseTags(els.tags.value),
        notes: els.notes.value.trim(), updatedAt: now
      });
      showToast("已更新");
    } else {
      const source = normalizeSourceMeta(captureMeta || await currentTabMeta());
      items.push({
        id: crypto.randomUUID(), question, context: els.context.value.trim(), tags: parseTags(els.tags.value),
        notes: els.notes.value.trim(), status: "pending", site: source.site,
        sourceTitle: source.sourceTitle, sourceUrl: source.sourceUrl,
        conversationId: source.conversationId, conversationTitle: source.conversationTitle,
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
    els.question.value = item.question || "";
    els.context.value = item.context || "";
    els.tags.value = normalizeTags(item.tags).join(", ");
    els.notes.value = item.notes || "";
    els.details.open = Boolean(item.context || item.notes);
    els.save.textContent = "保存修改";
    els.cancelEdit.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
    els.question.focus();
  }

  function resetEditor() {
    editingId = null;
    captureMeta = null;
    els.question.value = "";
    els.context.value = "";
    els.tags.value = "";
    els.notes.value = "";
    els.details.open = false;
    els.save.textContent = "保存疑问";
    els.cancelEdit.classList.add("hidden");
  }

  async function setStatus(id, status) {
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    const now = new Date().toISOString();
    item.status = status;
    item.updatedAt = now;
    item[`${status}At`] = now;
    selectedIds.delete(id);
    await persistItems();
  }

  async function deleteItem(item) {
    if (!confirm(`删除这条疑问？\n\n${item.question}`)) return;
    items = items.filter((entry) => entry.id !== item.id);
    selectedIds.delete(item.id);
    if (editingId === item.id) resetEditor();
    await persistItems();
    showToast("已删除");
  }

  function renderBulkbar() {
    const available = activeStatus === "pending" || activeStatus === "inserted";
    els.bulkbar.classList.toggle("hidden", !available);
    if (!available) return;
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
    const all = visible.length && visible.every((item) => selectedIds.has(item.id));
    visible.forEach((item) => all ? selectedIds.delete(item.id) : selectedIds.add(item.id));
    render();
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
      await persistItems();
      showToast(`已追加 ${targetItems.length} 条；左侧已有输入未被覆盖`);
    } catch (error) {
      showToast(error.message || "无法连接当前页面；更新扩展后请刷新该页面", true);
    }
  }

  async function analyzeQuestions() {
    if (!items.length) return showToast("还没有可分析的问题", true);
    els.analyze.disabled = true;
    els.analyze.textContent = "千问分析中…";
    try {
      const safeItems = items.map(({ id, question, status }) => ({ id, question, status }));
      const response = await chrome.runtime.sendMessage({ type: "QQ_ANALYZE_MINDMAP", items: safeItems });
      if (!response?.ok) throw new Error(response?.error || "智能分析失败");
      mindMap = { ...response.mindMap, generatedAt: new Date().toISOString(), sourceCount: items.length };
      await chrome.storage.local.set({ [MINDMAP_KEY]: mindMap });
      renderMindMap();
      showToast("思维导图已生成");
    } catch (error) {
      showToast(error.message || "智能分析失败", true);
      if (/配置|Base URL|API Key/.test(error.message || "")) showView("settings");
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
      line.textContent = typeof question === "string" ? question : question.question;
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

  async function exportWord() {
    if (!items.length) return showToast("还没有可导出的内容", true);
    if (!globalThis.QuestionQueueDocx) return showToast("Word 导出模块未加载", true);
    els.word.disabled = true;
    try {
      const blob = await globalThis.QuestionQueueDocx.build(items, mindMap, "blob");
      downloadBlob(blob, `追问簿-${new Date().toISOString().slice(0, 10)}.docx`);
      showToast("Word 文档已导出");
    } catch (error) {
      showToast(`Word 导出失败：${error.message}`, true);
    } finally {
      els.word.disabled = false;
    }
  }

  function exportJson() {
    const payload = JSON.stringify({
      schemaVersion: 5, exportedAt: new Date().toISOString(), mindMap, items
    }, null, 2);
    downloadBlob(new Blob([payload], { type: "application/json" }),
      `question-queue-${new Date().toISOString().slice(0, 10)}.json`);
    showToast("已导出备份");
  }

  async function importJson(event) {
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
      await persistItems();
      showToast(`已合并导入，共 ${items.length} 条`);
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

  function renderSettings() {
    els.baseUrl.value = savedSettings.baseUrl || "";
    els.apiKey.value = "";
    els.apiKey.placeholder = savedSettings.apiKey ? "已保存；留空则不修改" : "请输入重新生成的 API Key";
    els.settingsState.textContent = savedSettings.apiKey && savedSettings.baseUrl
      ? "已配置 qwen3.8-max" : "尚未配置";
  }

  async function saveAiSettings() {
    const baseUrl = els.baseUrl.value.trim().replace(/\/+$/, "");
    const apiKey = els.apiKey.value.trim() || savedSettings.apiKey || "";
    if (!isAllowedBaseUrl(baseUrl)) return showToast("请填写阿里云百炼官方 Base URL", true);
    if (!apiKey) return showToast("请填写重新生成的 API Key", true);
    savedSettings = { baseUrl, apiKey, model: "qwen3.8-max", updatedAt: new Date().toISOString() };
    await chrome.storage.local.set({ [AI_SETTINGS_KEY]: savedSettings });
    renderSettings();
    showToast("AI 设置已保存");
  }

  async function clearAiSettings() {
    if (!confirm("清除本机保存的千问 Base URL 和 API Key？")) return;
    savedSettings = {};
    await chrome.storage.local.remove(AI_SETTINGS_KEY);
    renderSettings();
    showToast("AI 设置已清除");
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
    const sourceUrl = String(source.sourceUrl || derived.sourceUrl || "");
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
    const cleanTitle = cleanConversationTitle(title, site);
    return Sites.sourceKey(url, cleanTitle, site);
  }

  function cleanConversationTitle(title, site) {
    const value = Sites.cleanTitle(title, site);
    if (!value || value.toLocaleLowerCase() === String(site || "").toLocaleLowerCase()) return site ? `${site} 未命名来源` : "未命名来源";
    return value;
  }

  function parseTags(value) {
    return normalizeTags(String(value || "").split(/[,，;；\n]+/));
  }

  function normalizeTags(value) {
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    return Array.from(new Set(list.map((tag) => String(tag).trim().replace(/^#\s*/, "")).filter(Boolean))).slice(0, 20);
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
    showToast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 2800);
  }
})();
