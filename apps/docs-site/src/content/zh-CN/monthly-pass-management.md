# 月卡管理

此页面用于管理月卡模板和用户分配记录。

## 页面用途

- 维护月卡模板。
- 发布或下线模板。
- 复制已有模板快速创建新方案。
- 为用户分配月卡并查看分配状态。

## 你会看到什么

### 模板管理

- 模板列表。
- 搜索与筛选。
- 新建、复制、编辑、发布、下线、删除等动作。

### 分配管理

- 按用户、模板、状态筛选。
- 新建分配。
- 查看分配状态与有效期。

## 常见操作

1. 先创建或复制一个接近需求的模板。
2. 配置有效期、额度、时间窗口、可用渠道和模型。
3. 发布模板供后续使用。
4. 为目标用户创建分配记录。
5. 需要停用时再下线模板或调整分配。

## "额度"、"渠道"、"模型" 分别指什么

- **额度** 是模板授予的用量上限（例如每张月卡固定的转发用量额度），与用户的常规余额是两套独立的计量方式。
- **渠道** 用于限制该月卡可使用哪些转发渠道（路由/供应方目标），可参考术语表中的"渠道"词条了解一般概念。
- **模型** 用于限制该月卡覆盖哪些 AI 模型。未设置模型限制的月卡可在其允许的渠道范围内使用任意模型。

## 说明

- 模板与分配是两个层次：模板定义规则，分配决定谁在什么时候使用。
- 模板的有效期决定新领取和新分配月卡的默认持续天数；管理员在单次或批量分配时仍可调整具体的开始和结束时间。修改模板有效期不会改变已经发放月卡的到期时间。
- 若用户反馈月卡不可用，应同时检查模板状态、分配状态和用户页面展示。
- 用户侧对应页面为 `my-monthly-passes`。

## 所需权限

| 操作                                   | 所需权限                        |
| -------------------------------------- | ------------------------------- |
| 查看模板                               | `MONTHLY_PASS_TEMPLATE_READ`    |
| 新建、编辑、发布、下线、删除模板       | `MONTHLY_PASS_TEMPLATE_WRITE`   |
| 查看分配记录                           | `MONTHLY_PASS_ASSIGNMENT_READ`  |
| 新建、编辑、删除分配记录（单个或批量） | `MONTHLY_PASS_ASSIGNMENT_WRITE` |
| 查看用量记录                           | `MONTHLY_PASS_USAGE_READ`       |

## 资源级授权

启用 IAM 强制授权后，月卡管理使用以下服务端 Action。模板和管理端分配属于部署共享资源：操作者还需具备部署管理员配置的全局管理组资格，账号自己的策略或用户组不能自行取得这项资格。

以下资源路径均位于 `acs:platform:*:platform:` 下。`userId`、`passId` 等标识应替换为实际资源 ID。

| 操作           | Action                                   | 资源路径                                                                                             |
| -------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 查看模板       | `quyan:monthly_pass:ListTemplates`       | `monthly-pass-template/<templateId>`                                                                 |
| 查看分配记录   | `quyan:monthly_pass:ListUserPasses`      | `monthly-pass/<userId>/<passId>`                                                                     |
| 查看用量记录   | `quyan:monthly_pass:ListUsages`          | `monthly-pass-usage/<userId>/<passId>/<usageId>`                                                     |
| 新建分配       | `quyan:monthly_pass:AssignUserPass`      | 目标 `user/<userId>`、`monthly-pass-template/<templateId>` 和新建的 `monthly-pass/<userId>/<passId>` |
| 批量新建或续期 | `quyan:monthly_pass:AssignUserPassBatch` | 每个目标的用户、模板及新建或续期月卡                                                                 |
| 更新分配       | `quyan:monthly_pass:UpdateUserPass`      | `monthly-pass/<userId>/<passId>`                                                                     |
| 删除分配       | `quyan:monthly_pass:DeleteUserPass`      | `monthly-pass/<userId>/<passId>`                                                                     |
| 获取筛选选项   | `quyan:monthly_pass:GetFilterOptions`    | 对应的 `monthly-pass-template`、`model-pricing`、`relay-channel` 和 `group` 资源                     |

列表先按资源授权，再统计和分页。分配列表中的用户名、模板详情还需要 `ListUserPasses` 对相关用户、模板的 Allow；用量列表中的模板名称需要 `ListUsages` 对模板的 Allow。更新结果中的关联详情同样由 `UpdateUserPass` 控制。单张月卡的已用和剩余额度随记录返回；额度窗口用量只有在所有相关有效用量记录都获准读取时才返回，避免根据部分可见记录显示错误的零值或低估用量。

新建分配必须同时允许目标用户、模板及生成的月卡 ARN。可使用 `monthly-pass/<userId>/*` 限定该用户下的创建范围。仅允许用户和模板不足以创建月卡。更新时将状态改为删除还需要 `DeleteUserPass`。权限、客户归属、模板或额度窗口在操作期间变化，或月卡发生并发消费时，操作会失败并保留原额度。批量中的每个目标独立处理，失败项回滚，其他获准目标可成功；未授权用户名不会出现在失败结果中，按筛选条件发现但未获准的用户也不会出现在结果中。

未获准的筛选选项不会显示。渠道还需满足原有隐藏、私有和白名单规则；用户组仅包括当前管理级别可见的全局组，不显示其他账号的组。筛选权限仅返回名称和标识，不授予渠道密钥、用户组权限配置或完整模板详情。用量记录中的历史模型、渠道信息随记录返回；模板中的可用渠道标识也不代表可以读取当前渠道配置。

## 相关页面

- [我的月卡]({{DOCS_BASE_URL}}/zh-CN/my-monthly-passes)
- [兑换码管理]({{DOCS_BASE_URL}}/zh-CN/redemption-code-management)
