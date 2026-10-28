# 短链接

短链接将一个受控的目标 URL 映射到短代码，适合活动链接、下载地址、渠道归因和需要集中失效控制的分享链接。短链资源由实例隔离，创建、编辑和统计均在产品控制台完成。

## 创建与发布

创建时填写完整的 HTTP(S) 目标地址，可让平台生成代码，也可填写 3 至 80 位的小写字母、数字和连字符自定义别名。可选过期时间用于活动到期自动失效。短链可以随时暂停、恢复、修改目标地址或永久删除。

公开访问地址为 `GET /s/{code}`。该入口返回原生 `302` 跳转，不需要 API Key，也不会套用 JSON 响应包装。暂停、过期或不存在的代码不会跳转。

## 统计与隐私

每次跳转异步聚合点击时间、来源域名、User-Agent 摘要和国家/地区。控制台可按日期、来源和地区查看统计；明细按产品保留策略清理。统计响应可能包含访客 IP、来源域名和 User-Agent 明细，应只授予需要查看统计的主体。

读取、写入和删除分别由短链接读取、写入和管理 RAM 权限控制。

## JWT 项目管理授权

单个短链接的资源为 `acs:developer:*:<accountId>:short-link/<projectId>/<linkId>`，末段使用链接 ID，公开短代码不作为 IAM 标识。响应中的 resourceArn 可直接用于 JSON 策略。

`quyan:developer:CreateShortLink` 在项目 ARN 上控制创建；创建权限不会自动授予新链接的管理权限。`ListShortLinks`、`UpdateShortLink`、`DeleteShortLink` 和 `GetShortLinkStats` 在具体链接 ARN 上分别检查。统计 Action 独立控制访客明细，只有列表权限不能查看统计。

`GET /v1/developer/projects/{projectId}/short-links/page` 接受 page/pageSize，返回 items、page、pageSize、hasNext。先分页同账户有效项目中的候选，再逐链接过滤；空页可能有后续页，没有未授权资源的 total。enforce 下旧数组列表只返回默认第一页。暂停或过期的链接仍可被有权限的主体管理，已禁用的数据行和跨账户资源不能访问。

短链接可以加入资源组；移除成员后下一次授权即时变化。委派保留原项目所有者，目标地址校验仍会阻止内网地址或含凭据的 URL。legacy/shadow 保留个人项目所有权，enforce 使用资源策略。产品实例管理和公开跳转各自使用原有身份与权限入口。更多规则见 [RAM 管理](./ram-management)。
