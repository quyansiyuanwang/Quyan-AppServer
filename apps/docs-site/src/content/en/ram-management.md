# RAM (Resource Access Management)

RAM is the authorization and access control hub. It lets you create sub-users, define roles, write permission policies, and bind them together. Every mutating operation requires a 2FA step-up challenge, and all role/policy/attachment changes trigger security notification events.

## What you can manage

- **RAM Users** — Sub-accounts under your main account with separate credentials.
- **RAM Roles** — Named collections of permissions with optional trust policies and session duration limits.
- **Permission Policies** — Custom JSON permission lists that can be attached to users, roles, or groups.
- **Role Bindings** — Grant a role to a user or group.
- **Policy Attachments** — Attach a permission policy to a user, role, or group.
- **Role Sessions** — Active sessions created when a user assumes a role.
- **Authorization Overview** — View a user's effective permissions computed from all sources.

## Page structure

The RAM console uses dedicated URLs for overview, identity management, permission management, and sessions instead of a single large tabbed page. Legacy user, role, binding, policy, authorization, and session links with a `tab` parameter move to their corresponding page.

### Users

Create and manage RAM sub-users. Each user can have console access, API access keys, or both.

- Display name, RAM username, email, group, status, and creation date.
- Set a custom password or auto-generate one.
- Force password reset on first login.
- Password is shown once after creation — copy it immediately.

### Roles

Define named roles that bundle permissions together.

- Role name, description, max session duration.
- Permissions are inherited from attached policies.
- Trust policies restrict which entities can assume the role.

### Policies

Create reusable permission lists that can be shared across multiple targets.

- Policy name, description, type (system or custom).
- Define permissions by selecting from available permission categories.
- View existing attachments via the "Bindings" button.
- Attach to or detach from users, roles, or groups.

### Sessions

Monitor active role sessions.

- See who assumed which role, session name, expiry time.
- Revoke sessions that should no longer be active.

### Authorization

Select a user to view their complete effective permissions.

- Direct permissions assigned to the user.
- Group permissions inherited from their group.
- Role permissions from bound roles.
- Policy permissions from attached policies.
- Removed permissions that are explicitly excluded.

Authenticated identities can read their own permission summary. This baseline applies only to their own user resource and grants no account administration. In enforce mode, reading or checking another identity requires an Allow for `quyan:permission:Manage` on that exact user ARN; the target must also be active and belong to the current account. View on an `account` ARN exposes the full permission catalog but does not grant access to every user. View on a specific user does not expose the full catalog. Explicit Deny can block self inspection. AccessKey identities follow the same rules; AssumeRole uses a valid role session and role policies without inheriting the caller's administrative grants. These three query endpoints retain their original permission checks in legacy/shadow and apply resource checks in enforce.

Personal heartbeat operations use the authenticated user's own ARN: `quyan:user:GetHeartbeatConfig`, `quyan:user:SendHeartbeat`, and `quyan:user:StopHeartbeat`. Catalog metadata `defaultAuthorizationScope: "self"` identifies a narrow default self-service Allow. It grants no online-monitor visibility, authority to force other users offline, or cross-account access. To restrict this baseline, publish an explicit Deny matching the Action and user ARN; a conditional Allow does not narrow an existing default Allow. Client-supplied user IDs, account IDs, and Action headers cannot change the heartbeat target.

## Permission requirements

| Action              | Required permission  |
| ------------------- | -------------------- |
| View RAM users      | `RAM_USER_READ`      |
| Create RAM user     | `RAM_USER_CREATE`    |
| Update RAM user     | `RAM_USER_UPDATE`    |
| Delete RAM user     | `RAM_USER_DELETE`    |
| View RAM roles      | `RAM_ROLE_READ`      |
| Create RAM role     | `RAM_ROLE_CREATE`    |
| Update RAM role     | `RAM_ROLE_UPDATE`    |
| Delete RAM role     | `RAM_ROLE_DELETE`    |
| View role bindings  | `RAM_BINDING_READ`   |
| Create role binding | `RAM_BINDING_CREATE` |
| Delete role binding | `RAM_BINDING_DELETE` |
| View policies       | `RAM_POLICY_READ`    |
| Create policy       | `RAM_POLICY_CREATE`  |
| Update policy       | `RAM_POLICY_UPDATE`  |
| Delete policy       | `RAM_POLICY_DELETE`  |
| Attach policy       | `RAM_POLICY_ATTACH`  |
| Detach policy       | `RAM_POLICY_DETACH`  |
| Assume role         | `RAM_ASSUME_ROLE`    |
| View sessions       | `RAM_SESSION_READ`   |
| Revoke session      | `RAM_SESSION_REVOKE` |

## Security notes

- **2FA required**: All create, update, delete, attach, detach, and bind operations require a 2FA challenge.
- **Always-require endpoints**: Deleting users, roles, policies, and detaching policies require fresh 2FA (the trusted-device window is ignored).
- **Notifications**: All RAM mutating operations dispatch security notification events. Ensure your notification preferences include RAM events.

When adding or removing user permissions, clearing overrides, or replacing group permissions, a change to the checked permissions, group hierarchy, or account ownership returns **409 Conflict** instead of overwriting a concurrent update. Reload the current target, review both grants and revocations, and submit again. A failed request has not taken effect; do not automatically retry stale content.

## Common workflows

1. **Create a RAM user**: RAM Users → Create User → fill in username, RAM username, and choose console/API access → Submit.
2. **Define a role**: Roles → Create Role → name the role and set max session duration → attach policies.
3. **Grant access**: Bind a role to a user, or attach a policy directly to a user.
4. **Audit permissions**: Permission Diagnostics → select a user → review their effective permissions from all sources.

## IAM JSON policies

The policy drawer offers **Permission tree** and **IAM JSON** formats. Choose IAM JSON to paste a policy, then select **Validate JSON** to check it on the server. Validation displays explicit Deny and broad-wildcard warnings; changes to the text invalidate the previous result. Saving validates any unvalidated text first. Existing IAM policies stay in JSON format, and the list shows their default version. Updates include the original document hash: a concurrent change returns 409; reload the policy and review the changes before trying again. With policy-read permission, the JSON editor can load the server Action catalog: place the cursor inside an Action string and select an Action to insert it. Resource examples explain the currently available global and account scopes. The **Simulate authorization** drawer accepts a same-account principal user ID, an Action from the catalog, and a Resource. It evaluates saved policies only, excludes unsaved editor text, and displays the decision, reason, and matched identifiers. Changing the inputs clears the result. Simulation requires its dedicated permission even when the drawer is visible. Select **Version history** on an IAM policy to page through immutable versions and preview their JSON. With update permission, select **Restore** on a non-default custom version and confirm; the operation requires account-owner authorization and two-factor verification. It immediately changes the permissions used by attached identities. A conflict or failed restore requires refreshing and reviewing the current default before retrying. Identity policies support only `Version: "1"`, `Statement`, optional `Sid`, `Effect`, exactly one of `Action`/`NotAction`, `Resource`, and optional `Condition`. Statement accepts an object or array; Action and Resource accept a string or array. Only `*` is a wildcard, and matching is case-sensitive. Unknown fields/versions, Principal, NotResource, and policy variables are rejected rather than ignored.

RAM management operations currently use the account Resource `acs:quyan:*:<account-owner-id>:account`. Their Actions are declared by the server, and target ownership remains checked separately. These management operations follow the configured legacy/shadow/enforce rollout mode; the dedicated simulation Action is always enforced.

Evaluation is **matching explicit Deny > matching Allow > implicit Deny**. Both Action and Resource must match. An ordinary user identity combines user, active-group and assigned-role policies. An assumed-role session uses only the assumed role’s policies and scoped authorizations; it never adds the caller’s user/group permissions or other assigned roles. Legacy permission removals become Deny statements for ordinary user identities. Account isolation, session validity, and business ownership checks remain in place. Actions come from server metadata, never client headers; unresolved resources are rejected.

### Conditions

`Condition` supports string, numeric, date, boolean, IPv4/IPv6, and existence operators. `GET /v1/iam/catalog/condition-keys` lists types, operators, and availability. Supported context includes source IP, current time, User-Agent, HTTPS status, and principal ID/type/account. Resource tags, resource groups, and MFA are unavailable and rejected when submitted. User-Agent is client-controlled and should not be the only security check.

Migrated article-resource operations support `quyan:ResourceOwnerId`, the stored author user ID—not the account ID in the ARN. The server reads live article and author ownership; submitted attributes cannot override it. Only Actions whose catalog entry supports this key may use it. Incompatible Actions, including wildcards expanding into other services, are rejected. Saved-policy and JSON-draft simulations use the same trusted resource attributes; missing, deleted, foreign-account, and case-alias articles fail closed.

Article management listing (`quyan:article:ListArticles`) also supports `quyan:ArticlePublishStatus`, read from the stored publication state (`draft` or `published`), never client input. For example, `StringEquals` can restrict listing to published articles. Only Actions that explicitly declare this key support it. Ownership and publication conditions in one statement are AND; use separate Allow statements for an OR scope.

Operators and keys combine with AND; multiple values for one key use OR. `StringLike` supports `*` and `?`; Action/Resource still support only `*`. `IpAddress` excludes network boundary addresses; `IpAddressIncludeBorder` includes them. Apart from explicit `Null` checks, missing context required by a matching statement fails closed, including conditional Deny statements. Simulation does not supply real IP/HTTPS attributes and returns `missing-condition-context` instead of inventing values.

### Service and resource catalog

With policy-read permission, use `GET /v1/iam/catalog/services`, `GET /v1/iam/catalog/services/{service}/actions`, and `GET /v1/iam/catalog/resources` for platform services, access levels, and ARN templates. API links are generated from server route metadata. The `legacy` stage identifies compatibility authorization; registering a resource template does not mean every endpoint enforces resource-level access. Existing Action names stay compatible; `ReadUser` is not automatically renamed to `GetUser`.

ARN construction, policy validation and evaluation accept registered resource types only. Concrete targets require the correct number of identifier segments; policy versions need both policy and version IDs. Unknown services/types, empty identifiers and extra path segments are rejected. Incompatible Action/Resource pairs fail policy validation. Even a wildcard policy cannot authorize a concrete target outside the Action's registered types. Requests must belong to the authenticated account, and explicit foreign-account policy ARNs cannot be published. Business services still enforce database ownership and list isolation.

### JSON diagnosis and Schema

Send original JSON text to `POST /v1/ram/policies/diagnose` using `documentText` to receive errors, security warnings, warnings and suggestions. Diagnostics include a stable code, JSON Pointer and one-based line/column. Syntax errors, duplicate keys, prototype keys, unknown fields/actions, invalid condition values, resource type mismatches and explicit cross-account ARNs fail validation. Broad Allow grants, IAM management grants and duplicate statements produce risk notices. Diagnostics do not echo arbitrary policy values.

`GET /v1/iam/catalog/policy-schema` publishes JSON Schema generated from the same validator for editors and AI drafts. It includes current production actions, resource templates, implemented condition keys and limits. Custom catalog and account-ownership semantics still require server diagnosis. Schema access requires policy read permission; diagnosis requires policy create or update permission. Successful validation only confirms the current document syntax: `delegation: "not-evaluated"` explicitly means publication/delegation authority has not been proven. Saving and attaching still enforce the existing authorization checks.

The JSON editor sends original text when you choose Validate JSON, grouping results as errors, security warnings, warnings and suggestions. Click a diagnostic to focus its source position. Editing immediately invalidates previous diagnostics and validation. Format validated JSON first validates on the server, then formats the normalized document. Download JSON Schema exports the current contract for external AI draft assistance.

### APIs and permissions

- `POST /v1/ram/policies`: submit name plus either document or legacy permissions, never both.
- `POST /v1/ram/policies/validate`: submit document for normalization, SHA-256 hash, and a broad-wildcard warning; requires policy-create or policy-update permission.
- `GET /v1/ram/iam/actions`: list actions; requires policy-read permission. The catalog contains only implemented platform APIs; the AliCloud DNS policy is a JSON compatibility example, not a provided DNS API.
- `GET /v1/ram/policies/{policyId}/versions`: page through immutable versions using `page` (default 1) and `pageSize` (default 20, maximum 100); returns `items`, `total`, `page`, `pageSize`, `defaultVersionId`, and `defaultDocumentHash`. Requires policy-read permission.
- `POST /v1/ram/policies/{policyId}/versions`: append a version and make it default. Submit document and the current expectedDocumentHash. The hash is optional only for the first legacy-to-IAM conversion. Requires policy-update permission, 2FA, and replay protection.
- `PUT /v1/ram/policies/{policyId}/default-version`: submit versionId and current expectedDocumentHash to restore a historical version; requires policy-update permission, mandatory fresh 2FA, and replay protection. Stale hashes return 409 instead of overwriting another update.
- `POST /v1/ram/policies/simulate`: submit a same-account principalId, action, and resource. Requires a separate Allow for `quyan:iam:SimulatePolicy` on the account resource; policy-read permission alone is insufficient. Returns only the decision, reason, and matched policy/version/statement identifiers, not policy documents or credentials.

Creating, updating, switching defaults, and attaching JSON policies requires the relevant operation permission and an enforce-mode deployment. Sub-users may delegate only a provable subset of their current grants: resources cannot expand and conditions cannot weaken. Uncertain wildcard containment or Deny overlap is rejected. The account owner retains recovery authorization management. System-managed policies cannot be modified through version APIs. IAM policies cannot be downgraded to legacy permission arrays.

### Deployment and migration boundaries

`IAM_AUTHORIZATION_MODE` defaults to `legacy`, preserving legacy enforcement. `shadow` also enforces legacy permissions while auditing IAM differences. `enforce` uses IAM for integrated legacy checks and never falls back on authorization-data failure. Explicit IAM middleware endpoints, including simulation, always enforce IAM. **Not every JWT endpoint has completed explicit Action/Resource migration; enabling enforce does not establish complete coverage.**

Legacy-to-IAM conversion preserves legacy fields for configuration rollback without removing version data. New JSON-only policies do not acquire legacy grants when rolled back. Decisions are uncached; subsequent requests reread bindings, disabled policies, and revoked sessions. Collection filtering, per-resource batch authorization, and ownership checks cannot be replaced by account-level authorization; complete these integrations and shadow comparisons before full rollout.

## Related pages

- `user-management`
- `group-management`
- `permission-management`
- `access-key-management`

## Scoped authorizations and resource-group APIs

An authorization connects a user, group or role to a policy and independently limits its scope. A request must satisfy the policy action, resource and conditions AND the authorization scope. Group membership never allows a resource excluded by the policy.

| Operation             | API                                                           | Required action                       |
| --------------------- | ------------------------------------------------------------- | ------------------------------------- |
| List authorizations   | `GET /v1/ram/authorizations`                                  | `quyan:ram:ListAuthorizations`        |
| Create authorization  | `POST /v1/ram/authorizations`                                 | `quyan:ram:CreateAuthorization`       |
| Delete authorization  | `DELETE /v1/ram/authorizations/{authorizationId}`             | `quyan:ram:DeleteAuthorization`       |
| List resource groups  | `GET /v1/ram/resource-groups`                                 | `quyan:ram:ListResourceGroups`        |
| Create resource group | `POST /v1/ram/resource-groups`                                | `quyan:ram:CreateResourceGroup`       |
| Add member            | `POST /v1/ram/resource-groups/{groupId}/members`              | `quyan:ram:AddResourceGroupMember`    |
| Remove member         | `DELETE /v1/ram/resource-groups/{groupId}/members/{memberId}` | `quyan:ram:RemoveResourceGroupMember` |

These actions require dedicated IAM grants; existing group-management or attachment permissions do not automatically grant them. Writes require replay protection and two-factor authentication. Lists accept `page` and `pageSize` (default 50, maximum 100). Account isolation and database pagination run before per-row IAM filtering, so pages may contain fewer rows and never expose an unfiltered total. Listing a collection requires account-scoped list access; each returned authorization or resource group also requires list access on its own ARN.

Create an authorization using:

```json
{
  "principalType": "user",
  "principalId": "user-id",
  "policyId": "policy-id",
  "scopeType": "resource",
  "scopeArn": "acs:quyan:*:account-id:user/target-user-id"
}
```

- `account`: omit scopeArn and scopeResourceId. Account grants are projected into legacy attachment views.
- `resource`: supply a registered current-account ARN or resource-path wildcard; standalone `*` is forbidden.
- `resource-group`: supply a current-account scopeResourceId; omit scopeArn.

Create groups with name and optional description; add members with resourceArn. Members must be real active resources owned by the account, never wildcards or invented ownership. Removing a member immediately stops group-scoped grants; disabled resources or resources that leave the account also stop receiving these grants. Admission rechecks delegation, preventing beneficiaries from expanding their own scope. The authorization page supports paged groups, member management and selecting a group for authorization.

One policy may have multiple scopes. Deny applies only within its authorization scope. Concurrent policy-version or group changes require rereading and retrying; a failed change does not authorize anything. Sub-users cannot mutate recovery relations of the owner, the owner's group or recovery roles.

## Role trust policies

Role assumption in enforce mode requires **identity Allow AND role-trust Allow**. Matching Deny on either side wins. A legacy role assignment alone does not satisfy trust, and a trust Allow alone does not grant AssumeRole. Configure trust for existing roles and review session-isolation differences before enforcing the rollout.

A trust policy requires Principal; identity policies continue rejecting Principal. This release accepts exact active current-account RAM user principals only, including the owner’s user ARN. Wildcard principals, cross-account identities, service principals and role chaining are not accepted. Action must be quyan:ram:AssumeRole and resources must be registered role ARNs.

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

Use `GET /v1/iam/catalog/policy-schema?policyKind=trust` for the separate JSON Schema. Diagnose original JSON through `POST /v1/ram/policies/diagnose` with documentText and policyKind set to trust; errors retain JSON Pointer and line/column positions. Schema access and diagnosis retain the policy-read/create/update permissions described above. Diagnosis checks syntax and explicit cross-account principals; publication additionally verifies that principals really exist in the account and that delegation is allowed.

Publish with `PUT /v1/ram/roles/{roleId}/trust-policy` using document and optional expectedDocumentHash. This API requires `quyan:ram:UpdateRoleTrustPolicy` on that role, replay protection and 2FA. General role-update permission does not automatically grant trust publication. The existing role create/update APIs still accept trustPolicy but require the same dedicated action whenever it is supplied (account scope on creation, role scope on update). Role responses include trustPolicyHash for valid trust documents; stale hashes or role versions return 409. Publication proves AssumeRole access and the role’s complete effective grants, preserving every authorization scope. The role list provides a separate trust editor.

In enforce mode, assume-role authorizes the concrete role ARN from the validated roleId. Simulation of quyan:ram:AssumeRole on that ARN also combines identity and saved trust. Simulations do not invent IP/HTTPS context. Roles without valid trust are rejected under enforce; legacy/shadow retain the old bound-role/owner admission path.

Issued sessions use only the selected role’s current permissions and remain subject to account, status, expiry and revocation checks. Trust changes govern new sessions; existing sessions end by expiry or explicit revocation, not by rechecking the original trust conditions on every request. A group’s user-policy Deny does not become a session permission boundary: to prevent switching identities, deny AssumeRole; to stop issued sessions, revoke them. Matching Deny inside the role’s policies still overrides its Allow.

User updates/deletion, role deletion, session revocation and policy mutations/version management resolve concrete target ARNs within the authenticated account. Role-to-user/group and policy-to-principal bindings require grants on both entities. Changing the default policy version requires both the policy and selected version. Assigning a user group also proves that its direct, role-derived and scoped grants can be delegated by the operator.

Legacy Permission grants retain their account-wide meaning through registered resource patterns inside that account. A hand-written JSON `account` ARN denotes the account target; it never implicitly covers every user or policy. Previously saved JSON versions are not rewritten, so review migration differences through simulation and shadow evaluation.

The visual and JSON editors share one identity-policy draft. Filter service actions by Read, Write and List, add/duplicate/remove statements, insert current-account ARN templates using resource IDs, and choose supported condition keys and operators. Templates never default to all resources; explicitly selecting `*` shows a broad-grant warning. Enter condition values as JSON, such as `"203.0.113.0/24"`, `true` or an array, to retain scalar types.

Switching from JSON to visual editing first runs server diagnosis. Syntax errors, unknown fields and structures the visual editor cannot preserve block the switch. Incomplete visual drafts cannot be saved or reuse an earlier validation result. ARN templates are disabled without account information; refresh user information to restore them. Drafts still require server catalog, resource, condition and delegation checks before publication.

## AI policy drafts

Expand “AI policy draft” in the policy editor. Describe the required operations, resource IDs and conditions, and supply a model ID and a relay token ID that you own. The token ID is not its secret; the token and current channel must allow the selected model. Selecting “Send the current JSON draft to AI for revision” also sends that text to the model. Do not include passwords, keys or tokens in instructions or drafts.

Generation requires the separate account-scoped `quyan:ram:GeneratePolicyDraft` permission. It reuses existing model billing, safety checks and token validation, without creating a chat conversation. Current limits are 10 requests per user per 10 minutes, 4000 instruction characters and 16384 characters for an existing draft. Timeouts and incomplete responses do not yield partial policies.

Results include risk, explanations, missing information, diagnostics and the current delegation proof. Unknown actions, invalid JSON, duplicate keys, cross-account ARNs and unsupported fields cannot become applicable policies. Changing requirements or the current draft invalidates old results. “Apply to editor” only replaces the editable JSON: validate it, review the scope and explicitly save. AI cannot create policies, publish versions or attach authorizations. Unproven delegation is high risk; even a returned draft cannot bypass publication checks.

`POST /v1/ram/policies/ai/draft` requires JWT and replay protection. Submit instruction, model and relayTokenId, with optional policyKind (identity or trust) and currentDocumentText. Identity drafts undergo current-account catalog, resource, condition and delegation checks. Trust drafts receive structural and account diagnostics only, and return a not-evaluated status; publication still requires a role target, real principals and trust delegation checks. The API does not save generated content or expose raw upstream responses.

## Simulate an unpublished draft

Choose “Simulate current draft” from either editor, then specify an account principal, action and resource. Alternatively, select draft mode in the simulator and paste identity-policy JSON. Simulation requires the separate `quyan:iam:SimulatePolicy` permission and cannot create policies, publish versions or change authorizations. Editing the draft, request or policy source immediately invalidates old results.

Draft mode evaluates only the supplied identity draft, excluding saved identity grants. Disable it to evaluate bound policies. Compare them separately: a draft Allow neither proves delegation nor overrides other Deny statements after attachment. Simulating `quyan:ram:AssumeRole` still combines the identity result with the target role’s saved trust policy. Only identity drafts are supported; hypothetical trust changes are not simulated.

Supply raw JSON through the optional documentText field of `POST /v1/ram/policies/simulate`. Duplicate keys, unknown fields, cross-account documents and invalid syntax are rejected, and request resources must remain in the account. Matched statements use `simulation:draft`, not a persisted policy ID. Simulation uses trusted attributes of the selected principal and the current time, without inventing source IP or HTTPS conditions. Missing required context denies the request; simulation is not a final authorization for a real HTTP request.

Management clients can use `GET /v1/ram/authorizations/page` and `GET /v1/ram/resource-groups/page` for items, page, pageSize and hasNext. Group summaries exclude nested members; fetch them separately through `GET /v1/ram/resource-groups/{groupId}/members`, requiring list permission on that specific group. The default page size is 50, capped at 100. Authorization and group candidate pages are account-scoped before resource filtering, so even an empty page can have hasNext set to true. Allow advancing to the next page: hasNext is candidate continuation, not an authorized total. Existing list APIs remain compatible; new management views should use the paged APIs.

Role and policy lists also use server-side candidate pages: `GET /v1/ram/roles/page` and `GET /v1/ram/policies/page` return items, page, pageSize, and hasNext. In enforce mode, account collection access opens the list, while each role or policy requires its own read permission; a matching Deny hides the record and its policy contents. Search filters only the current page. Role choices in the binding page and policy attachment form have page controls; changing pages clears selections that are no longer available. Mutations refresh the current page. In enforce mode, the legacy array endpoints return only the filtered default first page; clients that need all visible records must use the paginated endpoints.

Group choices when creating RAM users, binding roles, or attaching policies use `GET /v1/ram/groups/page`. It accepts page, pageSize, and keyword and returns items with hasNext. In enforce mode, opening the list requires `quyan:group:Read` on the account, and each option requires read access on its group ARN; user-read permission does not substitute for group-read permission. Candidates are restricted by account and the historical group-level rule before IAM filtering, and counts include only users in the account. Only the real account-owner recovery identity can see its unowned recovery group; sub-users, AccessKeys, and role sessions do not inherit that exception. All three forms include group page controls and clear old group targets after a page change or load failure. Legacy/shadow retain the historical RAM user-read entry check and group visibility rules; pagination does not change authorization in those modes.

RAM users and role sessions use `GET /v1/ram/users/page` and `GET /v1/ram/sessions/page`; sessions can also be filtered by principalUserId. In enforce mode, each user or role-session ARN requires read access; an account collection Allow does not automatically allow every row. User candidates are restricted to the account before evaluation; an explicit foreign account cannot be overridden by a legacy parentUserId. Session pages include only active, unrevoked, unexpired records with consistent subject and role ownership. User search filters the current page. User choices for bindings, policy attachments, and effective-permission inspection have page controls; changing pages clears the previous choice and permission explanation. In enforce mode, legacy array endpoints return the filtered default first page; legacy/shadow retain historical array results.

Role bindings use `GET /v1/ram/roles/{roleId}/bindings/page` with page, pageSize, and optional userId. Candidate pages list direct user bindings before group bindings, with stable creation-time and ID ordering within each source. In enforce mode, `quyan:ram:binding:Read` must cover both the parent role ARN and each relation’s user/group ARN. Parent access alone does not expose bound principals; a target Deny hides that row. Candidates exclude foreign accounts, invalid targets, and inconsistent ownership; userId must also belong to the account. Changing roles resets binding pagination and discards old responses. The legacy array API returns the filtered default first page in enforce mode; legacy/shadow retain historical behavior.

Policy attachment drawers use `GET /v1/ram/policies/{policyId}/attachments/page`. In enforce mode, the parent policy ARN requires `quyan:ram:ReadPolicy`. Each relation also requires the target’s corresponding `quyan:ram:ReadUser`, `quyan:group:Read`, or `quyan:ram:role:Read`. Reading a policy does not automatically disclose target names. Candidates are limited by account, active policy, and active relation; missing, invalid, or foreign-account targets are excluded. Empty filtered pages can still continue. Switching policies or closing the drawer clears old rows and discards late responses. The old array endpoint returns the default filtered first page in enforce mode; legacy/shadow preserve its historical behavior.

## Create scoped authorizations in management

Open the RAM “Authorization” page to browse paged resource groups, members and authorization relations. “Use in authorization” copies a group ID into the scope form; copy principal and policy IDs from their management lists. Choose account, resource-group or resource scope: supply a group ID for group scope, a same-account ARN for resource scope, and no additional resource field for account scope.

Creating refreshes the relation list. Revocation requires confirmation and still undergoes dedicated IAM action, 2FA, account ownership and delegation checks. Group members use separate server pagination. Enter an exact ARN to add a member and confirm the access impact before removal. Failed loads can be retried, and empty filtered pages can still advance. The page retains existing RAM menu visibility permissions; each list and mutation independently enforces its new IAM action. Menu visibility does not grant access.

In enforce mode, the final effective-permission list shares IAM evaluation with the user-permission API. Only legacy actions allowed on the account target project to global Permission; specific-resource Allow is never broadened. Explicit Deny removes the corresponding projected permission. Inspecting yourself uses the current authenticated identity and role session; inspecting another principal does not borrow the operator’s session. AccessKey principal-type conditions also affect the current identity’s projection. Source arrays remain historical explanations and may omit JSON-only grants; use simulation to check a particular ARN. Legacy/shadow historical display remains compatible.

The role list provides a “Role trust policy” editor for separate trust JSON, trust Schema downloads, original-text diagnostics and trust-kind AI drafts. Applying AI output only edits the draft. Publication first diagnoses trust, then confirms its impact on new-session admission and sends the role’s existing trustPolicyHash to detect concurrent changes. Syntax checks do not prove publication permission: the server still checks real same-account principals, dedicated UpdateRoleTrustPolicy, AssumeRole delegation and effective role grants. Failures retain the draft for review; reload a role after a version conflict. Existing sessions require separate revocation.

When granting legacy Permission to a user or group under enforce, the server expands it to all registered resource scopes inside the account and proves the operator can delegate that complete scope. An account-target menu Allow does not prove authority over every concrete resource. Removing a permissionRemoves Deny or clearing the configuration may restore denied capabilities, so the restored permissions also require delegation proof. Account and recovery-identity checks remain server-side; legacy/shadow retain migration compatibility.

In enforce, permission-management endpoints authorize user/<userId> or group/<groupId> rather than relying on account-level menu permissions. Clearing user overrides requires both Add and Remove on that user; replacing group permissions independently checks additions and removals. Group permission reads and writes verify account ownership, so resource wildcards cannot cross accounts. Legacy unowned recovery groups remain accessible only to their real account-owner recovery identity. Target-operation authorization and proof of the delegated permissions are separate checks.

Identity `NotAction` uses conservative snapshot semantics: the server selects only currently registered operations compatible with the declared resource types and not excluded by the selector, then compiles them to exact `Action` values without wildcards. Diagnosis locates the notice on the original NotAction field; the full expanded Allow requires delegation proof. Missing or conflicting selectors, unknown actions, an empty expansion and capacity overflow are rejected. Immutable versions and hashes represent the expanded JSON. New catalog actions never enter an existing snapshot automatically; extending it requires validation and a new version. JSON editing accepts NotAction, and the visual editor imports the server-diagnosed expanded actions. Role trust still requires explicit AssumeRole Action.

In enforce, replacing user overrides checks the actual changes: adding grants or removing Deny requires Add on the target user; deleting grants or adding Deny requires Remove, and mixed changes require both. Add-only managers cannot bypass removal checks through replacement, and Remove-only managers cannot restore denied capabilities. Restored access still requires delegation proof. Legacy/shadow retain this endpoint’s historical Add admission rule.

## Developer project resource authorization

Project management uses `acs:developer:*:<accountId>:project/<projectId>`. `quyan:developer:GetProject`, `GetProjectUsage`, and `UpdateStatusPage` independently control project details, usage, and status-page publication. In enforce mode, a same-account identity can receive access to a specific project while its stored owner remains unchanged. IDs in an ARN cannot grant access to foreign or disabled projects or projects whose owner is disabled.

`GET /v1/developer/projects/page` accepts page/pageSize and returns items, page, pageSize, and hasNext. Account-isolated candidates are paginated before each project is checked against `quyan:developer:ListProjects`. An Allow on a specific project permits that row without an account-wide Allow. An empty page may still have a next page; no unauthorized total is returned. The legacy array endpoint returns only the default first page in enforce; use the page endpoint to traverse results. `GET /v1/developer/projects/{projectId}` returns authorized project details.

Creation requires `quyan:developer:CreateProject` on the authenticated user's `acs:quyan:*:<accountId>:user/<userId>` ARN, and the created project belongs to that user. Personal baseline capabilities do not include project management. legacy/shadow retain individual project ownership checks, shadow records differences, and enforce never falls back after an evaluation failure.

## Developer KV and Secret resource authorization

JWT project management can delegate a single KV key or a single Secret alias. Resource formats are:

- KV: `acs:developer:*:<accountId>:kv-item/<projectId>/<encodedKey>`. encodedKey is the UTF-8 base64url encoding of the original key, without padding. For example, `config:prod` becomes `Y29uZmlnOnByb2Q`.
- Secret: `acs:developer:*:<accountId>:secret/<projectId>/<ALIAS>`, preserving uppercase aliases.

Item read/write responses and paginated metadata include an optional `resourceArn` that can be copied into a JSON policy. Secret responses contain metadata only, never plaintext, ciphertext, IV, or authentication tags.

KV uses `quyan:developer:ListKv`, `GetKv`, `SetKv`, and `DeleteKv`; Secret uses `quyan:developer:ListSecrets`, `PutSecret`, and `DeleteSecret`. Reads, writes, and deletion are independent. Creating a new key or alias requires write authority on that exact target ARN. Same-account delegation preserves the project's owner, and project grants do not automatically cover KV or Secret resources.

`GET /v1/developer/projects/{projectId}/kv/entries/page` and `GET /v1/developer/projects/{projectId}/secrets/page` accept page/pageSize and return items, page, pageSize, and hasNext. Candidates are limited to the active project and its account before per-key or per-alias List checks. An empty page may have a next page; no total is returned. KV lists contain no values. Expired keys behave as absent, and enforce reads/lists never delete them. Array endpoints return only the default first page in enforce; `GET .../kv/page` still reads the key named page.

KV and Secret resources can join a resource group. Removal changes the scope on the next request. Members must exist, be active, and belong to the current account; expired KV, disabled resources, and projects with disabled owners cannot provide group-scoped access. These rules apply to JWT project management; product-instance API keys retain their independent permission checks.

## Short Link resource authorization

Short Links use `acs:developer:*:<accountId>:short-link/<projectId>/<linkId>`. `quyan:developer:CreateShortLink` controls project-scoped creation; `ListShortLinks`, `UpdateShortLink`, `DeleteShortLink`, and `GetShortLinkStats` control individual links. Statistics include visitor details and require a separate grant. Creation and project listing do not automatically expand to every link.

`GET /v1/developer/projects/{projectId}/short-links/page` paginates candidates before per-resource filtering, returning resourceArn and hasNext without an unauthorized total. Empty pages remain traversable; the old array endpoint returns only the default first page in enforce. Individual links support resource-group scope. Cross-project IDs, foreign accounts, disabled rows, and disabled project owners are rejected; paused or expired links remain manageable with the appropriate grant. See [Short Link](./developer-product-short-link).

## Project API key metadata and revocation

Project API keys use `acs:developer:*:<accountId>:project-api-key/<projectId>/<keyId>`, identifying the credential record without full key material or hashes. `quyan:developer:ListProjectApiKeys` controls per-key metadata; `RevokeProjectApiKey` controls revocation of a specific credential. Listing does not grant revocation, and project-level listing does not automatically cover child resources.

`GET /v1/developer/projects/{projectId}/keys/page` returns items, page, pageSize, and hasNext. Candidates are limited to non-revoked credentials under an active same-account project before per-item evaluation. Responses contain resourceArn, name, prefix, scopes, and other metadata, never the full key, keyHash, or legacyKeyHash. Empty pages may have a next page, with no total. The old array endpoint returns only the default first page in enforce. Expired but non-revoked credentials remain inspectable and revocable; revocation immediately stops project-key authentication and removes group-scoped access.

Same-account identities can receive metadata or revocation authority on one credential. Foreign accounts, cross-project IDs, and disabled resources are rejected. legacy/shadow keep individual project ownership. Issuance has independent scopes rules; metadata and revocation Actions do not grant key issuance.

Resource identifiers must exactly match the stored letter case. Even when the database considers two keys equal, enforce rejects differently cased keys or IDs rather than treating them as a different authorized resource. A case change cannot bypass an existing Deny. KV writes and deletion recheck exact identity in a transaction; resource groups also require ARNs matching stored identifiers.

## Status Monitor resource authorization

Status Monitors use `acs:developer:*:<accountId>:status-monitor/<projectId>/<monitorId>`. Creation is authorized on the project ARN, while listing filters individual monitors. Update, deletion, and manual HTTP checks are independent Actions; modification or listing does not imply checking. Enforce supports same-account single-monitor delegation and resource-group scope, rejects foreign accounts, wrong projects, and inactive resources, and retains SSRF validation. Pages expose hasNext rather than an unauthorized total, and empty pages remain traversable. See [Status Monitoring](./developer-product-status) for the available JSON Action names and details.

## Project Push Channel resource authorization

Channels use `acs:developer:*:<accountId>:push-channel/<projectId>/<channelId>`. Creation is project-scoped, sensitive configuration listing filters individual channels, and updates and deletion are independent grants. Binding a managed Secret, or changing a destination or enabling a channel while retaining the reference, additionally requires `quyan:developer:UseSecret` on the exact Secret ARN. Ordinary channel management or Secret writes do not imply this capability. Management does not decrypt; transaction-time checks prevent concurrent replacements from inheriting stale authorization. See [Push Aggregation](./developer-product-push) for pagination, resource groups, and mode boundaries.

## Project Delivery record authorization

Delivery records use `acs:developer:*:<accountId>:push-delivery/<projectId>/<deliveryId>`. ListPushDeliveries and GetPushDelivery independently control lists and details; channel management does not imply record access. Row filtering and resource groups verify the record and channel share an active project and account. No message body or raw error is returned. Failures expose a fixed failureReason; the old error field is no longer populated, preventing historical credential disclosure. See [Push Aggregation](./developer-product-push) for APIs, pagination, and deletion effects.

## Balance and gift-code resource authorization

In enforce mode, personal balance reads, usage, transfer configuration, gift-code creation, transfers, and redemption use `quyan:balance:GetAccount`, `GetUsage`, `GetTransferConfig`, `CreateGiftCode`, `CreateTransfer`, and `RedeemCode` respectively (the latter five share the `quyan:balance:` prefix). Their target is `acs:quyan:*:<accountId>:user/<userId>`. These operations have a narrow default self-service Allow for the authenticated user; a matching explicit Deny takes precedence. Sending a transfer grants no authority to inspect or manage the recipient's account. Balance, fee, 2FA, and replay checks still apply.

`quyan:balance:GetUserBalance` covers single-user and batch reads in balance administration and targets real `acs:quyan:*:<accountId>:user/<userId>` resources. This sensitive permission has no default self-service grant and is separate from personal balance reads. Enforce mode accepts only active users in the current account. Batch requests deduplicate user IDs and require every target to be allowed; a denied, invalid, or cross-account target rejects the whole request. Authorization and user versions are checked again before returning. A single-user read of an uninitialized balance returns zero, while batch reads continue to return only initialized accounts. Reading does not create a balance account.

`quyan:balance:RechargeUserBalance` authorizes administrative credits and debits on a specific user resource. It is separate from balance reads and has no default self-service grant. The target must be an active user in the current account. Before changing balances and committing ledger rows, the server rechecks identities, role sessions, account membership, user revisions and policy authorization. A failed recheck rolls back balances, counters and ledger rows. Positive credits and negative debits retain the existing statistics option; 2FA and replay protection remain required, and successful adjustments use existing notification preferences.

`quyan:balance:ListUserTransactions` covers the administrative ledger list and evaluates each `acs:balance:*:<accountId>:transaction/<userId>/<transactionId>` resource separately. It has no default self-service grant and does not grant recharge access. Enforce mode limits database candidates to active users in the current account, removes unauthorized entries before counting and pagination, and applies token-name filters before pagination. Policies and ledger revisions are checked again before returning; revoked grants and unavailable records are excluded. Resource groups can contain specific ledger entries, and their grants cease to apply when the entry or user becomes unavailable. Display data comes only from authorized entries and associated records belonging to their user, without token values or channel configuration. Automatic-pool channel names use stored display snapshots. As with the existing ledger list, queries cover only the last 30 days.

User-created balance gift codes have concrete ARNs: `acs:balance:*:<accountId>:gift-code/<creatorUserId>/<giftCodeId>`. `quyan:balance:ListGiftCodes` evaluates each resource, and `quyan:balance:CancelGiftCode` checks the specified gift code. The default self-service scope covers only codes created by the authenticated user; knowing a code ID grants no authority over another user's codes. Both list records and totals include only codes allowed for viewing, and the list cannot reveal the redemption strings of denied resources.

For example, this policy blocks viewing and cancelling a specific gift code while retaining the default capabilities for other codes. Replace the account, user, and gift-code IDs with your own real resources:

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

Adding an Allow with stricter conditions does not narrow an existing default Allow. Use a Deny matching the operation and resource to restrict default capabilities. Authentication determines the resource account; client-supplied account IDs and Action headers cannot change the target. legacy retains the previous rules, shadow compares IAM and legacy list results, and enforce denies requests when resource resolution or authorization data retrieval fails.

## Carpool order resource authorization

In enforce mode, `quyan:carpool:ListMyOrders` evaluates each `acs:carpool:*:<accountId>:order/<orderId>` resource. List records and totals include only orders allowed for viewing. Storage checks the authenticated user's active membership before authorization; granting an order ARN to a nonmember does not expose its content. Detail reads use `quyan:carpool:GetOrder`; list permission does not automatically grant detail reads or writes.

Creating an order uses `quyan:carpool:CreateOrder` and requires Allow on both the authenticated user's ARN and the chosen published package ARN, `acs:carpool:*:<accountId>:template/<templateId>`. Accepting an invitation uses `quyan:carpool:AcceptInvite` and requires Allow on both the user's ARN and the order ARN resolved by the server from a valid invitation. Invitation tokens are not authorization grants and never enter resource ARNs or IAM audit logs. Forged order IDs, account IDs, and Action headers cannot change these targets.

Inviting, allocating ratios, confirming a share, leaving, cancelling, and submitting use `quyan:carpool:CreateInvite`, `AllocateRatios`, `ConfirmMember`, `LeaveOrder`, `CancelOrder`, and `SubmitOrder` respectively (the latter five share the `quyan:carpool:` prefix). Each targets a concrete order ARN. IAM Allow does not replace membership or initiator checks or bypass order state, invitation expiry, share ratios, or balance requirements. No matching Allow means denial, and any matching Deny takes precedence.

legacy retains the previous membership rules, shadow preserves business results and compares the IAM list population, and enforce rejects requests when resolution, policy retrieval, or final grant revalidation fails. Package operations and administrative fulfillment have separate management permissions; self-service order grants do not provide those capabilities.

## Chat, gift-code, and carpool resource groups

Resource groups can contain chat conversations, messages, balance gift codes, and carpool orders. Actual ownership is checked when adding a resource and on every authorization: chat resources require an active conversation owner; gift codes require the creator to match the user in the ARN; carpool orders require at least one active member in the account who has not left. Deleting a resource, disabling its owner, or removing the last eligible member stops the group from granting an Allow for that resource. Any other grants still follow the normal policy rules.

Published, active carpool templates can also be included to limit the offerings an account may use. This ARN scopes the account's use of a shared template and does not confer template ownership or administration rights. Unpublished, archived, or disabled templates cannot supply resource-group grants.

## User script resource authorization

Scripts use `acs:script:*:<accountId>:script/<userId>/<scriptId>`. Creating a script with `quyan:script:CreateScript` checks the current user's resource, `acs:quyan:*:<accountId>:user/<userId>`. Updating and deleting use `quyan:script:UpdateScript` and `quyan:script:DeleteScript` against the specific script resource.

`quyan:script:ListScripts` authorizes each script individually. Unauthorized scripts are excluded, and their bodies are not read. Scripts can join resource groups in their own account; disabled, deleted, or foreign-account scripts cannot join. Resource policies do not remove the business rule that users can only update or delete their own scripts, and do not automatically grant script permissions to all authenticated users.

Execution histories use `acs:script:*:<accountId>:execution/<userId>/<executionId>`. `quyan:script:ListExecutions` checks each history resource and its linked script, if any, before returning up to the 50 most recent authorized records. Unlinked histories remain authorized against their own resources. Owned snapshots of deleted scripts can be retained, but new histories cannot be linked to a deleted script. Execution histories can also join resource groups in their account.

Saving a history with `quyan:script:SaveExecution` checks the current user's resource and, when linked, the specific script. Another user's script, a deleted script, or a foreign-account script cannot be linked. The history API stores execution snapshots; it does not execute script code on the server.

## Own ticket resource authorization

Tickets use `acs:ticket:*:<accountId>:ticket/<userId>/<ticketId>`. Creating a ticket with `quyan:ticket:CreateTicket` checks the current user's resource. Reading, updating and adding comments use `quyan:ticket:GetOwnTicket`, `quyan:ticket:UpdateOwnTicket` and `quyan:ticket:AddOwnComment` against the specific ticket.

`quyan:ticket:ListOwnTickets` authorizes each ticket before pagination and counting. Unauthorized ticket bodies and contact details are not returned. Account policies do not override ownership: self-service endpoints cannot access another user's tickets, even in the same account. Internal comments remain hidden from the submitter, and closed tickets cannot be edited or commented on. Active tickets can join resource groups in their own account. Authentication alone does not grant these ticket operations.

## MCP server configuration resource authorization

MCP servers use `acs:mcp:*:<accountId>:server/<userId>/<serverId>`. `quyan:mcp:ListServers` authorizes each configuration; denied configurations are excluded. The server reads only permitted endpoints, tool allowlists and a credential-existence marker, not credential ciphertext.

Creating a configuration with `quyan:mcp:CreateServer` checks the current user's resource and verifies that the user is active in the current account. MCP configurations can join resource groups in their account. Self-service management cannot access a foreign account's, another user's or a deleted configuration. Configuration authorization does not approve Agent tasks or tool execution; their own permissions and runtime safety constraints still apply.

## Agent machine resource authorization

Machines use `acs:agent:*:<accountId>:machine/<userId>/<machineId>`. `quyan:agent:ListMachines` authorizes each machine and shows only permitted state and capabilities, without reading registration credential hashes. `quyan:agent:CreateMachine` checks the current user's resource and verifies active account membership. The registration token is provided only in the successful creation response, not in lists.

`quyan:agent:DeleteMachine` checks the specific machine and validates its actual user, account and data version before revocation. Self-service management cannot control another user's or a foreign account's machines. Active machines can join resource groups in their own account. Machine registration permissions do not grant workspace creation, task execution or tool approval permissions.

Revoking a machine closes its existing connection on the current server. Connections on other servers recheck machine validity on their next heartbeat, task send or response, and reject communication after revocation. Disabling a user or account or changing account ownership also invalidates the old connection. Reconnecting replaces the previous connection; task responses are accepted only from the authenticated connection that received the task.

## Agent workspace list authorization

Workspaces use `acs:agent:*:<accountId>:workspace/<userId>/<workspaceId>`. `quyan:agent:ListWorkspaces` evaluates each workspace; the list shows only permitted workspaces and their runtime policies and capacity settings. The linked machine's name and state also require `quyan:agent:ListMachines` permission on that machine; these fields are omitted without that permission. Account isolation and self-service ownership checks remain in place. Workspaces can join resource groups in their own account.

Creating a workspace requires `quyan:agent:CreateWorkspace` on the current user resource. Selecting a remote machine also requires `quyan:agent:UseMachine` on that machine. Machine visibility does not grant permission to use it. The server checks machine ownership and its data version before creation, then rechecks authorization before provisioning the runtime. The creation response omits linked machine names and state; these are read through the separately authorized list.

Deleting a workspace requires `quyan:agent:DeleteWorkspace` on that workspace and, for a linked remote machine, `quyan:agent:UseMachine` on that machine. Deletion releases the runtime before removing the workspace. If cleanup fails, the workspace remains in a failed state and can be retried after runtime connectivity and permissions are restored. Concurrent deletion and stale provisioning writes cannot overwrite the deletion state.

## Agent task events and cancellation

Tasks use `acs:agent:*:<accountId>:task/<userId>/<taskId>`. `quyan:agent:GetTaskEvents` controls event payload reads. The server reads ordered, bounded pages and rechecks authorization throughout the stream and before sending each event; permission revocation stops delivery. `quyan:agent:CancelTask` cancels only queued, running or approval-waiting tasks and checks their current state and data version. Terminal tasks cannot be cancelled again, and stale workers cannot return a cancelled task to running. Tasks must still belong to the current user and account and reference an active workspace and conversation owned by that user.

## Agent approval resource authorization

Approvals use `acs:agent:*:<accountId>:approval/<userId>/<taskId>/<approvalId>`. Reading pending approvals requires `quyan:agent:ListTaskApprovals` on the task; each tool call also requires `quyan:agent:GetApproval` on its approval resource. Approving or rejecting requires `quyan:agent:DecideApproval` on both the task and approval. The server checks ownership of the task, workspace, conversation and step and accepts only pending, unexpired approvals. The decision and task state change in one transaction; an older approval cannot resume a cancelled task.

Creating a task requires `quyan:agent:CreateTask` on the selected workspace and conversation, plus `quyan:agent:UseRelayToken` on the token actually used. Token resources use `acs:relay:*:<accountId>:token/<userId>/<tokenId>`; explicitly selecting a token requires authorization for that token rather than inheriting permission for the conversation default. The server reads model settings only after authorization and checks account ownership and data versions of the workspace, conversation and token in the creation transaction. Disabled or expired tokens cannot create tasks. Existing model mappings, permitted models, budgets and step limits still apply.

## Passkey resource authorization

Passkey management does not use the entire account as its resource. Registration options and verification require `quyan:auth:GetPasskeyRegistrationOptions` and `quyan:auth:RegisterPasskey`, respectively, on the current user's `acs:quyan:*:<accountId>:user/<userId>` resource. These sensitive operations require an explicit grant; no default self-service grant applies.

Listing and deletion use `quyan:auth:ListPasskeys` and `quyan:auth:DeletePasskey` on `acs:quyan:*:<accountId>:passkey/<userId>/<passkeyId>`. The `passkeyId` is the `id` returned by the credential list, not the browser's WebAuthn `credentialId`. The deletion API still accepts `credentialId`; the server resolves and authorizes the real credential. Lists include only authorized credentials and never return public keys or signature counters. A registration grant alone does not disclose existing credential identifiers through registration options.

Authorization does not override ownership: users can manage only their own Passkeys, even with wildcard grants. A matching Deny overrides Allow. Invalid accounts, users, role sessions, or authorization data cause rejection. Anonymous Passkey login does not require a prior IAM grant. Registration challenges can succeed only once; start a new registration after challenge expiration, concurrent use, or a failed registration attempt.

## JSON Endpoint reads and owner selection

In IAM enforce mode, management lists and details use `quyan:json_endpoint:ListEndpoints` and `quyan:json_endpoint:GetEndpoint` on `acs:json-endpoint:*:<accountId>:endpoint/<userId>/<endpointId>`. The server isolates the current account before evaluating individual endpoints. Unauthorized endpoints are omitted from lists, and detail access is rejected. Custom policies may grant specific endpoints belonging to another user in the same account, but never endpoints in other accounts.

The owner selector uses the separate `quyan:json_endpoint:ListEndpointOwners` Action on `acs:quyan:*:<accountId>:user/<userId>`. Reading an endpoint does not grant permission to enumerate all account usernames. Management APIs do not return access passwords or password hashes. The old endpoint-read permission remains limited to the user's own endpoints; the old management permission covers endpoints in the current account, not every account on the platform.

Deletion requires the separate `quyan:json_endpoint:DeleteEndpoint` Action on the same resource type. Read grants do not authorize deletion. Policies and resource revisions are rechecked before deletion; concurrent changes, disabled accounts, invalid role sessions, or revoked grants block the operation. The old delete permission remains limited to the user's own endpoints; deleting another user's specific endpoint in the same account requires an explicit grant.

Public JSON password checks, Ed25519 signatures, time validity, and nonce replay protection are unchanged. Updates require `quyan:json_endpoint:UpdateEndpoint` on the specific endpoint ARN. Enabling or disabling a root slug additionally requires `quyan:json_endpoint:SetRootSlug` on that resource. Ordinary update permission cannot substitute for the root-slug grant. Existing password and signature access configuration is retained; authorization, account validity, and resource revisions are rechecked before commit. The old update permission remains limited to the user's own endpoints.

Creation uses `quyan:json_endpoint:CreateEndpoint`. Since the endpoint does not have an ID yet, its resource is the target owner's `acs:quyan:*:<accountId>:user/<userId>`. Endpoints default to the current user. Selecting another owner requires an explicit grant on that user resource, and the owner must belong to the same account. Root-slug creation additionally requires `quyan:json_endpoint:SetRootSlug` on that user resource. Authorization is checked before preparing access configuration and again before commit. Renamed, changed, disabled owners or revoked grants prevent creation. The old create permission remains limited to the current user. Read, delete, and update Actions do not substitute for creation permission.

## OJ API Key revocation authorization

Revoking an owned OJ API Key uses `quyan:oj:DeleteApiKey` on `acs:oj:*:<accountId>:api-key/<userId>/<keyId>`. Two-factor verification and replay protection remain required. Wildcard grants do not override key ownership and cannot revoke another user's key. The server checks actual key metadata, current policy, account and role-session validity, then validates the resource revision in the revocation transaction. Matching Deny, revoked grants, concurrent changes, or disabled accounts block the operation.

Revocation checks do not read or return key values, historical keys, or Relay upstream configuration. The old OJ delete permission retains owned-key revocation through its migration mapping. Other OJ key endpoints still use the existing permission bridge.

## OJ API Key reads and credential disclosure

`quyan:oj:ListApiKeys`, `quyan:oj:GetApiKey`, and `quyan:oj:GetApiKeyStats` authorize each owned key on `acs:oj:*:<accountId>:api-key/<userId>/<keyId>`. Lists and usage totals include only allowed keys. A grant for one key does not reveal another key's existence or usage. Wildcard grants do not override ownership or account isolation.

Reading metadata does not grant the credential value. The sensitive `quyan:oj:RevealApiKey` Action must also allow that same resource before its `key` field is returned. Without it, the key remains listed when metadata access is allowed, but its credential and copy button are absent. A matching Deny hides the credential even when metadata is allowed. Linked channels expose only their display name, never upstream configuration. Existing OJ read permissions retain their original owned-key behavior during migration.

`quyan:oj:CreateApiKey` authorizes issuance on the authenticated user’s `acs:quyan:*:<accountId>:user/<userId>` resource, has no default self-service grant, and cannot issue keys for another user. The creation response contains the newly generated key and selected channel name; issuance authority does not grant access to existing key values. Within the creation transaction, the server rechecks identity, role session, user and account revisions, policy and channel visibility. Failed checks roll back the new key. 2FA, replay protection and existing channel selection restrictions remain in effect.

`quyan:oj:UpdateApiKey` authorizes name, expiration and channel changes on a specific OJ API Key resource, while retaining the requirement that it is an active key owned by the authenticated user. Updating does not grant access to the existing key value: returning that value also requires `quyan:oj:RevealApiKey` on the same resource, and a matching Deny hides the field. User identity, role session, key revision and policy authorization are checked within the transaction. A selected channel must pass visibility and revision checks again. Channel selection reads only selection metadata and its display name, without returning upstream credentials or configuration. Existing restrictions on hidden channels, inaccessible private channels and automatic proxy pools continue to apply.

## Online monitor resource permissions

In IAM enforcement mode, online monitoring stays within the current account. `quyan:user:ListOnlineSessions` and `quyan:user:GetOnlineUserTimeline` authorize individual `acs:quyan:*:<accountId>:online-session/<userId>/<sessionId>` resources. The overview and timeline include only authorized sessions, with filtering and pagination applied to visible records. Totals and overview statistics do not include hidden sessions or users from other accounts. The overview reports distinct visible online users and the number of visible active sessions separately.

User details require `quyan:user:GetOnlineUser` on `acs:quyan:*:<accountId>:user/<userId>`. This separate grant reveals that user's aggregate session statistics and most recent connection information. A session-list grant alone does not grant user-detail access. Expired heartbeats display as offline without changing stored sessions as a side effect of reading. The legacy and shadow modes retain the previous monitoring behavior while enforcing the existing monitoring permission.

## Online session revocation

In IAM enforcement mode, `quyan:user:ForceOfflineSession` applies to the actual `online-session/<userId>/<sessionId>` resource, and `quyan:user:ForceOfflineUser` applies to the selected `user/<userId>` resource. Ending one session does not grant the ability to end all of a user's sessions. Both operations retain replay protection and require current account, identity, role-session, policy and resource revision checks. Ordinary delegated users cannot force the account owner offline through these APIs, preserving the recovery identity.

The server confirms the revocation marker before committing session closure. If that write is unavailable, the request fails and session changes roll back. For whole-user revocation, the user's credential revision also changes so pre-existing JWTs stay invalid after the temporary marker expires or a new login clears it. A concurrent change or revoked permission causes failure; refreshing the monitor and retrying starts a new authorization check. Shadow mode evaluates native permissions without performing an additional revocation.

## Reading another user's support conversation

`quyan:support:GetUserConversation` authorizes the selected `acs:quyan:*:<accountId>:user/<userId>` resource. In IAM enforcement mode, the target must be an active user within the current account, even when a policy uses wildcards. This sensitive permission has no automatic self-service grant and does not authorize changing support configuration or accessing usage analytics. The server checks current authorization before reading the conversation and again before returning it. A revoked grant, changed user revision, invalid role session or disabled account blocks the response. Existing own-conversation operations keep their separate permissions.

## Support usage analytics scope

`quyan:support:GetUserUsageAnalytics` authorizes support usage analytics on `acs:quyan:*:<accountId>:user/<userId>`. It is separate from reading support conversations and has no default self-service grant. Enforce mode includes only authorized users in the current account when calculating requests, tokens, estimated costs and daily trends. User tables are paginated after authorization, and unauthorized users do not count toward totals. A selected-user query requires authorization on that user resource, and cross-account targets are denied. An empty authorized set yields zero statistics. Authorization and user revisions are checked before returning; revoked grants or changed user status or revisions prevent previously computed statistics from being returned.

Query parameters cover page, page size, user and start/end time. Pages contain at most 100 users. The default window is the last 30 days, capped at 90 days. Invalid dates, date ordering and user identifiers produce parameter errors. Legacy and shadow modes retain existing permission checks, with shadow diagnostics evaluated against user resources.

## Personal OAuth application read authorization

Personal applications use `acs:oauth:*:<accountId>:client/<userId>/<clientId>`. `quyan:oauth:ListClients` filters the list per application, and `quyan:oauth:GetClient` controls one application’s details. Neither action has a default self grant. Matching Deny takes precedence, and unauthorized applications are omitted from the list. Wildcard grants still restrict these operations to the authenticated user’s own ordinary applications; they do not expose other users’ or system applications.

Applications can belong to an account resource group; removing a member removes that authorization scope. Display fields are read after authorization and do not include client secret hashes or tokens. `hasClientSecret` only indicates whether a secret is configured. Before returning data, the server rechecks policies, application versions, account status, role sessions and OAuth token status. OAuth calls also require the `oauth_client` scope. Menu visibility does not replace server authorization. System application and review endpoints retain their separate management permissions.

`quyan:oauth:UpdateClient` and `quyan:oauth:SubmitClientReview` separately control updates and review submission for a personal application, using the same application ARN. Update permission does not automatically allow review submission, and read permission does not grant writes. 2FA and replay protection remain required. Editing an approved or rejected application returns it to draft under the existing rules. Within the transaction, the server locks the application and trusted users and rechecks policies, application versions, accounts, role sessions and OAuth tokens. Failed checks roll back the update. Scope changes must remain grantable by the operator’s current role session; review submission does not approve the application.

Secret rotation and deletion use the separate sensitive actions `quyan:oauth:RotateClientSecret` and `quyan:oauth:DeleteClient` on the same personal application ARN. Update permission does not automatically grant rotation, and read or rotation permission does not grant deletion. Rotation applies only to confidential clients and returns only the newly generated secret; save it after a successful rotation. Read APIs do not provide full secrets. A failed final authorization or resource-version check rolls back rotation or deletion. These personal application operations cannot manage system applications.

Creating a personal OAuth application requires the sensitive action `quyan:oauth:CreateClient` on the authenticated user resource `acs:quyan:*:<accountId>:user/<userId>`. There is no default self grant. This operation creates only the caller’s ordinary applications, initially in draft; it cannot create system or preapproved applications. Confidential-client creation returns only the newly generated secret, while public clients receive no secret. The creation transaction rechecks user and account versions, policies, role sessions, OAuth tokens and scope grantability; a failed check rolls back the new application. Creation permission does not automatically grant application reads, edits, rotation, deletion or review submission.

The system OAuth application list uses `quyan:oauth:ListSystemClients` with per-application resources `acs:platform:*:platform:oauth-client/<clientId>`. `platform` is a reserved deployment namespace rather than the caller’s account. Ordinary account owners, account-created groups and wildcard policies cannot manufacture platform management access. The operator must belong to an active global management group whose existing permissions include system OAuth management. IAM then evaluates each application, conditions and explicit Deny. Removing that management permission or disabling the group denies reads. The list contains only authorized system applications, excludes secret hashes and tokens, and these platform resources cannot join ordinary account resource groups.

System application updates require the sensitive action `quyan:oauth:UpdateSystemClient` on the specific resource `acs:platform:*:platform:oauth-client/<clientId>`. List permission does not automatically grant updates, and the existing global management group ceiling remains required. Within the transaction, the server locks trusted users, the global group and the system application, then rechecks current policies and versions. Removed group permissions, identity changes and concurrent edits block the write. Scope changes are checked against the current role session and rechecked before commit. This endpoint cannot change system application type, creator, client ID or secrets. 2FA, replay protection and token lifetime limits remain in effect.

Creating a system OAuth application requires the sensitive action `quyan:oauth:CreateSystemClient` on the fixed parent `acs:platform:*:platform:oauth-control/clients`. Existing global management group permission remains required; ordinary account policies cannot create platform management eligibility. Creation checks scopes against the current role session and rechecks policies, users, the global group and scopes before commit; failed checks roll back the new application. System applications start approved and default to public clients without a secret. Confidential clients return only the newly generated secret after successful creation. Creation permission does not automatically grant list or update permission.

The OAuth review list uses `quyan:oauth:ListClientReviews` on `acs:platform:*:platform:oauth-review-client/<clientId>`. Operators must belong to an active global review group with the existing review-read permission. The list contains ordinary applications only. Review status and keyword filters run first, followed by per-application policy checks and pagination; the total counts only authorized applications. Display fields exclude secret hashes and tokens. The server rechecks grants, application versions and group eligibility before returning data and rejects changed authorization contexts. System applications use their separate management list.

Review decisions and review-side deletion require the separate actions `quyan:oauth:ReviewClient` and `quyan:oauth:DeleteReviewedClient` on the application resource `acs:platform:*:platform:oauth-review-client/<clientId>`. The global group must retain review-update permission; read access does not automatically grant review or deletion. Only pending ordinary applications can be approved or rejected. Review-side deletion can delete ordinary applications but cannot delete system applications. Before committing, the server rechecks the reviewer, account, global group, role session, policies and application version. Changes reject the operation, and failed final checks roll back the review decision or deletion.

With IAM enforcement enabled, configuration reads and updates require `quyan:support:GetConfig` and `quyan:support:UpdateConfig` respectively on `acs:platform:*:platform:config/support-ai`. Operators must also belong to an active global management group that retains AI Support configuration permission; account-created groups and wildcard policies cannot obtain platform management eligibility. Read permission does not grant updates, and explicit Deny takes precedence. All settings save together: revoked grants, concurrent configuration edits or invalid role sessions reject the entire update rather than leaving partially changed settings. Keys remain encrypted, and audit events record only the names of changed settings.
