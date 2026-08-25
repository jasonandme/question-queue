import assert from "node:assert/strict";
import "../question-store.js";

const Store = globalThis.QuestionQueueStore;

// Tags accept several separators and drop duplicates, blanks and leading hashes.
assert.deepEqual(Store.parseTags("工作, 学习方法；待验证\n工作"), ["工作", "学习方法", "待验证"]);
assert.deepEqual(Store.parseTags("  "), []);
assert.deepEqual(Store.normalizeTags(["#前端", " 前端 ", ""]), ["前端"]);
assert.equal(Store.normalizeTags(Array.from({ length: 40 }, (_, i) => `t${i}`)).length, Store.MAX_TAGS);

// Only http(s) links survive, so imported backups cannot smuggle script URLs.
assert.equal(Store.safeHttpUrl("https://chatgpt.com/c/abc"), "https://chatgpt.com/c/abc");
assert.equal(Store.safeHttpUrl("javascript:alert(1)"), "");
assert.equal(Store.safeHttpUrl("data:text/html,<script>"), "");
assert.equal(Store.safeHttpUrl("not a url"), "");
assert.equal(Store.safeHttpUrl(""), "");

// sanitizeItem rebuilds records from a whitelist and rejects unusable input.
assert.equal(Store.sanitizeItem(null), null);
assert.equal(Store.sanitizeItem("q1"), null);
assert.equal(Store.sanitizeItem([{ id: "1", question: "q" }]), null);
assert.equal(Store.sanitizeItem({ question: "缺少 id" }), null);
assert.equal(Store.sanitizeItem({ id: "1", question: "   " }), null);

const sanitized = Store.sanitizeItem({
  id: "1",
  question: " 事件循环怎么调度微任务？ ",
  status: "hacked",
  sourceType: "unknown",
  sourceUrl: "javascript:alert(1)",
  answerUrl: "https://chatgpt.com/c/abc",
  tags: ["#前端", "前端"],
  createdAt: "not-a-date",
  evil: "<script>alert(1)</script>"
});

assert.equal(sanitized.question, "事件循环怎么调度微任务？");
assert.equal(sanitized.status, "pending");
assert.equal(sanitized.sourceType, "page");
assert.equal(sanitized.sourceUrl, "");
assert.equal(sanitized.answerUrl, "https://chatgpt.com/c/abc");
assert.deepEqual(sanitized.tags, ["前端"]);
assert.equal("evil" in sanitized, false);
assert.equal(Number.isNaN(new Date(sanitized.createdAt).getTime()), false);

const truncated = Store.sanitizeItem({ id: "2", question: "问".repeat(5000) });
assert.equal(truncated.question.length, 4000);

// Legacy backups without sourceId keep their conversation grouping fields.
const legacy = Store.sanitizeItem({
  id: "3", question: "旧记录", sourceId: "https://chatgpt.com/c/old", sourceTitle: "旧对话"
});
assert.equal(legacy.conversationId, "https://chatgpt.com/c/old");
assert.equal(legacy.conversationTitle, "旧对话");

// Import merges by id: same id replaces, new id appends, broken entries are skipped.
const merged = Store.mergeImportedItems(
  [{ id: "1", question: "原有问题", status: "pending" }],
  [
    { id: "1", question: "更新后的问题", status: "answered" },
    { id: "2", question: "新问题" },
    { question: "没有 id" },
    null
  ]
);

assert.equal(merged.added, 1);
assert.equal(merged.replaced, 1);
assert.equal(merged.skipped, 2);
assert.equal(merged.items.length, 2);
assert.equal(merged.items[0].question, "更新后的问题");
assert.equal(merged.items[0].status, "answered");
assert.equal(merged.items[1].id, "2");

const emptyImport = Store.mergeImportedItems(undefined, undefined);
assert.deepEqual(emptyImport, { items: [], added: 0, replaced: 0, skipped: 0 });

// Duplicate detection ignores case, spacing and trailing punctuation.
const existing = [{ id: "1", question: "事件循环怎么调度微任务？" }];
assert.equal(Store.findDuplicate(existing, "事件循环 怎么调度微任务")?.id, "1");
assert.equal(Store.findDuplicate(existing, "Event Loop"), null);
assert.equal(Store.findDuplicate(existing, "事件循环怎么调度微任务？", "1"), null);
assert.equal(Store.findDuplicate(existing, "   "), null);
assert.equal(Store.findDuplicate([{ id: "1", question: "Event Loop?" }], "event loop")?.id, "1");

// Fill text: one question stays raw, several get the prefix plus numbering.
assert.equal(Store.buildFillText([]), "");
assert.equal(Store.buildFillText([{ question: "只有一条" }]), "只有一条");
assert.equal(
  Store.buildFillText([{ question: "第一条" }, { question: "第二条" }]),
  `${Store.DEFAULT_FILL_PREFIX}\n\n1. 第一条\n\n2. 第二条`
);
assert.equal(
  Store.buildFillText([{ question: "第一条" }, { question: "第二条" }], "  "),
  "1. 第一条\n\n2. 第二条"
);
assert.equal(
  Store.buildFillText([{ question: "第一条" }, { question: "第二条" }], "自定义提示"),
  "自定义提示\n\n1. 第一条\n\n2. 第二条"
);
assert.equal(Store.buildFillText([{ question: "  " }, { question: "有效" }]), "有效");

// A scoped export keeps only the mind map branches whose questions are exported.
const fullMap = {
  title: "问题知识结构",
  summary: "概览",
  branches: [
    { title: "前端", questions: ["事件循环怎么调度微任务？"], children: [] },
    {
      title: "后端",
      questions: [],
      children: [{ title: "数据库", questions: [{ question: "索引什么时候失效" }] }]
    },
    { title: "无关主题", questions: ["完全没有导出的问题"] }
  ]
};

const scopedMap = Store.filterMindMap(fullMap, [{ question: "事件循环 怎么调度微任务" }]);
assert.equal(scopedMap.branches.length, 1);
assert.equal(scopedMap.branches[0].title, "前端");
assert.equal(scopedMap.summary, "概览");
assert.equal(scopedMap.sourceCount, 1);

const nestedMap = Store.filterMindMap(fullMap, [{ question: "索引什么时候失效" }]);
assert.equal(nestedMap.branches.length, 1);
assert.equal(nestedMap.branches[0].title, "后端");
assert.equal(nestedMap.branches[0].questions.length, 0);
assert.equal(nestedMap.branches[0].children[0].title, "数据库");

assert.equal(Store.filterMindMap(fullMap, [{ question: "从未出现过的问题" }]), null);
assert.equal(Store.filterMindMap(fullMap, []), null);
assert.equal(Store.filterMindMap(null, [{ question: "任意" }]), null);
assert.equal(Store.filterMindMap({ branches: [] }, [{ question: "任意" }]), null);

console.log("Question store tests passed: sanitize, merge, duplicate, mind map scope, fill text, tags");
