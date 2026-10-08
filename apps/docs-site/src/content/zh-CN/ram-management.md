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

## 常见操作流程

1. **创建 RAM 用户**: RAM 用户 → 创建用户 → 填写用户名和 RAM 用户名 → 选择访问方式 → 提交。
2. **定义角色**: 角色 → 创建角色 → 命名角色并设置会话时长 → 绑定策略。
3. **授权**: 将角色绑定到用户，或将策略直接附加到用户。
4. **权限审计**: 权限诊断 → 选择用户 → 查看其综合有效权限。

## IAM JSON 策略

策略编辑抽屉提供 **权限树** 和 **IAM JSON** 两种格式。选择 IAM JSON 后粘贴策略，点击 **校验 JSON** 由服务端检查；校验结果会提示显式 Deny 和过宽通配符。修改文本后之前的校验结果失效，保存时会先校验未验证的内容。已有 IAM 策略固定使用 JSON 格式，列表显示当前默认版本。更新携带原文档 hash，并发变更返回 409；请重新打开策略并核对变更后再保存。拥有策略读取权限时可加载服务端 Action 清单，将光标放入 Action 字符串内后选择 Action 插入。Resource 示例说明当前可用的全局和账户范围。**模拟授权** 抽屉接受同账户主体用户 ID、清单中的 Action 和 Resource，仅评估已保存策略，不包含编辑器未保存的内容。结果显示决策、原因和匹配标识，修改输入会清除结果。即使抽屉可见，调用模拟仍需要专用权限。在 IAM 策略行点击**版本历史**可分页查看不可变版本并预览 JSON。有更新权限时，可对非默认的自定义版本点击**恢复**并确认；操作需要相应授权、委派检查及二次验证，会立即改变所有绑定身份使用的权限。恢复发生冲突或失败后，需刷新并确认当前默认版本再重试。身份策略仅支持 `Version: "1"`、`Statement`、可选 `Sid`、`Effect`、`Action`、`Resource` 和可选 `Condition`。Statement 可为对象或数组，Action/Resource 可为字符串或数组。仅 `*` 为通配符，大小写敏感；未知字段、未知版本、Principal、NotAction、NotResource 和策略变量均拒绝，不会被忽略。阿里云 DNS Action 仅作为文档示例，不属于生产 Action 清单。

RAM 管理操作当前使用账户级 Resource：`acs:quyan:*:<主账号ID>:account`。Action 由服务端声明，目标资源归属仍单独检查。这些管理操作遵循配置的 legacy/shadow/enforce 切换模式；专用的模拟 Action 始终强制执行 IAM。

评估顺序是 **匹配的显式 Deny > 匹配的 Allow > 默认拒绝**。Action 与 Resource 必须同时匹配。普通用户身份合并用户、启用用户组和直接分配角色的策略；扮演角色后，只使用该角色的策略及范围授权，不叠加调用者的用户、用户组或其他角色权限。旧用户排除权限只在普通用户身份下转换为 Deny。账户归属、角色会话有效性和业务所有权检查仍保留。Action 来自服务端定义，不能由请求头覆盖；无法可靠解析 Resource 的请求被拒绝。

### 条件约束

`Condition` 支持字符串、数值、日期、布尔、IPv4/IPv6 和存在性运算符。`GET /v1/iam/catalog/condition-keys` 返回条件键、类型、允许的运算符和可用状态。当前可用属性包括客户端 IP、当前时间、User-Agent、HTTPS 状态及主体 ID、类型、账户；资源标签、资源组和 MFA 尚不可用，提交这些条件会被拒绝。User-Agent 由客户端提供，不应作为唯一的安全保证。

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

创建资源组提交 name 和可选 description；添加成员提交 resourceArn。成员必须是本账户真实存在且启用的具体资源，不能使用通配符或虚构账户归属。移除成员立即停止组范围授权，资源禁用或移出账户后也不再获得该组授权。成员加入会重新检查委派，不能通过扩展资源组扩大自己的权限。当前提供 API，管理界面的资源组选择器尚未开放。

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

通过 `PUT /v1/ram/roles/{roleId}/trust-policy` 发布，提交 document 和可选 expectedDocumentHash。需要 `quyan:ram:UpdateRoleTrustPolicy` 对该角色的授权、重放保护和二次认证。普通角色更新权限不会自动获得信任发布能力。原角色创建、更新接口仍接受 trustPolicy，但提交时同样需要这项专用权限：创建使用账户范围，更新使用具体角色范围。有效信任文档的角色响应包含 trustPolicyHash；hash 或角色版本过期返回 409。发布会证明 AssumeRole 权限及角色全部有效授权，不丢弃授权关系的资源范围。当前提供 API 与 Schema，专用信任编辑器尚未提供。

enforce 模式下，assume-role 从已校验的 roleId 解析具体角色 ARN。模拟 quyan:ram:AssumeRole 对该 ARN 的请求也会同时评估身份与已保存信任，不虚构来源 IP 或 HTTPS 属性。无有效信任的角色在 enforce 下拒绝；legacy/shadow 保留旧的绑定角色或主账户准入方式。

已签发会话只使用所选角色的当前权限，同时检查账户、状态、过期和撤销。信任变更约束新会话；已有会话通过过期或显式撤销终止，不会在每次请求重新检查签发时的信任条件。用户组身份策略中的 Deny 不自动变成角色会话的权限边界：禁止切换身份应拒绝 AssumeRole，终止已签发会话应撤销会话。角色自身策略中匹配的 Deny 仍覆盖 Allow。

具体用户的修改和删除、角色删除、会话撤销、策略修改/删除/版本管理，均使用当前账号构造目标资源 ARN。角色与用户/组的绑定、策略与主体的绑定需要同时拥有两侧资源的管理权限；切换默认策略版本需要同时允许策略与所选版本。修改用户所属组还会检查该组的直接、角色及范围授权能否由操作者委派，避免通过用户编辑扩大自身权限。

旧 Permission 的账户级含义会转换为当前账号内已登记的兼容资源范围。手写 JSON 的 `account` ARN 只代表账号目标，不自动扩展成所有用户或策略；已经保存的 JSON 版本也不会被静默改写，迁移后的差异应在模拟和 shadow 评估中检查。

可视化编辑器与 JSON 编辑器共用一份身份策略草稿。选择服务后可按读取、写入和列表筛选操作，添加 Statement、复制或删除 Statement，使用当前账号 ARN 模板填写资源 ID，并选择已支持的条件键和运算符。模板不会默认填入所有资源；明确选择 `*` 时会显示宽泛授权提示。条件值按 JSON 输入（例如 `"203.0.113.0/24"`、`true` 或数组），保留字符串、数字和布尔类型。

从 JSON 切换到可视化前会运行服务端诊断。语法错误、未知字段或当前编辑器无法保留的结构会阻止切换；未完成的可视化表单不能保存，也不能将旧的校验结果用于发布。账号信息缺失时 ARN 模板不可用，请刷新用户信息。生成草稿后仍需通过服务端目录、资源、条件和委派检查。
