# Notification settings

Use this page to manage how the system contacts you about important events, and for admins to set global notification defaults.

## Page purpose

- Configure notification email and cooldown behavior.
- Set event subscriptions and alert thresholds.
- Manage webhook delivery targets.
- Review delivery history.
- (Admins) Adjust global default subscribed events and balance thresholds.

## Permissions and availability

- In legacy permission mode, notification preferences still require notification-management permission; signing in alone does not grant access.
- In IAM enforcement mode, reading uses `quyan:notification:GetPreferences` and saving uses `quyan:notification:UpdatePreferences`. The operations can be granted separately.
- The resource is the executing user's own identity: `acs:quyan:*:<accountId>:user/<userId>`. The server derives the account and user from authenticated context; supplying another user or ARN cannot change the target.
- An explicit Deny for this resource overrides Allow. Group and role policies can participate; an assumed role uses its valid session permissions rather than the caller's direct policies.
- The first authorized read may create default preferences; later reads synchronize newly introduced events. Events you explicitly unsubscribed from do not become subscribed again merely because they are already known. Inactive or disabled identities, role sessions and preference records cannot be read or modified.
- These operations cover reading and saving preferences. Webhooks and delivery tests retain their respective existing permission checks. Delivery history and event catalog permissions are described below.

## In-app inbox permissions

Signed-in users can view their own inbox and mark messages as read. In IAM enforce mode, these operations retain a default grant limited to the executing user's messages. Explicit Deny can restrict individual messages.

- Listing messages uses `quyan:notification:ListInbox`.
- Marking messages as read manually uses `quyan:notification:MarkInboxRead`.
- Confirming messages opened through an email pixel uses `quyan:notification:ConfirmPixelOpenedInboxRead`.
- Each message resource is `acs:notification:*:<accountId>:inbox-item/<userId>/<itemId>`. The server determines the account and user; submitting another user's message ID does not grant access.
- Messages are filtered by authorization before pagination. Total, unread, and opened-but-unconfirmed counts include only visible messages.
- When selecting message IDs to mark as read, every target must be authorized. A missing, inactive, or denied target prevents the entire batch from updating. Duplicate IDs count once, and already-read messages do not count again.
- Mark-all and email-open confirmation update only authorized messages belonging to the executing user. Denied messages remain unchanged. Fetching an email image does not bypass confirmation authorization.

## Delivery history and event catalog permissions

- In IAM enforce mode, delivery logs use `quyan:notification:ListDeliveryLogs`. Logs may contain notification content and require a separate grant; signing in does not grant access. Legacy notification-management permission is mapped to this operation for compatibility.
- Each log resource is `acs:notification:*:<accountId>:delivery-log/<userId>/<logId>`. Queries are limited to the executing user's records. Even a wildcard policy does not allow callers to change the target by supplying another user.
- Logs are authorized individually before pagination, and totals include only authorized records. Explicit Deny can restrict individual logs or logs in a resource group. A list with no visible records is empty.
- The event catalog uses `quyan:notification:ListEvents` on the executing user's own `acs:quyan:*:<accountId>:user/<userId>` resource. Authenticated identities retain a default grant to view event types, which explicit Deny can restrict. This action does not grant subscription changes, log access, or test delivery.

## What you will see

### Email settings

- Notification email preference (can differ from the account email).
- Send test-email action.
- Cooldown controls to prevent repeated alerts in a short window.

### Event subscriptions

- Event list with enable / disable toggles.
- Threshold fields for alerts that depend on counts or balance limits.
- New users have all events subscribed by default (configurable by admins in server configuration).

### Webhooks and delivery logs

- Webhook list (URL, status, last-delivery time).
- Add, edit, and test webhook actions.
- Paginated delivery log to investigate failed deliveries.

### Admin: global notification config

Admins can change the following global defaults via the **server configuration** page (stored under `CONFIG_KEYS.NOTIFICATION`):

| Setting                   | Meaning                                        |
| ------------------------- | ---------------------------------------------- |
| `defaultSubscribedEvents` | Default event subscriptions for new users      |
| `defaultThresholds`       | Default balance alert thresholds for new users |

Changes to global defaults only affect newly created accounts, not existing users.

## Common actions

1. Confirm the email address that should receive alerts.
2. Enable only the events you actually need to avoid notification fatigue.
3. Add webhooks for automation or external monitoring tools.
4. Use the test action before relying on a new delivery target.
5. Review delivery logs when alerts do not arrive — they show the status code and response body.

## Notes

- Webhooks should point to endpoints you control.
- Event subscription changes take effect immediately with no restart required.
- Delivery logs help separate content issues from destination issues.

## Related pages

- `account-settings`
- `server-configuration`
- `system-logs`
