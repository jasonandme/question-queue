import assert from "node:assert/strict";
import "../site-adapters.js";

const Sites = globalThis.QuestionQueueSites;

function fakeDocument(entries) {
  return {
    querySelector(selector) {
      const value = entries[selector];
      if (!value) return null;
      if (typeof value === "string") return { textContent: value };
      return value;
    }
  };
}

assert.equal(Sites.getSiteName("blog.csdn.net"), "CSDN");
assert.equal(Sites.getSiteName("https://zhuanlan.zhihu.com/p/123"), "知乎");
assert.equal(Sites.isLearningSite("www.zhihu.com"), true);
assert.equal(Sites.isChatSite("chatgpt.com"), true);
assert.equal(Sites.isChatSite("blog.csdn.net"), false);

const csdn = Sites.deriveSourceMeta({
  url: "https://blog.csdn.net/reader/article/details/123?utm_source=share",
  title: "浏览器标签标题 - CSDN博客",
  document: fakeDocument({
    "link[rel='canonical']": { href: "https://blog.csdn.net/reader/article/details/123?utm_source=share" },
    "h1.title-article": "如何理解事件循环 - CSDN博客"
  })
});

assert.deepEqual(csdn, {
  site: "CSDN",
  sourceType: "article",
  sourceTitle: "如何理解事件循环",
  sourceUrl: "https://blog.csdn.net/reader/article/details/123",
  sourceId: "https://blog.csdn.net/reader/article/details/123"
});

const zhihu = Sites.deriveSourceMeta({
  url: "https://www.zhihu.com/question/123/answer/456?utm_campaign=share",
  title: "备用标题 - 知乎",
  document: fakeDocument({
    "link[rel='canonical']": { href: "https://www.zhihu.com/question/123/answer/456" },
    "h1.QuestionHeader-title": "怎样建立自己的知识体系？"
  })
});

assert.equal(zhihu.site, "知乎");
assert.equal(zhihu.sourceType, "article");
assert.equal(zhihu.sourceTitle, "怎样建立自己的知识体系？");
assert.equal(zhihu.sourceId, "https://www.zhihu.com/question/123/answer/456");

const chat = Sites.deriveSourceMeta({
  url: "https://chatgpt.com/c/abc?temporary-chat=false",
  title: "学习计划 - ChatGPT"
});

assert.equal(chat.site, "ChatGPT");
assert.equal(chat.sourceType, "chat");
assert.equal(chat.sourceTitle, "学习计划");
assert.equal(chat.sourceId, "https://chatgpt.com/c/abc");

console.log("Site adapter tests passed: CSDN, 知乎, ChatGPT");
