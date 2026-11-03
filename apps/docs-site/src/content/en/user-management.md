# User management

Use user management to maintain platform users' profiles, groups, and status, and to create accounts, reset passwords, delete users, or enter an account. Ordinary users created here are independent account owners. To create RAM subusers for your account, use [RAM management]({{DOCS_BASE_URL}}/en/ram-management).

## Prerequisites

Open User Management under access control. Directory access and individual operations are authorized separately. Visible buttons do not establish access to a target resource.

| Operation                        | Required permission                               |
| -------------------------------- | ------------------------------------------------- |
| Read the directory and details   | `USER_READ`                                       |
| Create users                     | `USER_CREATE`                                     |
| Edit profiles, status, or groups | `USER_UPDATE`                                     |
| Delete users                     | `USER_DELETE`                                     |
| Reset another user's password    | `USER_CHANGE_OTHERS_PASSWORD`                     |
| Enter an account                 | `USER_IMPERSONATE_VIEW` or `USER_IMPERSONATE_ACT` |
| Load group options               | `GROUP_READ`                                      |

Mutation endpoints require replay protection. Operators with 2FA enabled may need additional verification when resetting passwords; valid trusted windows follow current security rules. IAM enforcement also requires the separate actions and management eligibility described below.

## Find and verify users

Desktop uses a table and mobile uses cards. Entries include username, display name, email, status, group, and creation time. Creation times use the browser's local time.

1. Enter a keyword and press Enter to match parts of usernames, RAM usernames, names, emails, or user IDs. There is no separate user-ID input.
2. Select a group if needed. Searching, clearing the keyword, changing filters, or changing page size returns to page one.
3. Continue through the pages. The default size is 10 users, the API allows at most 100 per page, and page numbers cannot exceed 10,000.

On this page, **Show RAM Users** filters by **RAM subuser type**. With the switch off, RAM subusers are excluded by default. The similarly named switch in Permission Management instead filters by RAM permissions. The current operator is excluded. Disabled users can appear; deleted users do not.

Refresh clears all filters and returns to page one without reloading group options. With IAM enforcement, group dropdowns load only the group API's default page and may omit available options. An option being visible does not prove you can assign users to it. An unresolved group name may appear as a raw group ID.

There is no automatic refresh, bulk operation, or export. Failed loading may retain old entries and totals. Query again before acting.

## Create an ordinary user

1. Choose Create User and enter a username and initial password.
2. Optionally enter a name and email and select a group. Leaving the group unselected uses the system's ordinary registration group.
3. Confirm, then query again to verify the account. New users are Active. The page does not return or send a one-time password credential.

| Field                           | Limits                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Username                        | 3–20 characters after trimming; letters, digits, and underscores only; must not conflict with an existing username |
| Initial or replacement password | 6–50 characters                                                                                                    |
| Name                            | Optional; up to 50 characters                                                                                      |
| Email                           | Optional; valid email format, up to 200 characters                                                                 |
| Group                           | Optional; subject to assignment scope, hierarchy, and delegation checks                                            |

Arrange delivery of the initial password through an appropriate channel. The create dialog does not provide permission overrides, a chosen user ID, or account ownership selection. Success reloads the current page without locating the new user; existing filters may hide the result.

## Edit profiles, status, and groups

1. Find the user and choose Edit.
2. Change the name, email, group, or status. Active and Disabled are the available states. This dialog does not change usernames or passwords.
3. Confirm and query again to verify the result. Name or group changes may exclude the user from the previous filter.

The form uses loaded list values without fetching details when opened. Refresh after other administrators make changes to avoid overwriting new values with old ones. Saving with a blank name, email, or group retains the old value; it does not clear the field or remove membership.

With IAM enforcement, **the form always submits status, plus nonempty email and group values**. Even changing only a name may therefore require the separate `SetUserStatus`, `SetUserEmail`, and `AssignUserGroup` actions. `UpdateUser` alone does not guarantee the form can save. Integrations updating only a name should submit only that field.

Disabling limits account use without clearing balances, resources, or other business data. IAM enforcement also checks account-owner status. If the owner is disabled or deleted, active subusers can no longer pass IAM authorization, including through JWTs, authenticated AccessKeys, and role sessions. Re-enabling requires status-change permission.

Failed submission retains input; closing clears it. There is no autosave. The list can fail to reload after a successful write. Query again to verify before resubmitting.

## Reset passwords

1. Choose Reset Password on the target entry and check the username in the dialog.
2. Enter a new password within the length limits, choose Reset Password, and complete verification if prompted.
3. When the dialog closes successfully, tell the user to sign in with the new password.

This directly sets a new password without the user's old password or an email reset code. It does not reveal the old password. Resetting does not remove configured 2FA, Passkeys, or trusted devices; see [Two-factor authentication]({{DOCS_BASE_URL}}/en/two-factor-authentication). Failures retain input, which is cleared when the dialog closes.

## Enter an account and exit impersonation

1. Verify the target, choose Enter Account, and confirm.
2. Check the username and mode in the top banner before acting as the user.
3. When finished, choose Exit Impersonation and verify that your original identity is restored.

| Mode      | Behavior                                                                                 |
| --------- | ---------------------------------------------------------------------------------------- |
| View only | Blocks mutation requests; some features that read through POST can also be restricted    |
| Act       | Operates as the target, subject to that user's own permissions and business restrictions |

The system prefers an authorized Act mode. The confirmation dialog does not let you manually select View Only. It falls back only when Act is not authorized and View Only has its own authorization. Either impersonation permission can show the button, without guaranteeing entry to the target account.

You cannot impersonate yourself or start another impersonation from an impersonated session. The target must be usable and at a lower tier than the operator. Sessions last one hour without a refresh token, and operations have audit records.

If loading the target's profile fails during entry, the identity may already have changed. Check the banner and current account before exiting or retrying. Exit attempts to restore the original session. If restoration fails, refresh as prompted, verify your identity, and sign in again if necessary.

## Delete users

1. Check the target's balance, permissions, and related resources.
2. Choose Delete and confirm.
3. Query again and verify that the user no longer appears.

Deletion marks the account deleted and releases its old username. It does not erase all related business data, and the page has no restore action. You cannot delete yourself or users at the same or higher tier. IAM enforcement also prevents deleting the authenticated account's owner. Disabled users can be deleted under the same rules. Deletion is recorded in business logs.

## Hierarchy and IAM scope

Smaller group-level numbers indicate higher tiers. Cross-user profile editing, deletion, and impersonation require a numerically greater target group level. Seeing a peer in the list does not permit changes. Password reset has independent authorization checks; do not infer approval solely from these profile-management rules.

With IAM enforcement, platform management operations require corresponding eligibility in a real, active deployment-wide group. Individual additions, private account groups, and account-owner status cannot replace it. Management APIs do not accept OAuth access tokens. Role sessions use role grants without inheriting policy Allow from the operator's global group; explicit Deny takes priority. Authenticated AccessKeys must also pass resource checks.

| Operation               | IAM action                          | Resource scope                    |
| ----------------------- | ----------------------------------- | --------------------------------- |
| User list               | `quyan:user:ListUsers`              | Each authorized user              |
| User details            | `quyan:user:GetUser`                | Target user                       |
| Create user             | `quyan:user:CreateUser`             | User directory and generated user |
| Update profile          | `quyan:user:UpdateUser`             | Target user                       |
| Submit email            | Also `quyan:user:SetUserEmail`      | Target user                       |
| Submit status           | Also `quyan:user:SetUserStatus`     | Target user                       |
| Submit group            | Also `quyan:user:AssignUserGroup`   | Target user and destination group |
| Delete                  | `quyan:user:DeleteUser`             | Target user                       |
| View-only impersonation | `quyan:user:StartViewImpersonation` | Target user                       |
| Act impersonation       | `quyan:user:StartActImpersonation`  | Target user                       |

User resources use `acs:platform:*:platform:user/<user-id>`, groups use `acs:platform:*:platform:group/<group-id>`, and the directory uses `acs:platform:*:platform:user-directory`. New user IDs are generated by the system; policies can preauthorize `user/*` as appropriate. Password reset separately uses `quyan:user:ChangeOthersPassword` on the account-scoped user resource `acs:quyan:*:<accountId>:user/<user-id>`. Platform user-management actions do not replace it.

Lists apply level and RAM-type filters, then calculate authorized totals and pages without disclosing unauthorized-user totals. List access does not grant details. Missing or denied details return a generic authorization error. Reads do not return passwords or permission arrays. Refresh and retry if grants, role sessions, or related user data change during a read.

### Creation and group assignment restrictions

With IAM enforcement, a new account owner can join only an active global group, not another account's private group. Explicit group selection also requires assignment authorization on the new user and destination group. An omitted group receives the default baseline exception only while the ordinary registration group retains its exact predefined base permissions. Additional group permissions, policies, and roles still require delegation checks. Explicitly selecting that same group requires full checks.

Ordinary operators cannot create peers or higher-tier users, raise an existing target's tier through group changes, delegate ungranted access, or broaden access by removing the original group's Deny. An existing user's destination must be an active global group or belong to that user's actual account.

The configured real global administrator account owner can perform controlled recovery creation or reassignment, while still requiring action authorization and respecting explicit Deny. Role sessions cannot use this recovery exception. Replacing another account owner's group must also preserve existing IAM recovery authority and cannot introduce Deny through group policies or roles.

This update API cannot reassign the operator or the current account owner, change their recovery email, or disable them. Use the verified workflow in [Account settings]({{DOCS_BASE_URL}}/en/account-settings) for your own email. If authorization, identity, target, or group configuration changes, updates, creation, and deletion fail as a whole rather than committing partial fields.

### Ongoing impersonation checks

With IAM enforcement, each use or cross-site restoration rechecks the original operator, target hierarchy, action, resource, conditions, and policies. Revoking Act authority rejects an existing Act session; it does not automatically downgrade to View Only. Revoked or expired role sessions, disabled or expired original AccessKeys, and forcing the original operator offline can also invalidate impersonation.

Sessions issued before enforcement without original issuer information must be started again. Legacy/shadow retain their previous authorization rules. Shadow evaluation does not create, update, or delete users a second time or issue a second impersonation token.

## Related pages

- [Group management]({{DOCS_BASE_URL}}/en/group-management)
- [Permission management]({{DOCS_BASE_URL}}/en/permission-management)
- [RAM management]({{DOCS_BASE_URL}}/en/ram-management)
- [Business logs]({{DOCS_BASE_URL}}/en/business-logs)
- [User online monitor]({{DOCS_BASE_URL}}/en/user-online-monitor)
