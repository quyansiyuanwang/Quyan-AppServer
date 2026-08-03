## 共享包

`packages/shared/src/` 是共享类型与常量的唯一规范源：

- `permission.ts`：`Permission`、`ALL_PERMISSIONS` 与分类 helper
- `custom-code.ts`：业务错误码
- `status.ts`、`relay-channel.ts`：通用状态
- `client-fingerprint.ts`、`feedback.ts`、`legal-policy.ts`、`notification-event.ts`：领域契约

前后端都必须 re-export shared permission enum。权限改动后运行 `pnpm run validate:permissions`。

## OpenAPI 流水线

```text
Controller 与 DTO -> TSOA -> backend swagger.json
-> sync-swagger-to-frontend.mjs -> frontend swagger.json
-> @hey-api/openapi-ts -> apps/frontend/src/client/
```

```bash
pnpm run openapi:gen
pnpm run openapi:sync
pnpm run openapi:gen:all
```

即使只运行局部测试，Controller/DTO 改动也必须生成。DTO 在适用处使用 TSOA 校验装饰器，响应格式为 `{ code, message, data? }`。
