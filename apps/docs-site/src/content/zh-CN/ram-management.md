# RAM (资源访问管理)

RAM 是授权与访问控制中心，用于创建子用户、定义角色、编写权限策略并进行绑定。所有变更操作均需通过 2FA 二次验证，且角色/策略/绑定变更会触发安全通知事件。

## 功能概览

- **RAM 用户** — 主账号下的子账号，拥有独立的登录凭据。
- **RAM 角色** — 命名的权限集合，可配置信任策略和会话时长。
- **权限策略** — 可复用的自定义权限列表，可绑定到用户、角色或用户组。
- **角色绑定** — 将角色授予用户或用户组。
- **策略绑定** — 将权限策略附加到用户、角色或用户组。
- **角色会话** — 用户扮演角色后产生的活跃会话。
- **授权概览** — 查看用户的最终有效权限（综合所有来源）。

## 页面结构

RAM 控制台使用独立 URL 组织概览、身份管理、权限管理和会话，不需要依赖单一大页面中的标签页。旧版带 `tab` 参数的用户、角色、绑定、策略、授权和会话链接会跳转到对应页面。

### 用户

创建和管理 RAM 子用户。每个用户可拥有控制台访问、API 访问密钥或两者兼备。

- 显示名称、RAM 用户名、邮箱、所属组、状态和创建时间。
- 支持自定义密码或自动生成随机密码。
- 支持首次登录强制修改密码。
- 密码仅在创建成功时展示一次，请及时复制保存。

### 角色

定义命名的权限角色。

- 角色名称、描述、最大会话时长。
- 权限通过绑定的策略继承。
- 信任策略限制哪些实体可以扮演该角色。

### 策略

创建可复用的权限列表，可绑定到多个目标。

- 策略名称、描述、类型（系统/自定义）。
- 从权限分类树中勾选所需权限。
- 点击"绑定列表"查看和解除已有绑定。
- 支持绑定到用户、角色和用户组。

### 会话

监控活跃的角色会话。

- 查看谁扮演了哪个角色、会话名称、过期时间。
- 可撤销不再需要的会话。

### 授权

选择用户查看其完整有效权限。

- 用户直接分配的权限。
- 用户组继承的权限。
- 角色绑定的权限。
- 策略绑定的权限。
- 被排除的权限。

登录身份可读取自己的权限摘要，这项基础读取仅作用于自己的用户资源，不提供账户管理权限。enforce 模式下，读取或检查他人权限需要 `quyan:permission:Manage` 对目标用户 ARN 的 Allow，并且目标必须属于当前账户且处于启用状态。仅对 `account` ARN 授予 View 可查看完整权限目录，不会自动授予所有用户的查看权限；仅对具体用户授予 View 也不会显示完整目录。显式 Deny 可以阻止自己的摘要读取。AccessKey 使用相同规则；AssumeRole 只使用有效角色会话及角色策略，不继承调用者的管理授权。三条权限查询接口在 legacy/shadow 模式保持原有权限检查，enforce 模式执行上述资源检查。

个人在线心跳的三个操作也使用自己的用户 ARN：`quyan:user:GetHeartbeatConfig`、`quyan:user:SendHeartbeat`、`quyan:user:StopHeartbeat`。Catalog 的 `defaultAuthorizationScope: "self"` 表示该操作拥有受限的默认自助 Allow，仅作用于当前认证用户，不授予查看在线监控、强制下线他人或操作其他账户的能力。若要限制这些默认能力，应发布匹配该 Action 和用户 ARN 的显式 Deny；增加带条件的 Allow 不会收窄默认 Allow。客户端提交的用户 ID、账户 ID 和 Action Header 不能改变心跳目标。

## 所需权限

| 操作              | 所需权限             |
| ----------------- | -------------------- |
| 查看 RAM 用户列表 | `RAM_USER_READ`      |
| 创建 RAM 用户     | `RAM_USER_CREATE`    |
| 更新 RAM 用户     | `RAM_USER_UPDATE`    |
| 删除 RAM 用户     | `RAM_USER_DELETE`    |
| 查看 RAM 角色列表 | `RAM_ROLE_READ`      |
| 创建 RAM 角色     | `RAM_ROLE_CREATE`    |
| 更新 RAM 角色     | `RAM_ROLE_UPDATE`    |
| 删除 RAM 角色     | `RAM_ROLE_DELETE`    |
| 查看角色绑定      | `RAM_BINDING_READ`   |
| 创建角色绑定      | `RAM_BINDING_CREATE` |
| 删除角色绑定      | `RAM_BINDING_DELETE` |
| 查看权限策略      | `RAM_POLICY_READ`    |
| 创建权限策略      | `RAM_POLICY_CREATE`  |
| 更新权限策略      | `RAM_POLICY_UPDATE`  |
| 删除权限策略      | `RAM_POLICY_DELETE`  |
| 绑定策略          | `RAM_POLICY_ATTACH`  |
| 解绑策略          | `RAM_POLICY_DETACH`  |
| 扮演角色          | `RAM_ASSUME_ROLE`    |
| 查看会话          | `RAM_SESSION_READ`   |
| 撤销会话          | `RAM_SESSION_REVOKE` |

## 安全说明

- **2FA 验证**: 所有创建、更新、删除、绑定、解绑操作均需 2FA 验证。
- **强制验证**: 删除用户、角色、策略以及解绑策略需要强制 2FA 验证（不接受受信任设备窗口）。
- **通知事件**: 所有 RAM 变更操作均会触发安全通知，请确保通知偏好中包含 RAM 相关事件。

修改用户附加／移除权限、清空权限配置或替换用户组权限时，如果目标权限、所属组等级或账户归属在检查后发生变化，服务端返回 **409 冲突**，不会覆盖并发更新。请重新读取目标的当前状态，确认增权和减权范围后再提交；不要把失败当成已生效，也不要自动重试旧内容。

## 常见操作流程

1. **创建 RAM 用户**: RAM 用户 → 创建用户 → 填写用户名和 RAM 用户名 → 选择访问方式 → 提交。
2. **定义角色**: 角色 → 创建角色 → 命名角色并设置会话时长 → 绑定策略。
3. **授权**: 将角色绑定到用户，或将策略直接附加到用户。
4. **权限审计**: 权限诊断 → 选择用户 → 查看其综合有效权限。

## IAM JSON 策略

策略编辑抽屉提供 **权限树** 和 **IAM JSON** 两种格式。选择 IAM JSON 后粘贴策略，点击 **校验 JSON** 由服务端检查；校验结果会提示显式 Deny 和过宽通配符。修改文本后之前的校验结果失效，保存时会先校验未验证的内容。已有 IAM 策略固定使用 JSON 格式，列表显示当前默认版本。更新携带原文档 hash，并发变更返回 409；请重新打开策略并核对变更后再保存。拥有策略读取权限时可加载服务端 Action 清单，将光标放入 Action 字符串内后选择 Action 插入。Resource 示例说明当前可用的全局和账户范围。**模拟授权** 抽屉接受同账户主体用户 ID、清单中的 Action 和 Resource，仅评估已保存策略，不包含编辑器未保存的内容。结果显示决策、原因和匹配标识，修改输入会清除结果。即使抽屉可见，调用模拟仍需要专用权限。在 IAM 策略行点击**版本历史**可分页查看不可变版本并预览 JSON。有更新权限时，可对非默认的自定义版本点击**恢复**并确认；操作需要相应授权、委派检查及二次验证，会立即改变所有绑定身份使用的权限。恢复发生冲突或失败后，需刷新并确认当前默认版本再重试。身份策略仅支持 `Version: "1"`、`Statement`、可选 `Sid`、`Effect`、`Action`/`NotAction` 二选一、`Resource` 和可选 `Condition`。Statement 可为对象或数组，Action/Resource 可为字符串或数组。仅 `*` 为通配符，大小写敏感；未知字段、未知版本、Principal、NotResource 和策略变量均拒绝，不会被忽略。阿里云 DNS Action 仅作为文档示例，不属于生产 Action 清单。

RAM 管理操作当前使用账户级 Resource：`acs:quyan:*:<主账号ID>:account`。Action 由服务端声明，目标资源归属仍单独检查。这些管理操作遵循配置的 legacy/shadow/enforce 切换模式；专用的模拟 Action 始终强制执行 IAM。

评估顺序是 **匹配的显式 Deny > 匹配的 Allow > 默认拒绝**。Action 与 Resource 必须同时匹配。普通用户身份合并用户、启用用户组和直接分配角色的策略；扮演角色后，只使用该角色的策略及范围授权，不叠加调用者的用户、用户组或其他角色权限。旧用户排除权限只在普通用户身份下转换为 Deny。账户归属、角色会话有效性和业务所有权检查仍保留。Action 来自服务端定义，不能由请求头覆盖；无法可靠解析 Resource 的请求被拒绝。

### 条件约束

`Condition` 支持字符串、数值、日期、布尔、IPv4/IPv6 和存在性运算符。`GET /v1/iam/catalog/condition-keys` 返回条件键、类型、允许的运算符和可用状态。当前可用属性包括客户端 IP、当前时间、User-Agent、HTTPS 状态及主体 ID、类型、账户；资源标签、资源组和 MFA 尚不可用，提交这些条件会被拒绝。User-Agent 由客户端提供，不应作为唯一的安全保证。

已迁移的文章资源操作支持 `quyan:ResourceOwnerId`，值为数据库中保存的作者用户 ID，不是 ARN 中的账户 ID。条件由服务端读取当前有效文章及作者归属，客户端属性不能覆盖。该键只能与操作清单中明确支持它的 Action 配合；不兼容的 Action（包括展开后包含其他服务的通配符）会被拒绝。模拟已保存策略和 JSON 草稿使用同一可信资源属性；文章不存在、已删除、跨账户或 ID 大小写别名会被安全拒绝。

文章管理列表 `quyan:article:ListArticles` 另支持 `quyan:ArticlePublishStatus`，值来自数据库中的发布状态（`draft` 或 `published`），不能由客户端覆盖。例如可用 `StringEquals` 将列表范围限定为已发布文章。该键只适用于操作目录明确声明支持它的 Action；资源所有者条件与发布状态条件写在同一语句时为 AND，需要 OR 范围时使用多个 Allow 语句。

不同运算符与条件键之间为 AND，同一键多个值为 OR。`StringLike` 支持 `*` 和 `?`；Action/Resource 仍只支持 `*`。`IpAddress` 不包含网段首尾地址，`IpAddressIncludeBorder` 包含首尾地址。除了显式 `Null` 检查，匹配语句所需的属性缺失时会安全拒绝，包括条件 Deny；模拟器不提供真实 IP/HTTPS 等请求属性，会返回 `missing-condition-context`，不会猜测属性。

### 服务和资源目录

具有策略读取权限时，可调用 `GET /v1/iam/catalog/services`、`GET /v1/iam/catalog/services/{service}/actions` 和 `GET /v1/iam/catalog/resources` 获取本平台服务、操作分类与 ARN 模板。API 关联由服务端路由声明生成。目录中的 `legacy` 表示该操作仍使用旧权限兼容语义；资源模板用于描述资源格式，不表示所有接口已完成资源级授权。现有 Action 名称保持兼容，不会将 `ReadUser` 自动改名为 `GetUser`。

ARN 构造、策略校验和评估只接受目录中已注册的资源类型。具体资源必须包含正确数量的标识段，例如策略版本必须包含策略 ID 和版本 ID；未知服务、未知类型、空标识和多余路径段会被拒绝。Action 与 Resource 类型不兼容时策略校验失败；即使通配符策略允许所有操作，具体请求仍须符合对应 Action 的资源类型。实际资源账户必须与认证主体账户一致，明确跨账户的策略 ARN 无法发布。资源归属查询和列表数据隔离仍须由业务服务执行。

### JSON 诊断和 Schema

提供原始 JSON 文本给 `POST /v1/ram/policies/diagnose`（字段 `documentText`），可获得错误、安全警告、警告和建议。每条诊断含稳定错误码、JSON Pointer、从 1 开始的行号和列号。语法错误、重复键、原型键、未知字段、未知 Action、条件值错误、资源类型不匹配和明确的跨账户 ARN 会阻止验证；过宽 Allow、IAM 管理授权和重复语句会提示风险。诊断不回显策略中的任意值。

`GET /v1/iam/catalog/policy-schema` 提供从同一策略校验器生成的 JSON Schema，供编辑器和 AI 构造草稿。Schema 包含当前生产 Action、资源模板、已实现条件键和限制；目录及账户归属等自定义语义仍须经过服务端诊断。获取 Schema 需要策略读取权限，诊断需要策略创建或更新任一权限。验证通过只说明文档符合当前语法，返回的 `delegation: "not-evaluated"` 表示尚未证明操作者可以发布或委派；保存和绑定继续执行已有授权检查。

JSON 编辑器的“校验 JSON”会提交原始文本，并按错误、安全警告、警告和建议分组展示诊断；点击诊断可定位到对应文本位置。编辑内容后原有诊断和校验结果立即失效。“格式化已校验 JSON”先完成服务端校验，再格式化规范化后的文档；“下载 JSON Schema”可将当前规范提供给外部 AI 辅助编写草稿。

### API 和权限

- `POST /v1/ram/policies`：提供 name 和 document，或旧 permissions；不可同时提交两种格式。
- `POST /v1/ram/policies/validate`：提供 document，返回规范化文档、SHA-256 hash 和过宽通配符提示；需策略创建或更新任一权限。
- `GET /v1/ram/iam/actions`：查看 Action 清单；需策略读取权限。Action 清单只包含本平台已实现的 API；阿里云 DNS 策略示例仅用于说明兼容的 JSON 结构。
- `GET /v1/ram/policies/{policyId}/versions`：通过 `page`（默认 1）和 `pageSize`（默认 20，最大 100）分页查看不可变版本；返回 `items`、`total`、`page`、`pageSize`、`defaultVersionId` 和 `defaultDocumentHash`。需策略读取权限。
- `POST /v1/ram/policies/{policyId}/versions`：新增版本并设为默认；提交 document 和当前 expectedDocumentHash。首次转换旧策略可不传 hash；已有 IAM 版本时必需。需策略更新权限、2FA 和重放保护。
- `PUT /v1/ram/policies/{policyId}/default-version`：提交 versionId 和当前 expectedDocumentHash，恢复某个历史版本；需策略更新权限、强制 2FA 和重放保护。hash 过期返回 409，不覆盖其他更新。
- `POST /v1/ram/policies/simulate`：提交同账户 principalId、action、resource；单独要求 `quyan:iam:SimulatePolicy` 对账户资源的 Allow，策略读取权限不足以调用。仅返回决策、原因和匹配的策略/版本/语句标识，不返回策略内容或凭据。

IAM 文档的创建、更新、默认版本切换和绑定要求拥有相应操作权限，并且部署必须已启用 enforce 模式。子用户可以委派可证明为自己现有授权子集的策略：资源范围不能扩大，条件不能放宽；无法证明的通配符包含关系或 Deny 交集会被拒绝。账户所有者保留恢复授权关系的管理能力。系统托管策略不可通过这些版本接口修改。新 IAM 策略不能降级成旧权限数组。

### 部署与迁移边界

`IAM_AUTHORIZATION_MODE` 默认为 `legacy`：保持旧权限强制。`shadow` 仍由旧权限强制，只比较并审计 IAM 差异；`enforce` 对已接入的旧权限检查使用 IAM，授权数据异常时不退回旧逻辑。明确采用 IAM 中间件的接口（例如模拟器）始终强制 IAM。**当前并非全部 JWT 接口都完成了独立 Action/Resource 迁移，不能仅打开 enforce 就视为全量覆盖。**

旧策略转换时保留旧权限字段，回滚配置无需删除版本数据；新建纯 JSON 策略在 legacy 模式下不会凭空获得旧权限。授权结果不使用缓存，策略解绑、禁用和会话撤销在后续请求中重新读取。列表行过滤、批量操作逐资源检查和业务归属检查不能被账户级授权替代；全量路由切换前应逐个完成迁移与差异校验。

## 相关页面

- `user-management`
- `group-management`
- `permission-management`
- `access-key-management`

## 授权关系与资源组 API

授权关系把用户、用户组或角色与策略连接起来，并独立限定生效范围。请求必须同时满足策略的操作、资源和条件，以及授权关系的范围。资源组范围不会把策略中未允许的资源变成允许。

| 操作       | API                                                           | 所需操作                              |
| ---------- | ------------------------------------------------------------- | ------------------------------------- |
| 查询授权   | `GET /v1/ram/authorizations`                                  | `quyan:ram:ListAuthorizations`        |
| 创建授权   | `POST /v1/ram/authorizations`                                 | `quyan:ram:CreateAuthorization`       |
| 删除授权   | `DELETE /v1/ram/authorizations/{authorizationId}`             | `quyan:ram:DeleteAuthorization`       |
| 查询资源组 | `GET /v1/ram/resource-groups`                                 | `quyan:ram:ListResourceGroups`        |
| 创建资源组 | `POST /v1/ram/resource-groups`                                | `quyan:ram:CreateResourceGroup`       |
| 添加成员   | `POST /v1/ram/resource-groups/{groupId}/members`              | `quyan:ram:AddResourceGroupMember`    |
| 移除成员   | `DELETE /v1/ram/resource-groups/{groupId}/members/{memberId}` | `quyan:ram:RemoveResourceGroupMember` |

这些操作使用独立的 IAM 权限，旧用户组管理或策略绑定权限不会自动获得新能力。写操作需要重放保护和二次认证。列表支持 `page`、`pageSize`，默认每页 50 条，最大 100 条；先在账户内分页，再逐条过滤 IAM 拒绝的记录，因此返回条数可能少于页大小，不提供未过滤总数。查询集合需要账号范围的列表权限，查看每条记录还需要对应 authorization 或 resource-group ARN 的列表权限。

创建授权提交以下字段：

```json
{
  "principalType": "user",
  "principalId": "user-id",
  "policyId": "policy-id",
  "scopeType": "resource",
  "scopeArn": "acs:quyan:*:account-id:user/target-user-id"
}
```

- `account`：不填写 scopeArn 或 scopeResourceId；这种授权同步到旧绑定展示。
- `resource`：填写注册类型的 scopeArn，限定当前账户的具体资源或资源路径通配符；不能使用单独的 `*`。
- `resource-group`：填写本账户资源组的 scopeResourceId，不填写 scopeArn。

创建资源组提交 name 和可选 description；添加成员提交 resourceArn。成员必须是本账户真实存在且启用的具体资源，不能使用通配符或虚构账户归属。移除成员立即停止组范围授权，资源禁用或移出账户后也不再获得该组授权。成员加入会重新检查委派，不能通过扩展资源组扩大自己的权限。

同一策略可有多条不同范围的授权，Deny 仅在该授权范围内生效。发布、绑定或资源组修改出现并发版本变化时应重新读取并重试；不得把失败当成已授权。子用户不能改动主账户及其恢复组、恢复角色的授权关系。

## 角色信任策略

enforce 模式下，扮演角色必须同时满足 **身份策略 Allow 与角色信任策略 Allow**，任意一侧匹配 Deny 都会拒绝。旧角色绑定不能替代信任策略，信任策略 Allow 也不能替代 AssumeRole 权限。启用强制模式前，请为已有角色配置有效信任，并核对角色会话身份隔离产生的差异。

信任策略必须填写 Principal，身份策略仍禁止 Principal。当前只接受本账户真实、启用的准确 RAM 用户主体，包括主账户自己的用户 ARN；通配符主体、跨账户主体、服务主体和角色链式扮演均不接受。Action 必须为 quyan:ram:AssumeRole，Resource 必须是注册的角色 ARN。

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "RAM": ["acs:quyan::account-id:user/user-id"] },
      "Action": "quyan:ram:AssumeRole",
      "Resource": "acs:quyan:*:account-id:role/role-id",
      "Condition": { "Bool": { "acs:SecureTransport": true } }
    }
  ]
}
```

使用 `GET /v1/iam/catalog/policy-schema?policyKind=trust` 获取独立 JSON Schema；向 `POST /v1/ram/policies/diagnose` 提交 documentText 和 policyKind: trust，获得原始 JSON 的路径及行列诊断。Schema 和诊断仍需要前文说明的策略读取、创建或更新权限。诊断校验语法和显式跨账户主体；发布还会验证主体真实存在及委派能力。

通过 `PUT /v1/ram/roles/{roleId}/trust-policy` 发布，提交 document 和可选 expectedDocumentHash。需要 `quyan:ram:UpdateRoleTrustPolicy` 对该角色的授权、重放保护和二次认证。普通角色更新权限不会自动获得信任发布能力。原角色创建、更新接口仍接受 trustPolicy，但提交时同样需要这项专用权限：创建使用账户范围，更新使用具体角色范围。有效信任文档的角色响应包含 trustPolicyHash；hash 或角色版本过期返回 409。发布会证明 AssumeRole 权限及角色全部有效授权，不丢弃授权关系的资源范围。角色列表提供独立信任编辑器。

enforce 模式下，assume-role 从已校验的 roleId 解析具体角色 ARN。模拟 quyan:ram:AssumeRole 对该 ARN 的请求也会同时评估身份与已保存信任，不虚构来源 IP 或 HTTPS 属性。无有效信任的角色在 enforce 下拒绝；legacy/shadow 保留旧的绑定角色或主账户准入方式。

已签发会话只使用所选角色的当前权限，同时检查账户、状态、过期和撤销。信任变更约束新会话；已有会话通过过期或显式撤销终止，不会在每次请求重新检查签发时的信任条件。用户组身份策略中的 Deny 不自动变成角色会话的权限边界：禁止切换身份应拒绝 AssumeRole，终止已签发会话应撤销会话。角色自身策略中匹配的 Deny 仍覆盖 Allow。

具体用户的修改和删除、角色删除、会话撤销、策略修改/删除/版本管理，均使用当前账号构造目标资源 ARN。角色与用户/组的绑定、策略与主体的绑定需要同时拥有两侧资源的管理权限；切换默认策略版本需要同时允许策略与所选版本。修改用户所属组还会检查该组的直接、角色及范围授权能否由操作者委派，避免通过用户编辑扩大自身权限。

旧 Permission 的账户级含义会转换为当前账号内已登记的兼容资源范围。手写 JSON 的 `account` ARN 只代表账号目标，不自动扩展成所有用户或策略；已经保存的 JSON 版本也不会被静默改写，迁移后的差异应在模拟和 shadow 评估中检查。

可视化编辑器与 JSON 编辑器共用一份身份策略草稿。选择服务后可按读取、写入和列表筛选操作，添加 Statement、复制或删除 Statement，使用当前账号 ARN 模板填写资源 ID，并选择已支持的条件键和运算符。模板不会默认填入所有资源；明确选择 `*` 时会显示宽泛授权提示。条件值按 JSON 输入（例如 `"203.0.113.0/24"`、`true` 或数组），保留字符串、数字和布尔类型。

从 JSON 切换到可视化前会运行服务端诊断。语法错误、未知字段或当前编辑器无法保留的结构会阻止切换；未完成的可视化表单不能保存，也不能将旧的校验结果用于发布。账号信息缺失时 ARN 模板不可用，请刷新用户信息。生成草稿后仍需通过服务端目录、资源、条件和委派检查。

## AI 辅助策略草稿

在策略编辑器展开“AI 辅助策略草稿”，描述所需操作、资源 ID 和条件，并填写模型 ID 与自己拥有的中转令牌 ID。令牌 ID 不是密钥；模型须由令牌及当前渠道允许。勾选“将当前 JSON 草稿交给 AI 修改”后，当前文本也会发给模型。不要在指令或草稿中输入密码、密钥或 Token。

生成需要账户范围的专用权限 `quyan:ram:GeneratePolicyDraft`，与策略发布权限分开检查。模型调用复用现有计费、安全检查和令牌有效性校验，不创建聊天对话。请求目前限制为每个用户 10 分钟内最多 10 次，指令最多 4000 字符，已有草稿最多 16384 字符；生成超时或响应不完整时不返回部分策略。

结果展示风险等级、解释、缺少的信息、诊断以及当前委派检查。未知 Action、非法 JSON、重复键、跨账户 ARN 和未实现的字段不会成为可应用策略。输入要求或当前草稿变化后，旧结果立即失效。点击“应用到编辑器”只替换待编辑 JSON；仍需校验、查看授权范围并明确保存，AI 不能创建策略、发布版本或绑定授权。委派无法证明时结果为高风险；即使返回草稿，也不能绕过发布校验。

API `POST /v1/ram/policies/ai/draft` 需要 JWT 和重放保护。提交 instruction、model、relayTokenId，可选 policyKind（identity 或 trust）和 currentDocumentText。身份草稿经过当前账户目录、资源、条件与委派检查；信任草稿只做结构和账户诊断，返回未评估状态，发布仍需角色目标、主体真实性和信任委派检查。接口不保存生成内容，也不返回上游原始响应。

## 模拟未发布草稿

在 JSON 或可视化编辑器点击“模拟当前草稿”，填写本账户主体、操作与资源，也可在模拟器中勾选“模拟未发布的身份策略草稿”并粘贴 JSON。模拟需要专用 `quyan:iam:SimulatePolicy` 权限，不会创建策略、发布版本或修改授权。修改草稿、请求参数或模拟来源后，原结果立即失效。

勾选草稿模式时，评估器只使用输入草稿，不叠加用户已绑定的身份授权；取消勾选则继续模拟已绑定策略。两者必须分别比较：草稿 Allow 不能证明发布委派通过，也不能覆盖绑定后的其他 Deny。模拟 `quyan:ram:AssumeRole` 仍会联合评估目标角色已保存的信任策略。当前只支持身份草稿，不模拟假设的角色信任变更。

通过 `POST /v1/ram/policies/simulate` 的可选 documentText 字段提交原始草稿。重复 JSON 键、未知字段、跨账户文档和非法语法均拒绝；请求资源须在本账户。命中记录使用 `simulation:draft` 标识，不表示已创建真实策略。模拟使用所选主体的可信身份属性和当前时间，不虚构来源 IP 或 HTTPS 条件；缺少必须的条件上下文时拒绝，不能将结果视为真实请求的最终授权。

管理客户端可使用 `GET /v1/ram/authorizations/page` 与 `GET /v1/ram/resource-groups/page` 获得 items、page、pageSize、hasNext；资源组摘要不会附带全部成员。通过 `GET /v1/ram/resource-groups/{groupId}/members` 单独分页读取成员，需要该具体资源组的列表权限。每页默认 50 条、最多 100 条；授权和资源组候选页先限制账户，再过滤资源权限，因此空页仍可能 hasNext 为 true，应允许继续下一页。hasNext 表示还有候选页，不是授权记录总数。旧列表 API 保持兼容，新管理界面应使用分页接口。

角色与策略列表同样使用服务端候选分页：`GET /v1/ram/roles/page` 与 `GET /v1/ram/policies/page` 返回 items、page、pageSize、hasNext。enforce 模式下，账户列表权限用于打开列表，每个具体角色/策略还需要独立的读取权限；具体 Deny 会隐藏相应记录及其策略内容。列表搜索只筛选当前页。角色绑定页面及策略附加表单中的角色选项可以翻页，换页会清除失效的选择；增删改后刷新当前页。旧数组接口在 enforce 模式仅返回已过滤的默认首页，需遍历全部可见记录的客户端应改用分页接口。

创建 RAM 用户、绑定角色和附加策略的用户组选项改用 `GET /v1/ram/groups/page`，支持 page、pageSize 和 keyword，并返回 items 与 hasNext。enforce 模式下，该列表需要账户目标上的 `quyan:group:Read`，每个选项还需要对应 group ARN 的读取权限；用户读取权限不能替代组读取权限。列表先按账户和历史组等级限制候选，再执行 IAM 过滤，组人数只统计本账户用户。仅真实主账户的恢复身份可看到其无账户归属的恢复组；子用户、AccessKey 和角色会话不继承该例外。三个表单都有用户组翻页控件，换页或加载失败后会清除旧的组目标。legacy/shadow 保留历史 RAM 用户读取入口和组可见规则，分页不会改变这些模式的历史授权。

RAM 用户与角色会话列表使用 `GET /v1/ram/users/page` 和 `GET /v1/ram/sessions/page`，会话接口还可按 principalUserId 筛选。enforce 模式分别检查具体 user 与 role-session ARN 的读取权限；账户列表 Allow 不会自动变成每条记录的 Allow。用户候选先限定主账户，明确声明外账户归属的记录不会通过历史 parentUserId 回退进入当前账户；会话只返回未撤销、未过期、有效且关联主体与角色归属一致的记录。用户列表搜索仅筛选当前页，角色绑定、策略附加与有效权限查询的用户选项均可翻页；换页后清除原选择及权限解释。旧数组接口在 enforce 模式返回已过滤的默认首页，legacy/shadow 保留历史数组结果。

角色绑定列表使用 `GET /v1/ram/roles/{roleId}/bindings/page`，接受 page、pageSize 与可选 userId。候选按直接用户绑定、用户组绑定的顺序分页，每类按创建时间与 ID 稳定排序。enforce 模式要求 `quyan:ram:binding:Read` 同时覆盖父 role ARN 和每条关系的 user/group ARN；仅父角色 Allow 不会暴露绑定主体，目标 Deny 会隐藏该行。候选查询排除外账户、失效目标及归属不一致的关系；userId 也必须属于本账户。角色切换会重置绑定页码并丢弃旧响应。旧数组接口在 enforce 模式返回默认已过滤首页，legacy/shadow 保留历史行为。

策略附加抽屉使用 `GET /v1/ram/policies/{policyId}/attachments/page`。enforce 模式要求父 policy ARN 的 `quyan:ram:ReadPolicy`；每条关系还需其目标对应的 `quyan:ram:ReadUser`、`quyan:group:Read` 或 `quyan:ram:role:Read`。策略读取权限不会自动公开目标名称。候选先按账户、有效策略及有效关系限定，目标不存在、失效或属于外账户时不返回。空过滤页可继续下一页；切换策略或关闭抽屉会清除旧记录与迟到响应。旧数组接口在 enforce 模式返回默认过滤首页；legacy/shadow 保留历史数组接口。

## 在管理页面创建范围授权

打开 RAM 的“授权”页面，可以分页查看资源组、成员及授权关系。点击资源组的“用于授权”会将该组 ID 带入范围授权表单；主体和策略填写从相应管理列表复制的 ID。范围支持 account、resource-group 和 resource：资源组范围填写资源组 ID，单资源范围填写本账户 ARN，账户范围不提交额外资源字段。

创建授权后刷新列表；撤销前显示确认，服务端仍要求专用管理 Action、二次认证、账户归属和委派检查。资源组成员使用独立服务端分页，添加时填写准确 ARN；移除前确认对访问权限的影响。加载失败可重试，空过滤页仍允许下一页。页面入口沿用现有 RAM 菜单可见权限；列表与写入各自独立检查新 IAM Action，菜单可见不代表已获授权。

enforce 模式下，“有效权限”的最终列表与用户权限接口共用 IAM 求值，只把账户目标上 Allow 的旧 Action 投影成全局 Permission；具体资源上的 Allow 不会被扩大。Explicit Deny 会从最终投影中排除对应权限。查看自己时采用当前认证身份与角色会话，查看其他主体时不借用操作者的会话。AccessKey 的主体类型条件也参与当前身份投影。来源数组保留历史解释用途，可能不覆盖 JSON-only 策略的全部授权；确认某个 ARN 的权限应使用模拟器。legacy/shadow 的历史展示保持兼容。

角色列表提供“角色信任策略”入口，打开后编辑独立信任 JSON，下载 trust Schema、查看原始文本诊断，或生成 trust 类型 AI 草稿。AI 应用仍只修改待编辑文本。发布先进行服务端信任诊断，再确认对新会话准入的影响，提交角色已有的 trustPolicyHash 防止覆盖并发更改。语法诊断不能证明发布权限；服务端继续检查真实同账户主体、专用 UpdateRoleTrustPolicy、AssumeRole 委派和角色有效授权。发布失败保留草稿供审阅，遇到版本冲突需重新加载角色；已有会话需要单独撤销。

将旧 Permission 授予用户或用户组时，enforce 会把它转换为本账户内所有已登记资源范围，再证明操作者能够委派完整范围。菜单中的账户目标 Allow 不能证明可授予所有具体资源。删除 permissionRemoves 中的 Deny 或清空配置可能恢复原本被拒绝的能力，因此也必须通过恢复权限的委派证明。账户范围与恢复身份校验在服务端执行；legacy/shadow 保持迁移兼容行为。

具体权限管理端点在 enforce 下按 user/<userId> 或 group/<groupId> 授权，不再用菜单中的账户权限代替目标检查。清空用户配置要求该用户上同时具备 Add 和 Remove；替换组权限分别检查新增和移除操作。组权限读取和写入也检查账户归属，资源通配符不能跨账户；旧的无归属恢复组仅向真实主账户恢复身份开放。目标操作授权与实际授予权限的委派证明分别执行。

身份策略的 `NotAction` 采用保守快照语义：服务端只从当前生产目录中选择与声明资源类型兼容、且未被排除的操作，再转换为不含通配符的明确 `Action` 列表。诊断在原始 `NotAction` 位置给出提示；Allow 的展开范围需通过完整委派证明。缺少选择器、同时填写 Action/NotAction、未知操作、展开为空或超出策略容量均拒绝。保存的不可变版本及 hash 对应展开后的 JSON，目录新增操作不会自动加入已有版本；要扩大范围需重新校验并创建版本。JSON 编辑器可输入 NotAction，可视化编辑器在服务端诊断后导入展开后的操作。角色信任策略继续只接受明确 AssumeRole Action。

用户权限配置替换在 enforce 下按实际变化检查操作：新增附加权限或移除 Deny 需要目标用户上的 Add；撤销附加权限或新增 Deny 需要 Remove，混合变化需要两者。Add-only 管理者不能通过配置替换实施移除操作；Remove-only 管理者不能恢复被拒绝的权限。恢复能力仍须通过委派证明。legacy/shadow 保留该接口原来的 Add 入口要求。

## 开发者项目资源授权

项目管理 API 使用 `acs:developer:*:<accountId>:project/<projectId>`。`quyan:developer:GetProject`、`GetProjectUsage` 和 `UpdateStatusPage` 分别控制项目详情、用量和状态页发布，操作相互独立。enforce 模式下可授权同账户主体管理指定项目，项目仍保留原所有者；跨账户、禁用项目或禁用所有者不能通过 ARN 中的 ID 获得访问。

`GET /v1/developer/projects/page` 接受 page/pageSize，返回 items、page、pageSize、hasNext。先查询当前账户的分页候选，再按 `quyan:developer:ListProjects` 逐项目过滤；只有具体项目的 Allow 也能看到该项目，无需账户级 Allow。空页可能仍有后续页，不返回未授权项目的 total。旧数组接口在 enforce 仅返回默认第一页，遍历请使用 page 接口。新 `GET /v1/developer/projects/{projectId}` 返回被授权项目的详情。

创建项目需要 `quyan:developer:CreateProject` 对当前认证用户的 `acs:quyan:*:<accountId>:user/<userId>` 授权，创建结果仍归该用户。个人基础自助权限不会自动授予项目管理能力。legacy/shadow 保留原来的个人项目所有权检查；shadow 记录差异，enforce 不会因评估失败回退放行。

## 开发者 KV 与密钥资源授权

JWT 项目管理接口可以授权单个 KV 键或单个密钥别名。资源格式分别为：

- KV：`acs:developer:*:<accountId>:kv-item/<projectId>/<encodedKey>`，encodedKey 是原始键的 UTF-8 base64url 编码，不带等号填充。例如 `config:prod` 编码为 `Y29uZmlnOnByb2Q`。
- 密钥：`acs:developer:*:<accountId>:secret/<projectId>/<ALIAS>`，别名保留大写格式。

单项读取或写入响应及分页元数据返回可选的 `resourceArn`，可直接复制到 JSON 策略。密钥响应始终只有元数据，不返回明文、密文、IV 或认证标签。

KV 操作分别使用 `quyan:developer:ListKv`、`GetKv`、`SetKv`、`DeleteKv`；密钥操作使用 `quyan:developer:ListSecrets`、`PutSecret`、`DeleteSecret`。读取、写入、删除相互独立。创建新键或新别名也需要对应目标 ARN 的写入权限。同账户委派不会改变项目所有者，项目授权不会自动覆盖 KV 或密钥资源。

`GET /v1/developer/projects/{projectId}/kv/entries/page` 和 `GET /v1/developer/projects/{projectId}/secrets/page` 接受 page/pageSize，返回 items、page、pageSize、hasNext。分页候选先限定有效项目和账户归属，再逐键或逐别名检查 List 权限。空页仍可能有后续页，不返回 total。KV 列表不包含值；过期键视为不存在，enforce 下的读取和列表不会删除这些数据。原数组接口在 enforce 只返回默认第一页；`GET .../kv/page` 仍是读取名为 page 的键。

KV 和密钥可作为资源组成员，移除成员后下一次请求即失去该授权范围。资源组成员必须真实存在、有效且属于当前账户；过期 KV、禁用资源以及禁用所有者的项目不能提供资源组授权。上述规则适用于 JWT 项目管理；产品实例的 API Key 接口继续按实例的独立权限验证。

## 短链接资源授权

短链接使用 `acs:developer:*:<accountId>:short-link/<projectId>/<linkId>`。`quyan:developer:CreateShortLink` 在项目范围控制创建，`ListShortLinks`、`UpdateShortLink`、`DeleteShortLink` 和 `GetShortLinkStats` 在单个链接范围控制管理；统计访问包含访客明细，需要独立授予。创建及项目列表权限不会自动扩大为所有链接权限。

`GET /v1/developer/projects/{projectId}/short-links/page` 支持分页候选和逐资源过滤；返回 resourceArn、hasNext，没有未授权总数，空页可继续遍历。enforce 下旧数组接口只返回默认第一页。具体链接也可用于资源组授权；跨项目链接 ID、跨账户、禁用资源或禁用项目所有者均被拒绝。暂停与到期的链接仍支持授权管理。详情见 [短链接](./developer-product-short-link)。

## 项目 API Key 元数据与撤销

项目 API Key 使用 `acs:developer:*:<accountId>:project-api-key/<projectId>/<keyId>`，标识的是凭据记录 ID，不包含完整 Key 或哈希。`quyan:developer:ListProjectApiKeys` 控制逐项元数据查看，`RevokeProjectApiKey` 控制指定凭据撤销；列表授权不自动授予撤销，项目范围的列表授权也不会自动覆盖子资源。

`GET /v1/developer/projects/{projectId}/keys/page` 返回 items、page、pageSize、hasNext。候选先限定同账户有效项目中的未撤销凭据，再逐项评估。响应包含 resourceArn、名称、前缀、scopes 等元数据，不返回完整 Key、keyHash 或 legacyKeyHash；空页可有后续页，没有 total。enforce 下旧数组接口只返回默认第一页。过期但未撤销的凭据仍能查看元数据或撤销，撤销后立即停止项目 Key 认证，也不再参与资源组授权。

同账户可只委派某一凭据的查看或撤销，跨账户、跨项目 ID 和禁用资源均被拒绝。legacy/shadow 保留原个人项目所有权。签发项目 Key 使用独立的 scopes 规则；本节的查看和撤销 Action 不提供凭据签发权限。

资源标识必须与保存的大小写完全一致。即使数据库把两个键视为同名，enforce 也会拒绝用不同大小写的键或 ID 访问原资源，不能通过改写大小写绕过已有 Deny。KV 写入和删除会在事务中再次检查精确键身份；资源组同样只接纳与实际保存值一致的 ARN。

## 状态监控资源授权

状态监控使用 `acs:developer:*:<accountId>:status-monitor/<projectId>/<monitorId>`。创建在项目 ARN 上授权，列表逐项过滤；修改、删除和手动 HTTP 检查为独立 Action，修改或列表权限不自动包含检查。enforce 支持同账户指定监控项委派和资源组范围，拒绝跨账户、错误项目及已禁用资源，保留 SSRF 校验。分页返回 hasNext 而非未授权总数，空页仍可继续；详情与 JSON 可用的操作名称见 [状态监控](./developer-product-status)。

## 项目推送渠道资源授权

渠道使用 `acs:developer:*:<accountId>:push-channel/<projectId>/<channelId>`。创建在项目范围控制，敏感配置列表逐渠道过滤，修改与删除独立授权。托管密钥绑定、保留引用修改地址或启用渠道，还需要在确切 Secret ARN 上授予 `quyan:developer:UseSecret`；普通渠道管理或密钥写入权限不会隐式获得此能力。管理流程不解密，事务内核实配置快照与密钥目标，拒绝并发替换沿用旧授权。分页、资源组和模式边界见 [推送聚合](./developer-product-push)。

## 项目投递记录授权

投递记录使用 `acs:developer:*:<accountId>:push-delivery/<projectId>/<deliveryId>`。`ListPushDeliveries` 与 `GetPushDelivery` 独立控制列表和详情，渠道管理权限不包含记录访问。逐项列表过滤与资源组都验证记录及渠道属于同一有效项目和账户，不返回消息正文或原始错误。失败记录提供固定 failureReason，旧 error 字段不再填充，以防历史错误泄露凭据；完整接口、分页和删除影响见 [推送聚合](./developer-product-push)。

## 余额与兑换码资源授权

在 enforce 模式下，自己的余额读取、用量、转账配置、创建兑换码、转账和兑换分别使用 `quyan:balance:GetAccount`、`GetUsage`、`GetTransferConfig`、`CreateGiftCode`、`CreateTransfer`、`RedeemCode`（后五项使用相同的 `quyan:balance:` 前缀），目标为 `acs:quyan:*:<accountId>:user/<userId>`。这些操作具有受限的默认自助 Allow，仅限当前认证用户；匹配的显式 Deny 仍然优先。转账不会授予查看或管理收款人账户的权限，余额、费率、2FA 和重放保护校验继续生效。

用户创建的余额兑换码使用具体 ARN：`acs:balance:*:<accountId>:gift-code/<creatorUserId>/<giftCodeId>`。`quyan:balance:ListGiftCodes` 逐条评估该资源，`quyan:balance:CancelGiftCode` 检查指定兑换码资源。默认自助范围只包含当前用户创建的兑换码；知道兑换码 ID 不会获得查看或取消他人兑换码的权限。列表的记录和总数都只包括允许查看的兑换码，不能通过列表获取被拒绝资源的兑换字符串。

例如，以下策略在保留其他兑换码默认能力的同时，阻止查看和取消指定兑换码。示例中的账户、用户和兑换码 ID 必须替换为自己的真实资源：

```json
{
  "Version": "1",
  "Statement": {
    "Effect": "Deny",
    "Action": ["quyan:balance:ListGiftCodes", "quyan:balance:CancelGiftCode"],
    "Resource": "acs:balance:*:account-id:gift-code/user-id/gift-code-id"
  }
}
```

附加一个条件更严格的 Allow 不会缩小既有默认 Allow。需要限制默认能力时，应使用匹配操作和资源的 Deny。资源账户由认证主体决定，客户端提交的账户 ID 或 Action Header 不能改变授权目标。legacy 模式保留旧规则，shadow 模式比较 IAM 与原有列表结果，enforce 模式拒绝资源解析或授权数据读取失败的请求。

## 拼车订单资源授权

在 enforce 模式下，`quyan:carpool:ListMyOrders` 对 `acs:carpool:*:<accountId>:order/<orderId>` 逐条评估；订单列表和总数只包括允许查看的订单。授权前还会验证当前用户的有效成员关联，给非成员一个订单 ARN 的 Allow 不会获得订单内容。读取详情使用 `quyan:carpool:GetOrder`，列表授权不自动授予详情或写入能力。

创建订单使用 `quyan:carpool:CreateOrder`，需要同时允许当前用户 ARN 和所选公开套餐 ARN `acs:carpool:*:<accountId>:template/<templateId>`。接受邀请使用 `quyan:carpool:AcceptInvite`，需要同时允许当前用户 ARN 和服务端根据有效邀请找到的订单 ARN。邀请令牌不是授权凭证，不会写入资源 ARN 或 IAM 审计日志。篡改请求中的订单 ID、账户 ID 或 Action Header 不能改变这些目标。

邀请、比例分配、确认份额、退出、取消和提交分别使用 `quyan:carpool:CreateInvite`、`AllocateRatios`、`ConfirmMember`、`LeaveOrder`、`CancelOrder`、`SubmitOrder`（后五项使用相同的 `quyan:carpool:` 前缀），目标均为具体订单 ARN。IAM Allow 不取代成员和发起人校验，也不绕过订单状态、邀请有效期、份额比例或余额要求。没有匹配 Allow 时默认拒绝，任意匹配的 Deny 优先。

legacy 保留原来的成员规则，shadow 保留业务结果并比较 IAM 列表范围，enforce 在资源解析、策略读取或最终权限复核失败时拒绝请求。套餐运营和管理员履约接口另有管理权限，自助订单授权不会授予这些能力。

## 聊天、兑换码与拼车资源组

资源组可以包含聊天会话、消息、余额兑换码和拼车订单。加入时及每次授权时均检查真实资源归属：聊天资源要求会话所属用户有效；兑换码要求创建者与 ARN 中的用户一致；拼车订单要求账户内至少有一位未退出的有效成员。资源删除、用户禁用或最后一位成员退出后，资源组不再提供该资源的 Allow；已有其他授权仍按普通策略规则评估。

公开、有效的拼车套餐也可以加入资源组，用于限定账户可使用的套餐。此 ARN 表示该账户对共享套餐的使用范围，不赋予套餐所有权或运营权限。未发布、归档或已禁用的套餐不能提供资源组授权。

## 用户脚本资源授权

脚本使用 `acs:script:*:<accountId>:script/<userId>/<scriptId>` 标识。创建脚本的 `quyan:script:CreateScript` 检查当前用户资源 `acs:quyan:*:<accountId>:user/<userId>`；修改和删除分别使用 `quyan:script:UpdateScript`、`quyan:script:DeleteScript` 检查指定脚本资源。

`quyan:script:ListScripts` 按脚本逐项授权：无权限的脚本不会出现在结果中，也不会读取其正文。脚本可以加入同账户资源组；禁用、删除或账户归属不符的脚本不能加入。资源级策略不会取消“只能修改、删除自己脚本”的业务限制，也不会为所有登录用户自动授予脚本权限。

执行历史使用 `acs:script:*:<accountId>:execution/<userId>/<executionId>`。`quyan:script:ListExecutions` 同时检查每条历史和关联脚本（如果存在）的资源权限，过滤后最多返回最近 50 条；没有绑定脚本的历史仍按自身资源授权。已删除脚本的自有历史快照可以保留，但不能再为该脚本新增历史。执行历史也可加入同账户资源组。

保存历史的 `quyan:script:SaveExecution` 检查当前用户资源，并在绑定脚本时同时检查指定脚本。不能关联他人的脚本、已删除的脚本或跨账户脚本。历史接口只保存执行快照，不在服务端执行脚本代码。

## 自有工单资源授权

工单资源使用 `acs:ticket:*:<accountId>:ticket/<userId>/<ticketId>`。创建工单的 `quyan:ticket:CreateTicket` 检查当前用户资源；查询、修改和追加评论分别使用 `quyan:ticket:GetOwnTicket`、`quyan:ticket:UpdateOwnTicket`、`quyan:ticket:AddOwnComment` 检查指定工单。

`quyan:ticket:ListOwnTickets` 逐工单授权后再分页和计数，不返回无权限的工单内容或联系信息。账户策略不能取消自有工单的归属限制；同账户的其他用户工单也不能通过自有接口访问。内部评论对提交者隐藏，已结束工单不能修改或追加评论。有效工单可以加入同账户资源组。登录本身不自动授予这些工单操作权限。

## MCP 服务配置资源授权

MCP 服务资源使用 `acs:mcp:*:<accountId>:server/<userId>/<serverId>`。`quyan:mcp:ListServers` 按配置逐项授权，拒绝的配置不会出现在列表中；服务端只读取允许配置的端点、工具清单和凭据是否存在的标记，不读取凭据密文。

创建配置的 `quyan:mcp:CreateServer` 检查当前用户资源，并确认用户属于当前账户且有效。MCP 配置可以加入同账户资源组；跨账户、非本人或已删除的配置不能通过自有管理接口访问。配置授权不等于批准 Agent 执行任务或使用工具，这些操作仍受各自权限和运行安全约束控制。

## Agent 机器资源授权

机器使用 `acs:agent:*:<accountId>:machine/<userId>/<machineId>`。`quyan:agent:ListMachines` 逐机器授权，列表只展示允许的机器状态和能力，不读取注册凭据哈希。`quyan:agent:CreateMachine` 检查当前用户资源，确认用户属于当前有效账户后创建机器；注册 Token 仅在创建成功响应中提供，列表不返回。

`quyan:agent:DeleteMachine` 检查指定机器资源，并校验真实用户、账户和数据版本后撤销机器。自有管理接口不能管理他人或跨账户机器。有效机器可以加入同账户资源组；机器注册权限不等于工作区创建、任务执行或工具批准权限。

撤销机器后，当前服务器上的已有连接会关闭；其他服务器上的连接在下一次心跳、任务发送或响应时重新校验机器状态，失效后拒绝通信。停用用户或账户、变更账户归属也会使旧连接失效。重连会替换旧连接，任务响应只能由接收任务的已认证连接提交。

## Agent 工作区列表授权

工作区使用 `acs:agent:*:<accountId>:workspace/<userId>/<workspaceId>`。`quyan:agent:ListWorkspaces` 逐工作区评估，列表仅展示允许的工作区及其运行策略和容量配置。关联机器名称和状态还需要该机器的 `quyan:agent:ListMachines` 权限；缺少该权限时不显示这些字段。账户隔离和本人归属检查始终保留，工作区可以加入同账户资源组。
