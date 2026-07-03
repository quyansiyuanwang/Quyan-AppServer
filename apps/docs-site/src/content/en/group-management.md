# Group management

Use this page to maintain user groups and the permission sets assigned to them. All write operations require a step-up 2FA challenge.

## Page purpose

- Create and edit groups.
- Adjust group name, level, and description.
- Configure group permissions.
- Delete groups that are no longer needed.

## What you will see

### Group list

- Group name.
- Level and description.
- Permission count.

### Management actions

- Create group.
- Edit group.
- Delete group.
- Open the permission editor.

## Common actions

1. Define the purpose of a group before creating it.
2. Keep the name and description clear for later maintenance.
3. Use the permission editor to bulk-select the permissions the group should have.
4. Before deleting a group, confirm no active users still depend on it.

## Permission requirements

| Action                    | Required permission    |
| ------------------------- | ---------------------- |
| View group list / details | `GROUP_READ`           |
| Create group              | `GROUP_CREATE`         |
| Edit group                | `GROUP_UPDATE`         |
| Delete group              | `GROUP_DELETE`         |
| Set group permissions     | `GROUP_PERMISSION_ADD` |

## Level hierarchy rules

Groups carry a numeric level field. Operations are subject to the following constraints:

- Non-admin users can only manage groups whose level is **strictly higher** (numerically larger) than their own.
- You cannot create a group at the same or higher tier (equal or smaller number) as your own.
- You cannot edit or delete a group at the same or higher tier.
- You cannot raise a group's level to match or exceed your own.

## Notes

- Group permissions affect every user assigned to that group. Effective permissions = group permissions + individual added permissions − individual removed permissions.
- All write operations (create, edit, delete, set permissions) require a **step-up 2FA challenge**.
- If users also have individual overrides, confirm the final result in the permission-management page.

## Related pages

- `user-management`
- `permission-management`
