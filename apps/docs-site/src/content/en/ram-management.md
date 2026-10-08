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

Create groups with name and optional description; add members with resourceArn. Members must be real active resources owned by the account, never wildcards or invented ownership. Removing a member immediately stops group-scoped grants; disabled resources or resources that leave the account also stop receiving these grants. Admission rechecks delegation, preventing beneficiaries from expanding their own scope. APIs are available; the management UI resource-group selector is not yet available.

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

Publish with `PUT /v1/ram/roles/{roleId}/trust-policy` using document and optional expectedDocumentHash. This API requires `quyan:ram:UpdateRoleTrustPolicy` on that role, replay protection and 2FA. General role-update permission does not automatically grant trust publication. The existing role create/update APIs still accept trustPolicy but require the same dedicated action whenever it is supplied (account scope on creation, role scope on update). Role responses include trustPolicyHash for valid trust documents; stale hashes or role versions return 409. Publication proves AssumeRole access and the role’s complete effective grants, preserving every authorization scope. Trust JSON is exposed through APIs and Schema; a dedicated trust editor is not yet provided.

In enforce mode, assume-role authorizes the concrete role ARN from the validated roleId. Simulation of quyan:ram:AssumeRole on that ARN also combines identity and saved trust. Simulations do not invent IP/HTTPS context. Roles without valid trust are rejected under enforce; legacy/shadow retain the old bound-role/owner admission path.

Issued sessions use only the selected role’s current permissions and remain subject to account, status, expiry and revocation checks. Trust changes govern new sessions; existing sessions end by expiry or explicit revocation, not by rechecking the original trust conditions on every request. A group’s user-policy Deny does not become a session permission boundary: to prevent switching identities, deny AssumeRole; to stop issued sessions, revoke them. Matching Deny inside the role’s policies still overrides its Allow.

User updates/deletion, role deletion, session revocation and policy mutations/version management resolve concrete target ARNs within the authenticated account. Role-to-user/group and policy-to-principal bindings require grants on both entities. Changing the default policy version requires both the policy and selected version. Assigning a user group also proves that its direct, role-derived and scoped grants can be delegated by the operator.

Legacy Permission grants retain their account-wide meaning through registered resource patterns inside that account. A hand-written JSON `account` ARN denotes the account target; it never implicitly covers every user or policy. Previously saved JSON versions are not rewritten, so review migration differences through simulation and shadow evaluation.
