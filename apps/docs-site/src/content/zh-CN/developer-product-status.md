# 状态监控

状态监控定期检查公开 HTTP(S) 服务，并提供可公开访问的状态页。它适合展示 API、网站或依赖服务的可用性和延迟趋势，不替代完整的应用性能监控或日志平台。

## 配置监控目标

在控制台填写名称、HTTP(S) 目标 URL、请求方法、检查间隔、成功状态码和告警延迟（1 到 1440 分钟，默认 5 分钟）。最小检查间隔为 60 秒。请求经过 SSRF 防护：仅允许 HTTP(S)，内网、回环和链路本地目标会被拒绝；状态检查最多跟随 5 次重定向，每一跳都会重新校验目标，并拒绝重定向循环和 `file://` 等非 HTTP 协议。

检查记录包含状态码、延迟和经过脱敏的错误摘要。目标可以暂停、恢复或手动检测；手动检测只影响当前行。异常持续达到配置的延迟后才发送一次异常通知，恢复通知沿用平台通知/Webhook 体系和现有通知偏好。

## 公开状态页

发布状态页后，地址为 `/status/{slug}`。页面展示当前状态、最近延迟、可用率和事件历史；关闭发布后不再公开。发布状态页需要独立的“发布状态页”RAM 权限，和读取、写入、删除监控目标的权限分离。

## 监控项资源授权

在 IAM enforce 模式下，JWT 管理接口使用本系统的操作和资源，不使用阿里云 DNS 权限。监控项 ARN 为 `acs:developer:*:<accountId>:status-monitor/<projectId>/<monitorId>`；标识符须与已存储资源完全一致，accountId 来自认证上下文。

- `quyan:developer:CreateStatusMonitor`：在指定项目 ARN 上授权创建；不自动授予新监控项的管理权限。
- `quyan:developer:ListStatusMonitors`：逐监控项控制配置和状态的查看。返回的配置可包含请求负载，授权前应检查其中是否包含敏感内容。
- `quyan:developer:UpdateStatusMonitor`、`DeleteStatusMonitor`：分别控制指定监控项的修改和删除。
- `quyan:developer:CheckStatusMonitor`：独立控制手动外发 HTTP 检查；列表或修改权限不自动包含此操作。

`GET /v1/developer/projects/{projectId}/monitors/page` 接受 page/pageSize，返回 items、page、pageSize、hasNext。候选记录先限定到当前账户的有效项目，再逐项授权，响应包含可用于策略编辑的 resourceArn，不返回未授权总数。空页仍可能有下一页；enforce 下旧数组接口只返回默认第一页。

同账户身份可以被授予某个监控项的权限，资源组也可包含指定监控项。移除成员后下一次请求即按新范围判断。跨账户、错误项目、大小写不一致及已禁用资源均被拒绝；暂停自动检查的监控项仍可管理。手动检查保留 SSRF 与逐跳重定向校验，并在外发前和结果写入时重新核实资源有效性。公开状态页、定时任务和产品凭据接口继续使用各自的访问边界；legacy/shadow 模式保留个人项目归属约束。
