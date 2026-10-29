# User management

Use this page to maintain platform user accounts, status, and core profile data.

## Page purpose

- Search and browse users.
- Create or edit accounts.
- Reset passwords, delete users, or impersonate for support.
- Review groups, status, and creation details.

## What you will see

### User list

- Username, display name, and email.
- Status, group, and created-at fields.
- A paginated table or mobile cards with keyword and group filters. The keyword can match a username, email, name, or user ID; there is no separate user-ID field.
- The **Show RAM Users** switch filters for RAM subusers when enabled; RAM subusers are excluded by default when it is off. The current operator is excluded from the list.
- Refresh clears filters and returns to the first page.

### Management actions

- Create user.
- Edit user (profile, status).
- Change password.
- Delete user.
- Impersonate or switch to the user's perspective.

## Common actions

1. Search or paginate to the target user.
2. Open edit to change profile details or account status.
3. Use password reset during recovery or handover scenarios.
4. To help a user, verify the target, select **Enter Account**, and confirm the prompt. The banner shows the target username and impersonation mode; actions in act mode are performed on the user’s behalf. Check the mode before acting, and select **Exit Impersonation** in the banner when finished to restore your session.

## Impersonation modes and exit

View mode blocks write requests; act mode permits actions on the target user’s behalf. The system selects a mode according to the authorized permissions. Either impersonation permission can make **Enter Account** visible, but the button alone does not guarantee act mode. Actions are recorded in the audit log.

An impersonation session lasts one hour and has no refresh token. **Exit Impersonation** attempts to restore the original session. If restoration fails, refresh as prompted and confirm your current identity before continuing. For IAM enforcement requirements and ongoing checks, see “User impersonation by resource” below.

## Level hierarchy rules

Operations are subject to the following constraints:

- You can only manage users whose group level is **strictly higher** (numerically larger) than your own.
- You cannot edit or delete a user at the same or higher tier.
- You cannot delete yourself.

## Deletion behavior

Deletion marks the account as deleted and releases its original username. Do not treat it as removal of all associated business data. The deletion is recorded in the **business log**. Check the target account and its associated resources before deleting it.

## Permission requirements

| Action                         | Required permission                                                             |
| ------------------------------ | ------------------------------------------------------------------------------- |
| View users                     | `USER_READ`                                                                     |
| Create user                    | `USER_CREATE`                                                                   |
| Edit user (profile, status)    | `USER_UPDATE`                                                                   |
| Delete user                    | `USER_DELETE`                                                                   |
| Change another user's password | `USER_CHANGE_OTHERS_PASSWORD`                                                   |
| Impersonate a user             | `USER_IMPERSONATE_VIEW` or `USER_IMPERSONATE_ACT` (either grants impersonation) |

When changing another user's password, an operator with 2FA enabled may need to complete a step-up challenge; a trusted window can satisfy the current security rules.

## Resource permissions for directory reads

In IAM enforcement mode, the user directory uses `quyan:user:ListUsers` and details use `quyan:user:GetUser`. Each managed user is identified by `acs:platform:*:platform:user/<userId>`. Both operations require an active deployment-managed global group with `USER_READ`; a personal permission, private group, or account-owner identity cannot replace that eligibility. Account RAM-user management continues to use its own account resources and actions.

The list retains the existing group-level visibility range and RAM-user filters, then removes users denied by policy before calculating totals, pages, or `hasMore`. Only the authorized page is loaded. A list grant does not grant details. Disabled users remain available for account management, while deleted users are excluded from these reads. An unavailable or denied detail returns a generic authorization error without profile or balance data.

Pages contain at most 100 users and page numbers are limited to 10,000. Changes to source profile data, ownership, balance, group display data, list eligibility, policies, or role sessions during a read cause rejection. Responses keep the existing profile fields and never include passwords or permission arrays. AssumeRole requests use role grants rather than inheriting the actor's global-group Allow; authenticated AccessKeys use the same resource checks.

IAM authorization also requires an active account owner. After the owner is disabled or deleted, an otherwise active sub-user cannot continue to authorize with its JWT, authenticated AccessKey, or AssumeRole session. Ordinary and administrator account owners follow the same active-status requirement.

## Delete users by resource

In IAM enforce mode, `quyan:user:DeleteUser` authorizes the target resource `acs:platform:*:platform:user/<userId>` and requires user deletion qualification in the operator's active global management group. You cannot delete yourself, your current account owner, or a user at the same or a higher privilege level. Disabled users can be deleted under the same restrictions.

Deletion marks the user as deleted and releases the original username. Changes to target data, privilege levels, policies, or role sessions between authorization and commit reject the request. Failed grant or condition checks before commit roll back both status and username. Deletion does not require list or detail read permission. The `legacy` and `shadow` modes retain the original delete permission checks; shadow evaluation does not perform a second deletion.

## User impersonation by resource

In IAM enforce mode, impersonation is authorized against the target user resource `acs:platform:*:platform:user/<userId>`:

- `quyan:user:StartViewImpersonation` issues a read-only impersonation session.
- `quyan:user:StartActImpersonation` issues a session that allows changes.

Each action also requires its corresponding impersonation qualification in the operator's active global management group. Personal additions, private groups, or a policy Allow alone cannot replace that qualification. The target must be active and have a lower privilege level than the operator. Self impersonation and nested impersonation are rejected.

The system prefers the authorized act mode. It can fall back to view mode only when view mode is separately authorized. A view session cannot make write requests. Impersonation tokens last one hour and have no refresh token.

Every use or cross-site restoration rechecks the original operator, target privilege level, matching action, resource, conditions, and current policies. Revoking act permission rejects an existing act session instead of silently downgrading it to view. Revoking or expiring the issuing role session, disabling or expiring the issuing AccessKey, or forcing the operator offline also prevents continued use. AssumeRole uses the current role's grants and cannot inherit the operator's global group Allow.

After switching to IAM enforce mode, pre-switch impersonation tokens that lack original issuer provenance require a new impersonation session. The `legacy` and `shadow` modes retain the existing permission checks and impersonation behavior. Shadow compares resource checks and signs only one token.

## Resource-scoped user updates

In IAM enforce mode, user updates authorize `acs:platform:*:platform:user/<userId>` and require user-management qualification in the operator’s active global group:

| Change              | Required Action                            |
| ------------------- | ------------------------------------------ |
| User profile update | `quyan:user:UpdateUser`                    |
| Email field         | Also requires `quyan:user:SetUserEmail`    |
| Status field        | Also requires `quyan:user:SetUserStatus`   |
| Group field         | Also requires `quyan:user:AssignUserGroup` |

Group assignment must cover both the target user ARN and `acs:platform:*:platform:group/<groupId>`. The destination must be an active global group or belong to the target user’s actual account. Its policies, scoped authorizations and role grants are checked. Ordinary operators can only delegate authority they already hold, cannot increase the target’s privilege level, and cannot expand authority by removing the previous group’s Deny. The actual main account in the configured global administrator group can perform controlled recovery grants, but still needs the corresponding Actions; a matching explicit Deny continues to block the operation. Replacing another account owner’s group must also preserve their existing IAM recovery authority and cannot introduce Deny from a group policy or role.

This endpoint permits ordinary self profile changes such as a name update, but cannot change the operator’s own or current account owner’s group, recovery email, or disable that identity. Use the verified account-settings workflow for your own email. Disabled targets can receive profile updates and can be enabled with separate status authority. Ordinary updates cannot modify another user at an equal or higher privilege level.

Authorization, target metadata, groups, role sessions and relevant policies are rechecked in the transaction. Failed checks roll back all name, email, status and group changes in the request. `legacy` and `shadow` retain old permission enforcement; shadow compares decisions without executing another update.

## Resource-level user creation

In IAM enforcement mode, `quyan:user:CreateUser` must cover both resources:

- The user directory: `acs:platform:*:platform:user-directory`.
- The actual user generated by the server: `acs:platform:*:platform:user/<userId>`; an advance grant can use `user/*`.

The operator must belong to an active global management group with user creation eligibility. A created user is an independent account owner. Requests cannot choose its ID, owning account, or personal additional permissions. Passwords continue through the existing encrypted transport and server hashing flow, and responses do not return passwords.

Selecting a group also requires `quyan:user:AssignUserGroup` on both the new user and `acs:platform:*:platform:group/<groupId>`. New accounts can join active global groups only. Ordinary operators cannot create users with equal or higher privilege, or delegate authority they do not hold. The configured actual global administrator account owner can perform controlled recovery creation; role sessions cannot use this exception, and explicit Deny still applies. Creation eligibility does not confer eligibility to update existing users.

When no group is selected, the standard registration group is used. Its exact seeded baseline can be granted directly only while that baseline remains intact. Additional group permissions, policies, and role grants still require delegation checks. Explicitly selecting the same group requires full assignment authorization and delegation checks.

The directory is checked first. The transaction generates a real ID and then checks its user resource and group authority. Revocation, group changes, or a denied resource roll back the complete creation. `legacy` and `shadow` retain legacy enforcement. Shadow checks the actual ID created by the old flow without creating another user.

## Notes

- Before deleting or disabling a user, confirm related balances, permissions, and owned resources.
- Impersonation is a high-trust action and should be limited to support or operations staff.
- For complex issues, combine this page with permission and business-log pages.

## Related pages

- [Group management]({{DOCS_BASE_URL}}/en/group-management)
- [Permission management]({{DOCS_BASE_URL}}/en/permission-management)
- [Business logs]({{DOCS_BASE_URL}}/en/business-logs)
