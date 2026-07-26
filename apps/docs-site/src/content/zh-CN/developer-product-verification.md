# 验证码

验证码服务负责生成、投递、校验和防刷。使用场景包括注册、登录、敏感操作确认和邮箱验证。验证码只保存哈希、用途、到期时间、剩余尝试次数和使用状态；成功验证后立即失效。

## 发送与校验

发送需要验证码发送权限：

```http
POST /v1/products/verification/send
Authorization: Bearer dpk_...
Content-Type: application/json

{ "channel": "email", "recipient": "user@example.com", "purpose": "signup" }
```

校验使用 `POST /v1/products/verification/verify`，在相同的 `channel`、`recipient` 和 `purpose` 基础上追加 6 位 `code`。响应 `{ "valid": true }` 后不可再次使用该验证码。

## 通道、限流与计费

邮件复用平台 SMTP；短信由已启用的供应商适配器提供。未配置的通道会返回明确业务错误，不会伪装为发送成功。系统按项目、接收方、来源 IP 和用途限流。只有实际成功投递的验证码消耗额度或产生超额扣费，校验失败不收费。
