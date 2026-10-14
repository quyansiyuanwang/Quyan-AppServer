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
- Paginated table with keyword, user ID, and group filters.

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
4. Use impersonation only when you need to reproduce a user issue and have permission.

## Level hierarchy rules

Operations are subject to the following constraints:

- You can only manage users whose group level is **strictly higher** (numerically larger) than your own.
- You cannot edit or delete a user at the same or higher tier.
- You cannot delete yourself.

## Deletion behavior

When a user is deleted, the system cleans up related data automatically, including:

- Associated business log entries.
- Rate-limit counters (prevents leftover counts from affecting new accounts).

All deletions are recorded in the **business log** and can be queried on the business-logs page.

## Permission requirements

| Action                         | Required permission                                                             |
| ------------------------------ | ------------------------------------------------------------------------------- |
| View users                     | `USER_READ`                                                                     |
| Create user                    | `USER_CREATE`                                                                   |
| Edit user (profile, status)    | `USER_UPDATE`                                                                   |
| Delete user                    | `USER_DELETE`                                                                   |
| Change another user's password | `USER_CHANGE_OTHERS_PASSWORD`                                                   |
| Impersonate a user             | `USER_IMPERSONATE_VIEW` or `USER_IMPERSONATE_ACT` (either grants impersonation) |

Changing another user's password additionally requires a fresh 2FA step-up challenge.

## Resource permissions for directory reads

In IAM enforcement mode, the user directory uses `quyan:user:ListUsers` and details use `quyan:user:GetUser`. Each managed user is identified by `acs:platform:*:platform:user/<userId>`. Both operations require an active deployment-managed global group with `USER_READ`; a personal permission, private group, or account-owner identity cannot replace that eligibility. Account RAM-user management continues to use its own account resources and actions.

The list retains the existing group-level visibility range and RAM-user filters, then removes users denied by policy before calculating totals, pages, or `hasMore`. Only the authorized page is loaded. A list grant does not grant details. Disabled users remain available for account management, while deleted users are excluded from these reads. An unavailable or denied detail returns a generic authorization error without profile or balance data.

Pages contain at most 100 users and page numbers are limited to 10,000. Changes to source profile data, ownership, balance, group display data, list eligibility, policies, or role sessions during a read cause rejection. Responses keep the existing profile fields and never include passwords or permission arrays. AssumeRole requests use role grants rather than inheriting the actor's global-group Allow; authenticated AccessKeys use the same resource checks.

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

## Notes

- Before deleting or disabling a user, confirm related balances, permissions, and owned resources.
- Impersonation is a high-trust action and should be limited to support or operations staff.
- For complex issues, combine this page with permission and business-log pages.

## Related pages

- `group-management`
- `permission-management`
- `business-logs`
