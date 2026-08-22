# Architecture

Question Queue 是一个无构建步骤的 Manifest V3 扩展。运行时由三个部分组成。

## Background service worker

`background.js` 负责右键菜单、原生侧边栏、待输入徽标，以及用户主动触发的千问请求。请求集中在后台执行，避免把 API Key 注入模型网页，并限制可访问的接口域名。

## Content script

`content.js` 运行在支持的模型网站中，负责注入快捷按钮、查找输入框、追加问题、观察回答节点，以及提供旧浏览器兼容抽屉。内容脚本只接收需要填入的问题 ID 和文本，不读取或上传完整对话历史。

## Side panel

`sidepanel.html`、`sidepanel.css` 和 `sidepanel.js` 构成主要界面，负责问题管理、状态、筛选、对话身份、标签、导入导出、Word 文档、思维导图和模型设置。

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
  site: "ChatGPT",
  sourceTitle: "Page title",
  sourceUrl: "https://...",
  conversationId: "https://origin/path",
  conversationTitle: "Conversation title",
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

