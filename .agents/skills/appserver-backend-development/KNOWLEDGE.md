## 后端目录

- Controller：`apps/backend/src/api/controllers/`
- DTO：`apps/backend/src/api/dto/`
- Service：`apps/backend/src/services/`
- Prisma Repository/Store：`apps/backend/src/store/`
- Middleware：`apps/backend/src/middleware/`
- Schema 与迁移：`apps/backend/prisma/`
- TSOA 生成产物：`apps/backend/src/build/`，禁止编辑

## 契约与运行时

- 路由由 TSOA 装饰器生成。标准响应为 `{ code, message, data? }`。
- 使用 `src/util/errors.ts` 中既有错误类、`jwt`/`relay-token`/`local-or-jwt` 认证方案、`@CheckPermission`、`@ReplayProtected` 和 `@TwoFactorChallengeProtected`。
- `src/app.ts` 的中间件顺序不可随意调整：响应包装在生成路由之前，异常处理保持在最后。

## Relay 规则

- `ModelPricing.model` 是目录模型身份；解析后的请求/上游模型 ID 是另一身份域。
- 模型限制、映射、格式与叶子渠道身份必须在同一池路由上保持关联。
- 面向用户的 options 只能返回安全的能力与配置状态，不能返回密钥或物理混池拓扑。

## 常用命令

```bash
pnpm --filter @appserver/backend run type-check
pnpm --filter @appserver/backend run test:unit
pnpm --filter @appserver/backend run test:database
pnpm --filter @appserver/backend run test:integration
pnpm --filter @appserver/backend run test:contract
pnpm run openapi:gen:all
pnpm run db:migrate:dev -- <migration-name>
```
