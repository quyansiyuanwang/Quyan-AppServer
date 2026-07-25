# 推送聚合

推送聚合将一次业务消息投递到通用 Webhook、钉钉机器人、飞书机器人或企业微信机器人。渠道由实例隔离，可使用密钥托管别名引用渠道 Secret，凭据不会写入投递日志或回传到控制台。

## 配置渠道

在控制台为每个渠道填写名称、类型、HTTP(S) 地址和可选密钥别名。渠道可独立启停、编辑或删除。渠道管理权限与投递日志读取权限分开，方便为运维和业务服务分配最小权限。

## 统一发送 API

发送需要推送发送权限：

```http
POST /v1/products/push/send
Authorization: Bearer dpk_...
Content-Type: application/json

{
  "channelIds": ["channel_id_1", "channel_id_2"],
  "title": "部署完成",
  "content": "production 已更新",
  "idempotencyKey": "deploy-2026-07-24-001"
}
```

响应逐渠道返回成功状态、错误摘要、尝试次数和后续重试时间。一个渠道失败不会阻止其他渠道投递；建议对同一业务事件稳定复用 `idempotencyKey`，避免网络重试产生重复通知。标题最长 200 字符，正文最长 10,000 字符，单次最多选择 20 个渠道。
