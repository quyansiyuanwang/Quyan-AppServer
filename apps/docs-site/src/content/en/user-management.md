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

## Notes

- Before deleting or disabling a user, confirm related balances, permissions, and owned resources.
- Impersonation is a high-trust action and should be limited to support or operations staff.
- For complex issues, combine this page with permission and business-log pages.

## Related pages

- `group-management`
- `permission-management`
- `business-logs`
