# Permission management

Access control is split into overview, identity management, and permission management. Use these permission pages to inspect user permission summaries and adjust user-level overrides. Actual request authorization also depends on the authorization mode and request context.

## Page purpose

- See where a user's permissions come from.
- Separate group permissions from added or removed user overrides.
- Apply fine-grained permission changes to a specific user.

## What you will see

### User list

- Username and group.
- A paginated list filtered by keyword, group, and the **Show RAM Users** toggle. Here the toggle filters for RAM permissions in user additions or group permissions; the user-management page instead filters by RAM subuser type.
- The current operator is excluded; refresh clears the filters and returns to the first page.

### Authorizations

- Handles only user-level grants and removals.
- Editing requires `PERMISSION_ADD` or `PERMISSION_REMOVE`.

### Permission policies

- Effective permissions.
- Group-provided permissions.
- Individually added permissions.
- Individually removed permissions.

### Permission diagnostics

- Shows the same permission summary as Permission Policies, including group permissions and user-level additions and removals.
- Helps inspect these sources, but is not a complete authorization diagnosis for a specific resource and request conditions.

### Edit actions

- Open the user-permission editor.
- Browse permissions by category.
- Search permission items by keyword.

## Common actions

1. Find the target user.
2. Open Permission Policies or Permission Diagnostics to see the source of each permission.
3. Add user-level permissions for special access.
4. Remove user-level permissions to restrict a capability, then save. Clearing custom permissions removes both user-level additions and removals and restores the group-based selection; this can restore capabilities that were previously removed.

## Permission requirements

| Action                              | Required permission                                      |
| ----------------------------------- | -------------------------------------------------------- |
| View a group's permissions          | `PERMISSION_VIEW`                                        |
| Add permissions to a user or group  | `PERMISSION_ADD`                                         |
| Remove permissions from a user      | `PERMISSION_REMOVE`                                      |
| Clear a user's permission overrides | `PERMISSION_REMOVE` and `PERMISSION_ADD` (both required) |

An operator with 2FA enabled may need a step-up challenge when changing group permissions; a valid trusted window can satisfy the current security rules.

## Notes

- Outside IAM enforcement mode, the permission summary can include group, user-level override, and role-binding effects. In enforcement mode, the effective list is a policy projection for the account resource. Specific resources, conditions, explicit Deny, and role sessions can yield different results, so the list alone does not guarantee a request will be allowed.
- This page is essential when troubleshooting “can see but cannot use” or “should not see this” issues.
- Prefer long-term group fixes over too many permanent user-specific exceptions.

## Related pages

- [User management]({{DOCS_BASE_URL}}/en/user-management)
- [Group management]({{DOCS_BASE_URL}}/en/group-management)
- [RAM management]({{DOCS_BASE_URL}}/en/ram-management) (roles)
- [Legal policy management]({{DOCS_BASE_URL}}/en/legal-policy-management)
