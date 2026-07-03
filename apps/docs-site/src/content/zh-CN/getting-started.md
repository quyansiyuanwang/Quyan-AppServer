# 用户手册

这是站点公开的双语用户手册。整体布局保持 API 文档站的阅读节奏，但内容改为按真实界面逐页说明，重点是“用户怎么用”。

## 手册如何组织

- 每个 Vue 页面对应一篇手册页面。
- 每篇页面都会说明可见区域、常见操作和使用说明。
- API 风格的参考内容仍会保留为独立页面，例如 `api-documentation`。

## 如何使用

1. 从左侧目录或搜索框查找页面。
2. 打开与你当前正在使用的界面同名的文档页。
3. 切换语言时保持当前文档页不变。
4. 需要分享帮助时，直接复制当前页面链接。

## 覆盖内容

- 登录、验证和找回密码
- 首页、聊天、设置与通知页面
- 余额、月卡、转发 Token 和转发设置
- 管理、系统、日志、OJ 与 API 参考页面
- 也覆盖应用审核、认证中心审核和用户在线监控等后台功能页

## 搜索建议

- 按页面名称搜索。
- 按 `balance`、`relay`、`permission` 等标签搜索。
- 按 reset、copy、publish、verify 等具体操作搜索。

## 快捷链接

- 应用：{{APP_BASE_URL}}
- API 文档：{{SWAGGER_DOCS_URL}}
- 用户手册：{{DOCS_BASE_URL}}

## SDK 与 Demo 入口

- 如果你只需要快速调通接口，优先查看文档站内的 `Node SDK`、`Python SDK` 和 `OAuth Demo`。
- 如果你希望直接拿到可运行工程、集成模板或更完整的示例集合，请优先查看 `Quyan-ServerSDK` 目录约定。
- `Quyan-ServerSDK` 用于按场景提供更合适的 SDK 或 Demo，例如 `ServerSDK/demos/oauth/node/` 这类完整流程示例，以及 `ServerSDK/sdks/oauth/*` 这类多语言接入模板。

## 示例路由

```text
{{DOCS_BASE_URL}}/zh-CN/login-register
```
