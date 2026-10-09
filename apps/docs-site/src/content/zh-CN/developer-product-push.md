# 推送聚合

推送聚合将一次业务消息投递到通用 Webhook、钉钉机器人、飞书机器人或企业微信机器人。渠道由实例隔离，可使用密钥托管别名引用渠道 Secret，托管密钥的明文不会通过渠道管理响应回传到控制台。

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

响应逐渠道返回成功状态、安全失败分类、尝试次数和后续重试时间。一个渠道失败不会阻止其他渠道投递；建议对同一业务事件稳定复用 `idempotencyKey`，避免网络重试产生重复通知。标题最长 200 字符，正文最长 10,000 字符，单次最多选择 20 个渠道。

## 项目渠道资源授权

在 IAM enforce 模式下，JWT 项目管理可授权单个渠道。资源 ARN 为 `acs:developer:*:<accountId>:push-channel/<projectId>/<channelId>`；accountId 来自认证上下文，资源 ID 必须与存储的大小写完全一致。

- `quyan:developer:CreatePushChannel` 在指定项目 ARN 上控制创建，不自动授予新渠道的查看、修改或删除权限。
- `quyan:developer:ListPushChannels` 逐渠道控制配置查看。该操作属于敏感访问：地址可能包含您录入的凭据，应优先使用托管密钥引用，谨慎授予配置读取权限。
- `quyan:developer:UpdatePushChannel` 和 `DeletePushChannel` 分别控制指定渠道的修改和删除，不自动授予发送消息或读取投递日志的权限。

### 单独授权密钥使用

选择托管密钥、替换引用，或在保留引用时修改目标地址、重新启用渠道，还必须拥有该密钥的 `quyan:developer:UseSecret`，其资源为 `acs:developer:*:<accountId>:secret/<vaultProjectId>/<ALIAS>`。仅有渠道管理、密钥元数据或密钥写入权限不满足此条件；匹配的 Deny 仍优先。此权限允许把指定凭据配置到外部请求目标，属于高风险能力，不是获取密钥明文的接口。

引用必须来自渠道项目同一存储所有者的有效密钥托管实例，密钥别名及其底层项目必须有效。管理流程只查询引用元数据，不解密密钥，也不更新使用时间。单独改名、暂停渠道不要求密钥使用权限；删除引用并同时修改地址是原子操作，不保留旧凭据。失效或缺少实例的旧引用需要重新选择，才能修改地址或重新启用。

服务端在事务内复核授权时看到的渠道配置和密钥目标。若配置、引用或实例底层项目并发变化，请求安全失败；不会自动重试或沿用旧授权发布新配置。写入仍经过 HTTP(S)/SSRF 校验。

### 列表与授权范围

`GET /v1/developer/projects/{projectId}/push-channels/page` 接受 page/pageSize，返回 items、page、pageSize、hasNext 和每项 resourceArn。候选先限定当前账户的有效项目，再逐渠道授权；不返回未授权总数，空页仍可能有下一页。enforce 下旧数组接口只返回默认第一页。渠道可以加入资源组，移除后下一次请求即按新范围判断；暂停渠道仍可管理，禁用资源、跨项目 ID 和跨账户请求被拒绝。

这些规则适用于 JWT 项目渠道管理。产品实例凭据、发送、定时重试和产品实例投递记录访问保留各自的校验路径；legacy/shadow 模式保留个人项目归属约束。

## 项目投递记录资源授权

JWT 项目管理支持按单条投递记录授权，资源为 `acs:developer:*:<accountId>:push-delivery/<projectId>/<deliveryId>`。`quyan:developer:ListPushDeliveries` 控制每条记录的列表可见性，`GetPushDelivery` 控制指定记录的详情；列表权限不自动包含详情，渠道配置权限也不会扩大为投递记录权限。这两项均为敏感读取操作。

- `GET /v1/developer/projects/{projectId}/push-deliveries/page` 接受 page/pageSize，返回 items、page、pageSize、hasNext。先限定当前账户的有效项目、渠道和记录，再逐资源评估；不返回未授权总数。空页仍可能有下一页，应按 hasNext 继续遍历。enforce 下旧数组接口只返回默认第一页。
- `GET /v1/developer/projects/{projectId}/push-deliveries/{id}` 返回已授权记录的状态、渠道 ID、尝试次数、重试时间、创建和更新时间，以及 resourceArn。不会触发发送或重试。

管理响应不包含消息标题、正文、幂等键、渠道地址或上游原始错误。失败记录通过 `failureReason: "dispatch_failed"` 提供安全分类。为避免历史错误文本中的 URL、Token 或消息内容泄露，所有投递响应（包括 legacy/shadow 与产品发送响应）均不再填充旧 error 字段；客户端应使用 status 与 failureReason。新投递失败只保存固定错误标识，不保存上游异常文本。

指定记录可以加入资源组，移除成员后下一次请求即按新范围判断。记录及其渠道必须属于同一项目和当前账户；暂停渠道仍可查看历史记录，禁用资源、错误项目、大小写不一致的 ID 或历史关联字段则被拒绝或从列表移除，但不会中断后续分页。删除渠道会连带删除其投递记录，相关资源组成员不再提供授权。legacy/shadow 保留个人项目的数组归属约束；产品实例接口继续使用其独立主体与权限校验。
