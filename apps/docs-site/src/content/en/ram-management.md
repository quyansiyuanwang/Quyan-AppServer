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

## Tabs overview

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

| Action | Required permission |
|--------|-------------------|
| View RAM users | `RAM_USER_READ` |
| Create RAM user | `RAM_USER_CREATE` |
| Update RAM user | `RAM_USER_UPDATE` |
| Delete RAM user | `RAM_USER_DELETE` |
| View RAM roles | `RAM_ROLE_READ` |
| Create RAM role | `RAM_ROLE_CREATE` |
| Update RAM role | `RAM_ROLE_UPDATE` |
| Delete RAM role | `RAM_ROLE_DELETE` |
| View role bindings | `RAM_BINDING_READ` |
| Create role binding | `RAM_BINDING_CREATE` |
| Delete role binding | `RAM_BINDING_DELETE` |
| View policies | `RAM_POLICY_READ` |
| Create policy | `RAM_POLICY_CREATE` |
| Update policy | `RAM_POLICY_UPDATE` |
| Delete policy | `RAM_POLICY_DELETE` |
| Attach policy | `RAM_POLICY_ATTACH` |
| Detach policy | `RAM_POLICY_DETACH` |
| Assume role | `RAM_ASSUME_ROLE` |
| View sessions | `RAM_SESSION_READ` |
| Revoke session | `RAM_SESSION_REVOKE` |

## Security notes

- **2FA required**: All create, update, delete, attach, detach, and bind operations require a 2FA challenge.
- **Always-require endpoints**: Deleting users, roles, policies, and detaching policies require fresh 2FA (the trusted-device window is ignored).
- **Notifications**: All RAM mutating operations dispatch security notification events. Ensure your notification preferences include RAM events.

## Common workflows

1. **Create a RAM user**: Users tab → Create User → fill in username, RAM username, and choose console/API access → Submit.
2. **Define a role**: Roles tab → Create Role → name the role and set max session duration → attach policies.
3. **Grant access**: Bind a role to a user, or attach a policy directly to a user.
4. **Audit permissions**: Authorization tab → select a user → review their effective permissions from all sources.

## Related pages

- `user-management`
- `group-management`
- `permission-management`
- `access-key-management`
