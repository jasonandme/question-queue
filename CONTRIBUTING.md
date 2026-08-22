# Contributing

感谢你愿意改进 Question Queue。项目保持原生 Manifest V3 结构，不使用打包器，目的是让审查和本地加载尽量直接。

## 开始之前

1. 搜索现有 issue，确认问题没有被重复报告。
2. 对较大的功能先开 issue，说明使用场景、数据变化和权限变化。
3. 不要在 issue、截图、测试数据或提交记录中包含真实对话、API Key、邮箱、账号标识和本机路径。

## 本地开发

1. Fork 并克隆仓库。
2. 在 Edge 或 Chrome 的扩展管理页加载仓库根目录。
3. 修改后点击“重新加载”，并刷新测试页面。
4. 至少在一个英文界面站点和一个中文界面站点验证相关改动。

## 提交前检查

```bash
node --check background.js
node --check content.js
node --check sidepanel.js
node --check docx-export.js
node scripts/validate.mjs
```

涉及输入框的改动还应验证原有草稿不会被覆盖、扩展不会自动发送消息，并且找不到输入框时会给出可理解的错误提示。

涉及存储格式的改动应保持旧数据可读，并同步更新架构文档、导入导出和 Word 导出。

## Pull request

PR 描述应包含要解决的问题、实现取舍、权限和数据变化、手动测试的浏览器与站点。界面截图必须使用虚构内容。

提交信息建议采用 `feat:`、`fix:`、`docs:`、`refactor:`、`test:` 或 `chore:` 前缀。

## 站点适配

选择器应从最具体到最通用排列，并只选择可见、可编辑的元素。不要依赖随机生成的 CSS 类名。新增站点时需要同步修改 manifest 权限和 README 支持列表，并说明为什么需要对应权限。

