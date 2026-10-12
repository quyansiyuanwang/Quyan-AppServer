# 开发者产品

开发者产品为 KV 存储、短链接、密钥托管、状态监控、验证码、IP 定位和推送聚合提供独立的实例、权限、额度和审计边界。每个产品都由“控制台 / 运营管理 / 产品配置”三部分组成：控制台用于日常资源管理，运营管理用于账号用量与容量治理，产品配置用于平台级开关和价格配置。

## 开始使用

1. 在产品控制台创建一个实例。实例是资源和调用凭据的隔离边界。
2. 为需要调用 API 的 RAM 主体创建 `dpk_` 前缀的 API Key，并仅选择该主体实际具备的动作权限。
3. 在服务端请求中携带 `Authorization: Bearer dpk_...`。不要把 Key 放到浏览器、移动端包或公开仓库。
4. 通过控制台查看实例、用量和调用审计；需要停止调用时停用实例或撤销 Key。

## RAM 与 API Key

Key 绑定一个 RAM 主体，且调用时实时取该主体的有效权限。因此，收回 RAM 权限会立即收回 Key 对应动作的能力，不需要重新签发 Key。主账号只能把 Key 委派给本账号下的主体；RAM 子用户只能创建绑定自己的 Key。

创建成功时明文 Key 仅显示一次。请立即保存到部署环境的密钥管理系统；控制台之后只会显示前缀、权限、到期时间和最后使用时间。

## 实例状态与响应

停用实例会立即拒绝该实例的外部调用，响应为 `403`，表示资源存在但当前不可用；不会伪装成 `404`。撤销或删除 Key、Key 格式错误才会返回认证失败。删除实例会删除其资源和 Key，不能恢复。

## 额度与计费

每日免费额度按账号在单个产品内汇总，不会因创建多个实例而增加。超过免费额度后，只有运营管理中已启用超额扣费且账户余额充足时才会继续处理；参数校验失败、私网 IP 查询和未成功投递的验证码不会计费。

各产品页面提供具体操作、限制和请求示例。请使用与目标操作相匹配的最小 RAM 权限。

## 配额覆盖管理读取

IAM 强制模式下，配额覆盖管理列表需要真实全局组中的 `DEVELOPER_QUOTA_MANAGE` 资格，使用 `quyan:developer:ListQuotaOverrides`，资源为 `acs:platform:*:platform:developer-quota-override/<覆盖记录 ID>`。列表只返回获得授权的实际覆盖记录，匹配的 Deny 优先。AssumeRole 只使用角色自身的记录授权。

记录、资格、策略或角色会话在读取期间变化时，结果不会返回。已删除的记录不会展示；已过期的覆盖仍可在管理列表中查看，方便清理，它们不会因此重新生效。

## 配额覆盖写入权限

创建或更新使用 `quyan:developer:UpsertQuotaOverride`，删除使用 `quyan:developer:DeleteQuotaOverride`；操作需要真实全局组中的 `DEVELOPER_QUOTA_MANAGE` 资格。创建或更新同时检查 `acs:platform:*:platform:developer-quota-subject/<user 或 project>/<主体 ID>/<服务>` 和实际覆盖记录 ARN。服务段使用 `ip`、`verification`、`push`，通用覆盖使用 `all`。恢复已删除的覆盖保留原记录 ID，原资源上的 Deny 继续有效。

目标用户、账户或项目必须有效；在保存前主体归属、目标版本、资格或授权变化时，操作失败且不会部分保存。到期时间须在未来；删除可以清理不再需要的覆盖。IAM 强制模式下，缺少或未授权的删除目标返回 403。写入接口继续执行重放保护。

## 产品配置读取权限

IAM 强制模式下，管理配置列表需要真实全局组中的 `DEVELOPER_PRODUCT_CONFIG_MANAGE` 资格，使用 `quyan:developer:ListProductConfigurations`，资源为 `acs:platform:*:platform:developer-product-config/<配置记录 ID>`。列表只返回授权且已保存的实际产品配置，按产品代码排序；不会为了读取自动创建其他产品的配置。

在 IAM 强制模式下，配置写入还需要授权对应产品范围 `acs:platform:*:platform:developer-product-config-control/<productCode>` 和真实配置记录 `acs:platform:*:platform:developer-product-config/<配置ID>`，Action 为 `quyan:developer:UpsertProductConfiguration`。首次保存时同样检查新记录；恢复配置保留原 ID。任一范围被显式拒绝、操作期间撤权或配置发生并发变化，写入都不会部分生效。保存单个产品不会自动初始化其他产品的配置。

匹配的 Deny 优先，AssumeRole 只使用角色自身授权。配置、资格、策略或角色会话在读取期间变化时，结果不会返回。管理配置中的限额和设置在逐记录授权后才加载。

## 产品账户列表权限

在 IAM 强制模式下，全部产品账户列表和按产品筛选的账户列表使用 `quyan:developer:ListProductAccounts`，资源为 `acs:platform:*:platform:developer-product-account/<实际产品账户记录ID>`。操作者必须属于真实全局组，并具备 `DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE` 平台管理资格。仅返回授权允许、未删除、所属主账户有效的已保存记录；禁用使用或已过期的产品记录仍可供管理员清理。配额和主账户展示信息在逐条授权后读取。

记录、主账户、策略、平台资格或角色会话在读取期间变化时不会返回过期结果。产品筛选在读取时执行，列表按最近更新时间排序；查询不会为其他账户自动创建产品记录。

产品用量查询单独使用 `quyan:developer:GetProductAccountUsage`，按真实产品账户记录授权。按用户 ID 查询时也会先解析对应记录，不能借用户路径扩大权限。返回前复查记录、主账户、产品计价配置、当日计数和授权；并发变化时拒绝本次读取。查询保留当日计数旧日期兼容读取，不自动创建记录或重置计数。只有资源被授权后才读取其配额、计数和计价信息。

调用日志列表使用 `quyan:developer:ListProductAccountCalls`，逐条授权 `acs:platform:*:platform:developer-product-call-log/<实际日志ID>`。两种查询路径都确认产品记录和有效主账户，最多返回最近 200 条被允许的未删除日志，而不是先截断再过滤。仅在授权后读取费用、调用主体和关联记录 ID；不读取或返回详细请求内容、凭据和密钥。读取期间记录归属、主体资格或授权变化时拒绝返回旧结果。

管理员查看指定主账户的产品实例使用 `quyan:developer:ListProductAccountInstances`，资源为 `acs:platform:*:platform:developer-product-instance/<实际实例ID>`。逐条授权后才读取实例名称和 slug；实例关联的项目必须有效且属于同一主账户。已禁用但未删除的实例仍可供管理员管理。读取期间实例、关联项目、产品记录、主账户或权限变化会拒绝返回旧结果，不自动创建产品记录。
