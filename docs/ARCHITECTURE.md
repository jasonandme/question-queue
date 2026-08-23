# Architecture

追问簿（Question Queue）是一个无构建步骤的 Manifest V3 扩展。运行时由三个部分组成。

## Background service worker

`background.js` 负责右键菜单、原生侧边栏、待输入徽标，以及用户主动触发的千问请求。请求集中在后台执行，避免把 API Key 注入模型网页，并限制可访问的接口域名。

## Content script

`content.js` 运行在支持的大模型与知识学习网站中，负责注入快捷按钮、采集页面来源，以及提供旧浏览器兼容抽屉。只有站点适配器判定为大模型对话时，内容脚本才会查找输入框、追加问题和观察回答节点；CSDN、知乎等知识页不会修改评论框。

`site-adapters.js` 是共享的纯 JavaScript 适配层。后台、侧边栏和内容脚本使用同一组站点规则，统一识别站点类型、正文标题、canonical URL 与稳定来源标识。

## Side panel

`sidepanel.html`、`sidepanel.css` 和 `sidepanel.js` 构成主要界面，负责问题管理、状态、来源筛选、标签、导入导出、Word 文档、思维导图和模型设置。

## Storage schema

主数据位于 `chrome.storage.local` 的 `questionQueueItems`。

```js
{
  id: "uuid",
  question: "...",
  context: "...",
  notes: "...",
  tags: ["research", "review"],
  status: "pending | inserted | answered | learned",
  site: "CSDN",
  sourceType: "article | chat | page",
  sourceTitle: "Article or conversation title",
  sourceUrl: "https://...",
  conversationId: "stable source id (legacy field name)",
  conversationTitle: "source title (legacy field name)",
  createdAt: "ISO timestamp",
  updatedAt: "ISO timestamp"
}
```

旧记录缺少新增字段时，界面采用惰性兼容：标签视为空数组，对话字段从来源 URL 和标题推导。

其他存储键包括最近一次思维导图、用户配置的模型设置，以及划词后在后台与侧边栏之间传递的一次性草稿。

## Message flow

1. 用户在侧边栏选择问题并点击填入。
2. 侧边栏向当前标签页发送 `QQ_APPEND_QUESTIONS`。
3. 内容脚本找到可见输入框，保留已有文本并追加问题。
4. 侧边栏把相关记录更新为 `inserted`。
5. 内容脚本观察到新的回答节点后，可将其更新为 `answered`。

状态变化写入本地存储，已打开的界面通过 `chrome.storage.onChanged` 同步。

