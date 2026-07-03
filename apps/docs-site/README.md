# AppServer Docs Site

`docsSite` 是仓库内独立的公开文档站点，基于 Vue 3 + Vite 构建，负责承载双语文档、站内导航，以及跳转到 Swagger 文档等入口。

## 技术栈

- Vue 3
- TypeScript
- Vite
- Vue Router
- `marked` 渲染 Markdown
- `mermaid` 渲染图表

## 环境要求

- `Node.js` `^20.19.0 || >=22.12.0`
- `pnpm`

## 常用命令

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm run build:prod
pnpm run preview
pnpm run lint
pnpm run lint-format-check
```

## 环境变量

项目已支持 `.env`、`.env.prod`、`.env.prod.local`。

常用变量：

```env
VITE_BACKEND_URL=http://localhost:10001
VITE_APP_BASE_URL=https://qysyw.cn
VITE_APP_DOCS_BASE_URL=http://localhost:4173
VITE_SWAGGER_DOCS_URL=http://localhost:10001/docs
```

说明：

- `VITE_BACKEND_URL`：后端 API 基地址，默认也用于推导 Swagger 地址
- `VITE_APP_BASE_URL`：主站地址
- `VITE_APP_DOCS_BASE_URL`：当前文档站地址
- `VITE_SWAGGER_DOCS_URL`：Swagger 文档地址，可显式覆盖

相关逻辑位于 `docsSite/src/config/site.ts`。

## 本地开发

```bash
pnpm run dev
```

默认端口：`http://localhost:4173`

生产模式本地联调可使用：

```bash
pnpm run prod
```

在 `prod` 模式下，Vite 代理会将 `/prod-api/*` 转发到 `https://api.qysyw.cn`。

## 路由结构

- `/` → 重定向到 `/zh-CN/getting-started`
- `/:locale(en|zh-CN)?/:slug?` → 文档详情页

路由定义位于 `docsSite/src/router/index.ts`。

## 目录结构

```text
docsSite/
  src/
    config/       # 站点 URL 与内容插值逻辑
    router/       # 路由定义
    views/        # 页面视图
    components/   # 文档站组件
    styles/       # 全局样式
  public/         # 静态资源
```

## 职责边界

- 承载公开文档与说明性内容
- 提供指向主站与 Swagger 的链接
- 不直接承担主业务前端逻辑

## 许可证

- 本项目使用 `Apache-2.0`，见 `docsSite/LICENSE`

## 校验建议

提交前建议执行：

```bash
pnpm run lint-format-check
pnpm run build
```
