# Architecture

追问簿（Question Queue）是一个无构建步骤的 Manifest V3 扩展。运行时由后台、内容脚本和侧边栏三部分组成，另有两个共享的纯函数层。

## 共享纯函数层

`site-adapters.js` 负责站点识别：站点类型、正文标题、canonical URL 与稳定来源标识。后台、侧边栏和内容脚本使用同一组站点规则。

`question-store.js` 负责数据规则：记录字段清洗、导入合并、重复问题识别、按导出范围裁剪思维导图，以及批量填入文本的拼装。两个文件都不访问 `chrome.*` 与 DOM，因此可以直接在 Node 中运行单元测试（`scripts/test-site-adapters.mjs`、`scripts/test-question-store.mjs`）。

清洗按白名单重建对象，链接只保留 http/https，字段长度有上限。导入外部 JSON 时必须经过 `sanitizeItem`，避免把 `javascript:` 之类的链接写进本地存储并渲染成可点击元素。

## Background service worker

`background.js` 负责右键菜单、原生侧边栏、待输入徽标，以及用户主动触发的千问请求。右键菜单在 `onInstalled` 与 `onStartup` 时先移除再创建，避免扩展重载后重复注册失败。

千问请求集中在后台执行，避免把 API Key 注入模型网页，并限制可访问的接口域名。模型名称来自用户设置，未设置时回退到 `qwen-max`。

## Content script

`content.js` 只做三件事：注入右下角快捷按钮（含待输入计数）、把问题追加到大模型输入框、在填入后观察回答节点。清单浏览、编辑、筛选与导入导出都在侧边栏完成，页面内不再维护第二份内存副本，也不再渲染抽屉界面。

只有站点适配器判定为大模型对话时，内容脚本才会查找输入框、追加问题和观察回答节点；CSDN、知乎等知识页不会修改评论框。

回答观察有三重约束：采样节流、内容稳定后延迟确认、总时长超时后自动断开 observer。观察根优先选择 `main`、`[role='main']`、`#__next` 或 `#root`，而不是整个 `document.body`。写回状态前会重新读取存储，避免用陈旧快照覆盖用户在侧边栏的编辑。

## Side panel

`sidepanel.html`、`sidepanel.css` 和 `sidepanel.js` 构成主要界面，负责问题管理、状态、来源筛选、标签、导入导出、Word 文档、思维导图和模型设置。搜索输入带防抖；写入存储失败时会提示并回滚到已保存状态；界面跟随系统深色模式，状态与视图切换带 ARIA 语义。

JSZip 与 `docx-export.js` 只在侧边栏加载，不再注入匹配到的网页。

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
  answerUrl: "https://... (page where the answer was observed)",
  conversationId: "stable source id (legacy field name)",
  conversationTitle: "source title (legacy field name)",
  createdAt: "ISO timestamp",
  updatedAt: "ISO timestamp"
}
```

旧记录缺少新增字段时，界面采用惰性兼容：标签视为空数组，来源类型回退为 `page`，对话字段从来源 URL 和标题推导。

其他存储键包括最近一次思维导图、用户配置的模型设置、界面偏好（填入提示语模板），以及划词后在后台与侧边栏之间传递的一次性草稿。

## Message flow

1. 用户在侧边栏选择问题并点击填入。
2. 侧边栏向当前标签页发送 `QQ_APPEND_QUESTIONS`，同时带上填入提示语模板。
3. 内容脚本找到可见输入框，保留已有文本并追加问题。
4. 侧边栏把相关记录更新为 `inserted`。
5. 内容脚本观察到新的回答节点后，将其更新为 `answered` 并记录回答所在页面。

状态变化写入本地存储，已打开的界面通过 `chrome.storage.onChanged` 同步。
