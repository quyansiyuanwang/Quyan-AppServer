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

Evaluation is **matching explicit Deny > matching Allow > implicit Deny**. Both Action and Resource must match. Policies from the user, active group, bound roles, and valid assumed-role session are evaluated together. Legacy permission removals become Deny statements. Account isolation, session validity, and business ownership checks remain in place. Actions come from server metadata, never client headers; unresolved resources are rejected.

### Conditions

`Condition` supports string, numeric, date, boolean, IPv4/IPv6, and existence operators. `GET /v1/iam/catalog/condition-keys` lists types, operators, and availability. Supported context includes source IP, current time, User-Agent, HTTPS status, and principal ID/type/account. Resource tags, resource groups, and MFA are unavailable and rejected when submitted. User-Agent is client-controlled and should not be the only security check.

Operators and keys combine with AND; multiple values for one key use OR. `StringLike` supports `*` and `?`; Action/Resource still support only `*`. `IpAddress` excludes network boundary addresses; `IpAddressIncludeBorder` includes them. Apart from explicit `Null` checks, missing context required by a matching statement fails closed, including conditional Deny statements. Simulation does not supply real IP/HTTPS attributes and returns `missing-condition-context` instead of inventing values.

### Service and resource catalog

With policy-read permission, use `GET /v1/iam/catalog/services`, `GET /v1/iam/catalog/services/{service}/actions`, and `GET /v1/iam/catalog/resources` for platform services, access levels, and ARN templates. API links are generated from server route metadata. The `legacy` stage identifies compatibility authorization; registering a resource template does not mean every endpoint enforces resource-level access. Existing Action names stay compatible; `ReadUser` is not automatically renamed to `GetUser`.

### JSON diagnosis and Schema

Send original JSON text to `POST /v1/ram/policies/diagnose` using `documentText` to receive errors, security warnings, warnings and suggestions. Diagnostics include a stable code, JSON Pointer and one-based line/column. Syntax errors, duplicate keys, prototype keys, unknown fields/actions, invalid condition values and explicit cross-account ARNs fail validation. Broad Allow grants, IAM management grants, duplicate statements and resource type mismatches produce risk notices. Diagnostics do not echo arbitrary policy values.

`GET /v1/iam/catalog/policy-schema` publishes JSON Schema generated from the same validator for editors and AI drafts. It includes current production actions, resource templates, implemented condition keys and limits. Custom catalog and account-ownership semantics still require server diagnosis. Schema access requires policy read permission; diagnosis requires policy create or update permission. Successful validation only confirms the current document syntax: `delegation: "not-evaluated"` explicitly means publication/delegation authority has not been proven. Saving and attaching still enforce the existing authorization checks.

### APIs and permissions

- `POST /v1/ram/policies`: submit name plus either document or legacy permissions, never both.
- `POST /v1/ram/policies/validate`: submit document for normalization, SHA-256 hash, and a broad-wildcard warning; requires policy-create or policy-update permission.
- `GET /v1/ram/iam/actions`: list actions; requires policy-read permission. The catalog contains only implemented platform APIs; the AliCloud DNS policy is a JSON compatibility example, not a provided DNS API.
- `GET /v1/ram/policies/{policyId}/versions`: page through immutable versions using `page` (default 1) and `pageSize` (default 20, maximum 100); returns `items`, `total`, `page`, `pageSize`, `defaultVersionId`, and `defaultDocumentHash`. Requires policy-read permission.
- `POST /v1/ram/policies/{policyId}/versions`: append a version and make it default. Submit document and the current expectedDocumentHash. The hash is optional only for the first legacy-to-IAM conversion. Requires policy-update permission, 2FA, and replay protection.
- `PUT /v1/ram/policies/{policyId}/default-version`: submit versionId and current expectedDocumentHash to restore a historical version; requires policy-update permission, mandatory fresh 2FA, and replay protection. Stale hashes return 409 instead of overwriting another update.
- `POST /v1/ram/policies/simulate`: submit a same-account principalId, action, and resource. Requires a separate Allow for `quyan:iam:SimulatePolicy` on the account resource; policy-read permission alone is insufficient. Returns only the decision, reason, and matched policy/version/statement identifiers, not policy documents or credentials.

Creating, updating, switching defaults, and attaching JSON policies currently require an account owner with the relevant operation permission and an enforce-mode deployment. RAM subusers cannot delegate JSON policies. System-managed policies cannot be modified through version APIs. IAM policies cannot be downgraded to legacy permission arrays.

### Deployment and migration boundaries

`IAM_AUTHORIZATION_MODE` defaults to `legacy`, preserving legacy enforcement. `shadow` also enforces legacy permissions while auditing IAM differences. `enforce` uses IAM for integrated legacy checks and never falls back on authorization-data failure. Explicit IAM middleware endpoints, including simulation, always enforce IAM. **Not every JWT endpoint has completed explicit Action/Resource migration; enabling enforce does not establish complete coverage.**

Legacy-to-IAM conversion preserves legacy fields for configuration rollback without removing version data. New JSON-only policies do not acquire legacy grants when rolled back. Decisions are uncached; subsequent requests reread bindings, disabled policies, and revoked sessions. Collection filtering, per-resource batch authorization, and ownership checks cannot be replaced by account-level authorization; complete these integrations and shadow comparisons before full rollout.

## Related pages

- `user-management`
- `group-management`
- `permission-management`
- `access-key-management`
