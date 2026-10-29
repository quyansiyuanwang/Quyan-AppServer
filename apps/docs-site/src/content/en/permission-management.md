# Permission management

Use permission management to inspect permission sources and maintain user-level additions and removals. Maintain shared, lasting permissions in [Group management]({{DOCS_BASE_URL}}/en/group-management). Manage roles, JSON policies, and authorization bindings in [RAM management]({{DOCS_BASE_URL}}/en/ram-management).

## Choose a page and prepare access

Three pages under access control share a user list but serve different purposes.

| Page                   | Purpose                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Authorizations         | Edit user-level permission overrides                                                                       |
| Permission Policies    | Inspect counts and permission sources; does not edit policy documents                                      |
| Permission Diagnostics | Inspect the same source summary; does not fully diagnose a specified action, resource, and request context |

Entering these pages requires `PERMISSION_VIEW`. Loading the user directory also requires `USER_READ`; group filter options depend on `GROUP_READ`. Seeing a user does not grant permission to read or change their access.

| Operation                        | Permission requirement                                              |
| -------------------------------- | ------------------------------------------------------------------- |
| Inspect another user's summary   | `PERMISSION_VIEW`, within the target resource's authorization scope |
| Add or restore capabilities      | `PERMISSION_ADD`                                                    |
| Remove capabilities              | `PERMISSION_REMOVE`                                                 |
| Both add and remove capabilities | Both permissions in IAM enforce mode                                |
| Clear user overrides             | Both `PERMISSION_ADD` and `PERMISSION_REMOVE`                       |

In legacy/shadow modes, the page's full-save endpoint also requires `PERMISSION_ADD`. Remove-only access cannot save through this endpoint even if the editor opens. Button visibility alone does not establish sufficient access.

Saving and clearing overrides require replay protection. Operators with 2FA enabled may need additional verification; valid trusted windows follow the current security rules.

## Find a user

1. Enter a keyword and press Enter, select a group, or toggle **Show RAM Users**. Keywords match parts of usernames, RAM usernames, display names, email addresses, or user IDs.
2. Check the target username and group. The current operator is excluded, and RAM subusers are excluded by default.
3. Continue through the pages. The default page size is 10; searches and page-size changes return to page one.

**Show RAM Users** filters for RAM permissions in user additions or group permissions and also removes the default exclusion of RAM subusers. It does not filter by role identity or final effective access. A RAM permission that is individually removed can still cause a user to match.

Refresh clears the keyword, group, and RAM filters and returns to page one. It does not reload group options. If an option is missing, clear the group filter and search by keyword. With IAM enforcement, the dropdown loads only the group API's default page, not necessarily all groups.

The list has no automatic refresh or export. Failed loading can retain old entries and totals. Query again before choosing a target.

## Inspect permission sources

In Permission Policies or Permission Diagnostics, find a user and choose Inspect. The dialog shows four counts and permission lists.

| Source                 | Meaning                                          |
| ---------------------- | ------------------------------------------------ |
| Effective permissions  | Summary calculated by the current endpoint       |
| Group permissions      | Base permissions configured for the user's group |
| Additional permissions | Permissions added specifically for this user     |
| Removed permissions    | Removal overrides configured for this user       |

For ordinary group and user overrides, the calculation is group permissions + additions − removals. Role and policy bindings can contribute other sources, so the source lists do not always explain every effective entry.

With IAM enforcement, effective permissions are a policy projection for the **account resource**. Specific resources, conditions, explicit Deny, and role sessions can change actual decisions. An entry does not guarantee all corresponding requests will succeed, and its absence does not establish denial for every specific resource. Inspecting sources is not an authorization test for a real business request.

A failed detail load may retain the previous user's content even after the title changes. Close and reopen, ensuring loading succeeds for the correct target before making access decisions.

## Edit user overrides

1. Find the user in Authorizations and choose Edit. The editor opens only after permissions load successfully.
2. Check the username, group base count, and addition/removal counts.
3. Browse categories or search. Select permissions to retain and deselect permissions to restrict.
4. Save and complete verification if prompted. Reopen to check the overrides and confirm the outcome with an actual business request as the target user.

The initial selection is calculated from group permissions, user additions, and removals. It **does not fully include effective access from roles and JSON policies**, so its count can differ from the inspection summary. Saving recalculates and replaces both override lists: selected permissions outside the group become additions; unselected group permissions become removals. It does not change the group or directly rewrite RAM policies, and it does not guarantee removal of all access granted through other policies.

Searching filters display without clearing other selections. Toolbar Select All and Clear Selection affect selectable entries throughout the tree, not just current search results. Saving after clearing selections can remove many group permissions. This differs from Clear Custom Permissions below.

The server checks Add and Remove according to the change direction and validates delegation for added and retained additions. With IAM enforcement, restoring a previously removed permission also counts as increasing access and requires the relevant authorization and delegation scope. Selectable entries are not necessarily saveable.

Failed saves retain the selection. Cancel discards unsaved changes; there is no autosave or historical undo. If concurrent changes are reported, close and reload before editing again. Reloading the summary can fail after a successful save; verify again before resubmitting.

## Clear custom permissions

To remove every user-specific exception, choose Clear Custom Permissions in the editor and confirm the target. This immediately submits the clear operation without another Save. Unsaved checkbox changes are not submitted as its result.

Clearing removes both additions and removals. It revokes individually added capabilities and may **restore capabilities previously restricted by removal overrides**. It does not delete group permissions, roles, or JSON policy bindings. With IAM enforcement, restored access must also pass delegation checks.

If reloading fails after clearing, the page may report failure even though the overrides were cleared. Close and inspect sources again to establish the actual state before continuing.

## Hierarchy and IAM boundaries

These mutation endpoints do not allow changing your own permissions. The target user's group level must be numerically greater than the operator's; smaller numbers indicate higher tiers. An operator at level 20 cannot change a user at level 20 or 10. This user-permission check has no super-admin hierarchy exemption equivalent to group management.

With IAM enforcement, the user directory and permission operations use different resources.

| Purpose               | IAM action                | Resource                                                                                               |
| --------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------ |
| User directory        | `quyan:user:ListUsers`    | `acs:platform:*:platform:user/<user-id>`, plus `USER_READ` eligibility in a real deployment-wide group |
| Inspect summary       | `quyan:permission:Manage` | `acs:quyan:*:<accountId>:user/<user-id>`                                                               |
| Add or restore access | `quyan:permission:Add`    | Same target user resource                                                                              |
| Remove access         | `quyan:permission:Remove` | Same target user resource                                                                              |

The directory applies its read and hierarchy rules and counts authorized entries only. It can include disabled users, but permission summaries for disabled, foreign-account, or otherwise unauthorized targets may still fail to open. Mutations cannot cross accounts, and subusers cannot change their account owner's recovery permission scope. Role sessions follow their grants and conditions; explicit Deny takes priority.

## Related pages

- [User management]({{DOCS_BASE_URL}}/en/user-management)
- [Group management]({{DOCS_BASE_URL}}/en/group-management)
- [RAM management]({{DOCS_BASE_URL}}/en/ram-management)
- [Verification]({{DOCS_BASE_URL}}/en/auth-verification)
