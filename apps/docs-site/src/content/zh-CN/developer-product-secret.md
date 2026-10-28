# 密钥托管

密钥托管用于保存第三方 API Key、Webhook Secret 等部署期凭据。每个别名在实例内唯一，值只写不可读：创建和轮换后控制台只显示别名、版本、更新时间和最后使用时间，永远不会回传明文。

## 使用方式

别名长度为 1–100 个字符，必须以大写字母开始，之后只能包含大写字母、数字和下划线，例如 `OPENAI_KEY`。密钥值长度为 1–20,000 个字符。在[推送聚合]({{DOCS_BASE_URL}}/zh-CN/developer-product-push)中配置渠道时，可选择同一存储所有者的密钥托管实例及别名。推送时平台读取该密钥，并将其作为 Bearer 凭据发送给渠道目标地址；只有信任该目标时才应绑定密钥。配置引用还可能需要额外的密钥使用授权，详见推送聚合指南。

## 生命周期与权限

新增或轮换需要密钥写入权限，删除需要密钥管理权限，查看元数据需要密钥读取权限。删除是不可恢复的；若推送渠道仍引用该别名，后续投递会失败。平台使用独立主密钥以加密方式保存密文、IV 和认证标签。

## JWT 项目管理接口

项目密钥管理可按别名授予 `quyan:developer:ListSecrets`、`PutSecret` 和 `DeleteSecret`，资源为 `acs:developer:*:<accountId>:secret/<projectId>/<ALIAS>`。新增、轮换、删除分别检查对应操作与具体别名，同账户委派保留项目所有者。项目权限不会自动覆盖全部别名。

`GET /v1/developer/projects/{projectId}/secrets/page` 接受 page/pageSize，返回逐别名过滤后的 items、page、pageSize、hasNext；空页可能有后续页，没有 total。enforce 下旧数组接口只返回默认第一页。返回的 resourceArn 可直接用于策略，所有返回值只包含元数据。更多授权与资源组规则见 [RAM 管理](./ram-management)。
