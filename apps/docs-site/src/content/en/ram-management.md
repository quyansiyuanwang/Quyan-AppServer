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

## Common workflows

1. **Create a RAM user**: RAM Users → Create User → fill in username, RAM username, and choose console/API access → Submit.
2. **Define a role**: Roles → Create Role → name the role and set max session duration → attach policies.
3. **Grant access**: Bind a role to a user, or attach a policy directly to a user.
4. **Audit permissions**: Permission Diagnostics → select a user → review their effective permissions from all sources.

## IAM JSON policies

The policy drawer offers **Permission tree** and **IAM JSON** formats. Choose IAM JSON to paste a policy, then select **Validate JSON** to check it on the server. Validation displays explicit Deny and broad-wildcard warnings; changes to the text invalidate the previous result. Saving validates any unvalidated text first. Existing IAM policies stay in JSON format, and the list shows their default version. Updates include the original document hash: a concurrent change returns 409; reload the policy and review the changes before trying again. With policy-read permission, the JSON editor can load the server Action catalog: place the cursor inside an Action string and select an Action to insert it. Resource examples explain the currently available global and account scopes. The **Simulate authorization** drawer accepts a same-account principal user ID, an Action from the catalog, and a Resource. It evaluates saved policies only, excludes unsaved editor text, and displays the decision, reason, and matched identifiers. Changing the inputs clears the result. Simulation requires its dedicated permission even when the drawer is visible. Select **Version history** on an IAM policy to page through immutable versions and preview their JSON. With update permission, select **Restore** on a non-default custom version and confirm; the operation requires account-owner authorization and two-factor verification. It immediately changes the permissions used by attached identities. A conflict or failed restore requires refreshing and reviewing the current default before retrying. Identity policies support only `Version: "1"`, `Statement`, optional `Sid`, `Effect`, `Action`, `Resource`, and optional `Condition`. Statement accepts an object or array; Action and Resource accept a string or array. Only `*` is a wildcard, and matching is case-sensitive. Unknown fields/versions, Principal, NotAction, NotResource, and policy variables are rejected rather than ignored.

RAM management operations currently use the account Resource `acs:quyan:*:<account-owner-id>:account`. Their Actions are declared by the server, and target ownership remains checked separately. These management operations follow the configured legacy/shadow/enforce rollout mode; the dedicated simulation Action is always enforced.

Evaluation is **matching explicit Deny > matching Allow > implicit Deny**. Both Action and Resource must match. An ordinary user identity combines user, active-group and assigned-role policies. An assumed-role session uses only the assumed role’s policies and scoped authorizations; it never adds the caller’s user/group permissions or other assigned roles. Legacy permission removals become Deny statements for ordinary user identities. Account isolation, session validity, and business ownership checks remain in place. Actions come from server metadata, never client headers; unresolved resources are rejected.

### Conditions

`Condition` supports string, numeric, date, boolean, IPv4/IPv6, and existence operators. `GET /v1/iam/catalog/condition-keys` lists types, operators, and availability. Supported context includes source IP, current time, User-Agent, HTTPS status, and principal ID/type/account. Resource tags, resource groups, and MFA are unavailable and rejected when submitted. User-Agent is client-controlled and should not be the only security check.

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

## Create scoped authorizations in management

Open the RAM “Authorization” page to browse paged resource groups, members and authorization relations. “Use in authorization” copies a group ID into the scope form; copy principal and policy IDs from their management lists. Choose account, resource-group or resource scope: supply a group ID for group scope, a same-account ARN for resource scope, and no additional resource field for account scope.

Creating refreshes the relation list. Revocation requires confirmation and still undergoes dedicated IAM action, 2FA, account ownership and delegation checks. Group members use separate server pagination. Enter an exact ARN to add a member and confirm the access impact before removal. Failed loads can be retried, and empty filtered pages can still advance. The page retains existing RAM menu visibility permissions; each list and mutation independently enforces its new IAM action. Menu visibility does not grant access.

In enforce mode, the final effective-permission list shares IAM evaluation with the user-permission API. Only legacy actions allowed on the account target project to global Permission; specific-resource Allow is never broadened. Explicit Deny removes the corresponding projected permission. Inspecting yourself uses the current authenticated identity and role session; inspecting another principal does not borrow the operator’s session. AccessKey principal-type conditions also affect the current identity’s projection. Source arrays remain historical explanations and may omit JSON-only grants; use simulation to check a particular ARN. Legacy/shadow historical display remains compatible.

The role list provides a “Role trust policy” editor for separate trust JSON, trust Schema downloads, original-text diagnostics and trust-kind AI drafts. Applying AI output only edits the draft. Publication first diagnoses trust, then confirms its impact on new-session admission and sends the role’s existing trustPolicyHash to detect concurrent changes. Syntax checks do not prove publication permission: the server still checks real same-account principals, dedicated UpdateRoleTrustPolicy, AssumeRole delegation and effective role grants. Failures retain the draft for review; reload a role after a version conflict. Existing sessions require separate revocation.

When granting legacy Permission to a user or group under enforce, the server expands it to all registered resource scopes inside the account and proves the operator can delegate that complete scope. An account-target menu Allow does not prove authority over every concrete resource. Removing a permissionRemoves Deny or clearing the configuration may restore denied capabilities, so the restored permissions also require delegation proof. Account and recovery-identity checks remain server-side; legacy/shadow retain migration compatibility.

In enforce, permission-management endpoints authorize user/<userId> or group/<groupId> rather than relying on account-level menu permissions. Clearing user overrides requires both Add and Remove on that user; replacing group permissions independently checks additions and removals. Group permission reads and writes verify account ownership, so resource wildcards cannot cross accounts. Legacy unowned recovery groups remain accessible only to their real account-owner recovery identity. Target-operation authorization and proof of the delegated permissions are separate checks.
