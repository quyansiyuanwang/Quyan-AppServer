# Permission management

Access control is split into overview, identity management, and permission management. Use these permission pages to inspect effective user permissions and adjust user-level overrides.

## Page purpose

- See where a user's permissions come from.
- Separate group permissions from added or removed user overrides.
- Apply fine-grained permission changes to a specific user.

## What you will see

### User list

- Username and group.
- Refresh action.
- Paginated list.

### Authorizations

- Handles only user-level grants and removals.
- Editing requires `PERMISSION_ADD` or `PERMISSION_REMOVE`.

### Permission policies

- Effective permissions.
- Group-provided permissions.
- Individually added permissions.
- Individually removed permissions.

### Permission diagnostics

- Uses the same live data as permission policies, displayed continuously by source.
- Helps establish whether final access comes from a group, a user-level grant, or a user-level removal.

### Edit actions

- Open the user-permission editor.
- Browse permissions by category.
- Search permission items by keyword.

## Common actions

1. Find the target user.
2. Open Permission Policies or Permission Diagnostics to see the source of each permission.
3. Add user-level permissions for special access.
4. Remove user-level permissions to restrict a specific capability.

## Permission requirements

| Action                              | Required permission                                      |
| ----------------------------------- | -------------------------------------------------------- |
| View a group's permissions          | `PERMISSION_VIEW`                                        |
| Add permissions to a user or group  | `PERMISSION_ADD`                                         |
| Remove permissions from a user      | `PERMISSION_REMOVE`                                      |
| Clear a user's permission overrides | `PERMISSION_REMOVE` and `PERMISSION_ADD` (both required) |

Changing a group's permission set additionally requires a fresh 2FA step-up challenge, regardless of trusted-device status.

## Notes

- Final permissions are typically the combination of group rules plus user-level overrides.
- This page is essential when troubleshooting “can see but cannot use” or “should not see this” issues.
- Prefer long-term group fixes over too many permanent user-specific exceptions.

## Related pages

- `user-management`
- `group-management`
- `ram-management` (roles)
- `legal-policy-management`
