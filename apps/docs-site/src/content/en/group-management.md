# Group management

Use group management to create user groups, set levels, and maintain group permissions. Members share the group's base permissions; individual additions, removals, and IAM policies may change actual access. To change membership, use [User management]({{DOCS_BASE_URL}}/en/user-management).

## Prerequisites

Open group management in the Operations site and check your permissions for the intended operation.

| Action                                     | Required permission       |
| ------------------------------------------ | ------------------------- |
| Read lists, details, and group permissions | `GROUP_READ`              |
| Create groups                              | `GROUP_CREATE`            |
| Edit names, levels, and descriptions       | `GROUP_UPDATE`            |
| Delete groups                              | `GROUP_DELETE`            |
| Add group permissions                      | `GROUP_PERMISSION_ADD`    |
| Remove group permissions                   | `GROUP_PERMISSION_REMOVE` |

Creation, editing, deletion, and permission saves require replay protection. Operators with 2FA enabled may also need a verification challenge; valid trusted windows follow the current security rules.

## Find groups

Entries show the group identifier, name, level, description, and configured permission count. This count is not a member count or the number of operations a member can ultimately perform on a specific resource.

- Enter part of a name or group identifier and press Enter. Clearing the input also searches again. Keywords do not search resource IDs or descriptions.
- **Show RAM Groups** keeps groups configured with RAM permissions. It does not list all IAM roles.
- The default page size is 10. Searching or changing the filter returns to page one. Refresh also clears the keyword and RAM filter.
- There is no automatic refresh or export. A failed list load clears the current entries. Retry according to the error rather than treating an empty list as proof that no groups exist.

With IAM enforcement, you may see previous/next controls without a total. Permission filtering can leave an empty page that still has a next page; continue paging to check.

## Understand level restrictions

Levels are integers from 0 to 100. **A smaller number means a higher tier.** The create form defaults to 50; this does not guarantee you can create that level.

Non-admin operators can normally see groups at numerically equal or greater levels, but may create, edit, delete, or change permissions only for groups with levels **strictly greater than their own**. They also cannot change a target to their own tier or higher. For example, an operator at level 20 can manage a level-50 group but cannot manage level 20 or 10.

The super-admin hierarchy exception does not replace operation grants, account scope, or protected-group restrictions. Visible entries and buttons do not guarantee server approval.

## Create and edit groups

1. Choose Create Group and enter an identifier and level. Name and description are optional.
2. Confirm and complete any verification prompt.
3. Check the result in the list. New groups have an empty permission set, which must be configured separately. Creating a group does not add users to it.
4. To update a group, choose Edit, change its name, level, or description, and confirm.

| Field       | Limits                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Identifier  | 2–30 characters after trimming; letters, digits, underscores, and hyphens only; must not match an existing active group identifier |
| Name        | Optional; up to 50 characters                                                                                                      |
| Level       | Integer from 0 to 100, subject to the operator's hierarchy restrictions                                                            |
| Description | Optional; up to 200 characters                                                                                                     |

The edit form does not offer identifier changes. Clearing an existing name or description and saving retains its old value. To clear one, an integration with update permission can explicitly submit an empty string through the update API and verify the result.

Failed submission retains your input. Closing clears it; there is no autosave. Editing uses the loaded list values. Reload after another administrator makes changes to avoid overwriting new values with old ones. Successful creation or editing reloads the current page without locating the target automatically. Filters or a changed level can hide the result.

## Configure group permissions

1. Find the group and choose Permissions. The editor opens only after its current permissions load successfully.
2. Browse categories or search, checking the selected set and count.
3. Select permissions to add and deselect permissions to remove. Add-only access cannot remove existing selections, and remove-only access cannot add them. Mixed changes require both permissions.
4. Save, then reopen the editor to verify the result. Save is disabled when nothing has changed.

Saving submits the **complete selected set**. Searching helps locate entries without clearing selections outside the search results. Check the impact first: group changes affect members' base permissions.

The server also checks whether the operator can delegate every retained or added permission. Visible or selectable entries are not necessarily grantable. Even removing one permission can fail if the remaining set exceeds the operator's delegation scope.

Read failures do not open the editor. Save failures retain the selection. If concurrent changes or authorization changes are reported, close and reopen the editor, check the latest set, and edit again rather than repeatedly submitting an old selection. The page provides no change history or undo action.

## Delete groups

1. Use user management to handle users still assigned to the group.
2. Return to group management, verify the identifier, choose Delete, and confirm.
3. Complete any verification prompt and check that the entry has disappeared.

A group with associated users cannot be deleted, including when those users are disabled. Groups protected by the current server configuration cannot be deleted. Deletion does not migrate members, and the page has no restore action.

A successful operation can still be followed by a list-loading failure. Query again to verify the result before repeating creation, deletion, or a permission save.

## IAM resource scope

With IAM enforcement, actions and resources are checked as follows.

| Operation                          | IAM action                      | Resource                               |
| ---------------------------------- | ------------------------------- | -------------------------------------- |
| List                               | `quyan:group:Read`              | Account target and each returned group |
| Details and group permission reads | `quyan:group:Read`              | Target group                           |
| Create                             | `quyan:group:Create`            | Authenticated account                  |
| Edit                               | `quyan:group:Update`            | Target group                           |
| Delete                             | `quyan:group:Delete`            | Target group                           |
| Add permissions                    | `quyan:group:permission:Add`    | Target group                           |
| Remove permissions                 | `quyan:group:permission:Remove` | Target group                           |

Account resources use `acs:quyan:*:<accountId>:account`; groups use `acs:quyan:*:<accountId>:group/<groupId>`. Creation derives ownership from the authenticated account; requests cannot select another account. Lists first restrict account and levels, then filter each group's authorization. API callers must page using `hasMore`; omitting pagination still returns a default page, without a total of unauthorized groups. Detail member counts include only users in the current account.

Permission saves also require delegation checks for the full permission scope. Matching Deny takes priority. Foreign groups and groups without migrated account ownership are refused. A legacy unowned recovery group is available only to its actual account-owner recovery identity, not sub-users or role sessions. Legacy/shadow retain their original visibility and pagination-total rules.

## Related pages

- [User management]({{DOCS_BASE_URL}}/en/user-management)
- [Permission management]({{DOCS_BASE_URL}}/en/permission-management)
- [RAM management]({{DOCS_BASE_URL}}/en/ram-management)
- [Verification]({{DOCS_BASE_URL}}/en/auth-verification)
