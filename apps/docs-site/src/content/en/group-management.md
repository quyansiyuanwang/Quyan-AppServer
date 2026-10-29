# Group management

Use this page to maintain user groups and the permission sets assigned to them. Operators with 2FA enabled may need a step-up challenge for write operations.

## Page purpose

- Create and edit groups.
- Adjust group name, level, and description.
- Configure group permissions.
- Delete groups that are no longer needed.

## What you will see

### Group list

- Group identifier, name, level, description, and permission count.
- Search by name or identifier, or use **Show RAM Groups** to filter for groups with RAM permissions. Refresh clears filters and returns to the first page.

### Management actions

- Create group.
- Edit group.
- Delete group.
- Open the permission editor.

## Common actions

1. Create a group with the required identifier and level; name and description are optional. The level ranges from 0 to 100 and defaults to 50, subject to the hierarchy rules below.
2. After creation, edit the name, level, or description as needed. The edit form does not offer an identifier change. Saving with a blank name or description preserves the existing value; it does not clear it.
3. Open the permission editor, select the permissions the group should have, and save. Adding and removing permissions require their respective permissions; mixed changes require both.
4. Before deletion, handle the users in the group: a group with users cannot be deleted. System-protected groups cannot be deleted either.

## Permission requirements

| Action                    | Required permission                                |
| ------------------------- | -------------------------------------------------- |
| View group list / details | `GROUP_READ`                                       |
| Create group              | `GROUP_CREATE`                                     |
| Edit group                | `GROUP_UPDATE`                                     |
| Delete group              | `GROUP_DELETE`                                     |
| Set group permissions     | `GROUP_PERMISSION_ADD` / `GROUP_PERMISSION_REMOVE` |

## IAM resource scope

In enforce, listing requires quyan:group:Read on the account target, and each returned group must also pass Read for its acs:quyan:\*:<accountId>:group/<groupId> ARN. Editing and deletion check Update and Delete on that group. Creation checks Create on the account target and derives group ownership from the authenticated account; clients cannot select another account.

The list limits candidates to the current account and existing level rules before applying per-group IAM decisions. A filtered page may be empty and still offer a next page. This mode uses bounded server pagination without exposing a total of unauthorized groups. Requests without pagination parameters also return a default page; API callers use hasMore to request another page. Detail member counts include only users from the current account. Legacy/shadow retain historical totals and migration behavior.

Adding permissions requires quyan:group:permission:Add on the group; removing requires Remove, and mixed changes require both. Saving also proves the operator can delegate the full retained or added permission scope. Menu visibility cannot replace this proof. Foreign groups and groups without migrated account ownership are refused. A legacy unowned recovery group is available only to its real account-owner recovery identity; sub-users and role sessions cannot borrow that exception.

## Level hierarchy rules

Groups carry a numeric level field. Operations are subject to the following constraints:

- Non-admin users can only manage groups whose level is **strictly higher** (numerically larger) than their own.
- You cannot create a group at the same or higher tier (equal or smaller number) as your own.
- You cannot edit or delete a group at the same or higher tier.
- You cannot raise a group's level to match or exceed your own.

## Notes

- Group permissions affect every user assigned to that group. Legacy uses group permissions + individual added permissions − individual removed permissions; enforce also evaluates JSON policies, resources and conditions, with explicit Deny taking precedence.
- When 2FA is enabled, creating, editing, deleting, and changing permissions may trigger a step-up challenge; a valid trusted window can satisfy the current security rules.
- If users also have individual overrides, confirm the final result in the permission-management page.

## Related pages

- [User management]({{DOCS_BASE_URL}}/en/user-management)
- [Permission management]({{DOCS_BASE_URL}}/en/permission-management)
