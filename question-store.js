((root) => {
  const STATUS_KEYS = ["note", "pending", "inserted", "answered", "learned"];
  const ITEM_KINDS = ["note", "question"];
  const SOURCE_TYPES = ["article", "chat", "page"];
  const DEFAULT_FILL_PREFIX = "请依次回答以下问题，并保留编号：";
  const MAX_TAGS = 20;
  const LIMITS = { id: 120, question: 4000, context: 20000, content: 20000, notes: 8000, title: 300, tag: 40, key: 400 };

  function text(value, limit) {
    return String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, limit);
  }

  function normalizeTags(value) {
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    return Array.from(new Set(list
      .map((tag) => String(tag).trim().replace(/^#\s*/, "").slice(0, LIMITS.tag))
      .filter(Boolean))).slice(0, MAX_TAGS);
  }

  function parseTags(value) {
    return normalizeTags(String(value || "").split(/[,，;；\n]+/));
  }

  // Imported backups may carry javascript: or data: links, so links are rebuilt instead of trusted.
  function safeHttpUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function isoTime(value, fallback) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  }

  function sanitizeItem(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const id = text(raw.id, LIMITS.id);
    const kind = raw.kind === "note" || raw.status === "note" ? "note" : "question";
    const question = text(raw.question, LIMITS.question);
    const title = text(raw.title, LIMITS.title);
    const content = text(raw.content || (kind === "note" ? raw.context : ""), LIMITS.content);
    if (!id || (kind === "question" ? !question : !(title || content || question))) return null;
    const now = new Date().toISOString();
    const createdAt = isoTime(raw.createdAt, now);
    const item = {
      id,
      kind,
      title,
      content,
      question,
      status: kind === "note" ? "note" : (STATUS_KEYS.includes(raw.status) && raw.status !== "note" ? raw.status : "pending"),
      context: text(raw.context, LIMITS.context),
      notes: text(raw.notes, LIMITS.notes),
      tags: normalizeTags(raw.tags),
      site: text(raw.site, LIMITS.title),
      sourceType: SOURCE_TYPES.includes(raw.sourceType) ? raw.sourceType : "page",
      sourceTitle: text(raw.sourceTitle, LIMITS.title),
      sourceUrl: safeHttpUrl(raw.sourceUrl),
      conversationId: text(raw.conversationId || raw.sourceId, LIMITS.key),
      conversationTitle: text(raw.conversationTitle || raw.sourceTitle, LIMITS.title),
      parentNoteId: text(raw.parentNoteId, LIMITS.id),
      answerUrl: safeHttpUrl(raw.answerUrl),
      createdAt,
      updatedAt: isoTime(raw.updatedAt, createdAt)
    };
    ["pendingAt", "insertedAt", "answeredAt", "learnedAt"].forEach((key) => {
      if (raw[key]) item[key] = isoTime(raw[key], item.updatedAt);
    });
    return item;
  }

  function mergeImportedItems(existing, incoming) {
    const items = Array.isArray(existing) ? existing.slice() : [];
    const position = new Map(items.map((item, index) => [item.id, index]));
    let added = 0;
    let replaced = 0;
    let skipped = 0;
    (Array.isArray(incoming) ? incoming : []).forEach((raw) => {
      const item = sanitizeItem(raw);
      if (!item) {
        skipped += 1;
        return;
      }
      const index = position.get(item.id);
      if (index === undefined) {
        position.set(item.id, items.length);
        items.push(item);
        added += 1;
        return;
      }
      items[index] = item;
      replaced += 1;
    });
    return { items, added, replaced, skipped };
  }

  function questionKey(value) {
    return String(value || "")
      .toLocaleLowerCase()
      .replace(/\s+/g, "")
      .replace(/[?？!！。.,，、；;：:"'“”‘’()（）]+/g, "");
  }

  function findDuplicate(items, question, excludeId = "") {
    const key = questionKey(question);
    if (!key) return null;
    return (Array.isArray(items) ? items : [])
      .find((item) => item.id !== excludeId && questionKey(item.question) === key) || null;
  }

  function findDuplicateNote(items, candidate) {
    const contentKey = questionKey(candidate?.content);
    if (!contentKey) return null;
    const sourceUrl = safeHttpUrl(candidate?.sourceUrl);
    return (Array.isArray(items) ? items : []).find((item) =>
      item?.kind === "note" && questionKey(item.content) === contentKey &&
      (!sourceUrl || safeHttpUrl(item.sourceUrl) === sourceUrl)
    ) || null;
  }

  function branchQuestionText(entry) {
    return typeof entry === "string" ? entry : String(entry?.question || "");
  }

  function pruneBranches(branches, keys) {
    return (Array.isArray(branches) ? branches : []).reduce((kept, branch) => {
      if (!branch || typeof branch !== "object") return kept;
      const questions = (Array.isArray(branch.questions) ? branch.questions : [])
        .filter((entry) => keys.has(questionKey(branchQuestionText(entry))));
      const children = pruneBranches(branch.children, keys);
      if (questions.length || children.length) kept.push({ ...branch, questions, children });
      return kept;
    }, []);
  }

  // A partial export should only carry the mind map branches that match the exported questions.
  function filterMindMap(mindMap, items) {
    if (!mindMap || !Array.isArray(mindMap.branches)) return null;
    const keys = new Set((Array.isArray(items) ? items : [])
      .map((item) => questionKey(item?.question))
      .filter(Boolean));
    if (!keys.size) return null;
    const branches = pruneBranches(mindMap.branches, keys);
    return branches.length ? { ...mindMap, branches, sourceCount: keys.size } : null;
  }

  function buildFillText(items, prefix = DEFAULT_FILL_PREFIX) {
    const questions = (Array.isArray(items) ? items : [])
      .map((item) => String(item?.question || "").trim())
      .filter(Boolean);
    if (!questions.length) return "";
    if (questions.length === 1) return questions[0];
    const numbered = questions.map((question, index) => `${index + 1}. ${question}`).join("\n\n");
    const head = String(prefix ?? DEFAULT_FILL_PREFIX).trim();
    return head ? `${head}\n\n${numbered}` : numbered;
  }

  root.QuestionQueueStore = Object.freeze({
    STATUS_KEYS,
    ITEM_KINDS,
    SOURCE_TYPES,
    DEFAULT_FILL_PREFIX,
    MAX_TAGS,
    normalizeTags,
    parseTags,
    safeHttpUrl,
    sanitizeItem,
    mergeImportedItems,
    questionKey,
    findDuplicate,
    findDuplicateNote,
    filterMindMap,
    buildFillText
  });
})(globalThis);
