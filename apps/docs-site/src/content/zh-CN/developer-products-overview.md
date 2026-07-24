# 开发者产品

在产品控制台创建实例，再创建绑定调用 RAM 主体的 API Key。请求使用 `Authorization: Bearer dpk_...`。

Key 会实时继承其绑定主体的 RAM 权限。停用实例会立即拒绝外部 API 调用；写入的密钥明文永不回传。
