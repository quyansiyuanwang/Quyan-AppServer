# 验证码

验证码服务负责生成、投递、校验和防刷。使用场景包括注册、登录、敏感操作确认和邮箱验证。验证码只保存哈希、用途、到期时间、剩余尝试次数和使用状态；成功验证后立即失效。

## 发送与校验

发送需要验证码发送权限：

```http
POST /v1/products/verification/send
Authorization: Bearer sk-dpk-...
Content-Type: application/json

{ "channel": "email", "recipient": "user@example.com", "purpose": "signup" }
```

校验需要独立的验证码校验权限。调用 `POST /v1/products/verification/verify`，在相同的 `channel`、`recipient` 和 `purpose` 基础上追加 6 位 `code`。响应中的 `data.valid` 为 `true` 表示校验成功，该验证码不可再次使用；`false` 表示未通过，例如验证码错误、过期或已使用。

验证码有效期为 10 分钟，最多允许 5 次错误尝试。同一实例中，向同一接收方发送相同用途的新验证码后，旧验证码失效，即使发送渠道不同。

## 通道、限流与计费

邮件复用平台 SMTP；短信由已启用的供应商适配器提供。未配置的通道会返回明确业务错误，不会伪装为发送成功。系统按项目、接收方、来源 IP 和用途限流。发送请求成功后计入用量，额度和超额费用以当前产品配置为准；发送失败会退回所消耗的额度。SMTP 或短信接口接受请求不保证消息最终送达。校验接口不计入产品用量。
