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
- These operations cover reading and saving preferences. Webhook, delivery history and event catalog permissions are described below. Delivery-test permissions are described below.

## In-app inbox permissions

Signed-in users can view their own inbox and mark messages as read. In IAM enforce mode, these operations retain a default grant limited to the executing user's messages. Explicit Deny can restrict individual messages.

- Listing messages uses `quyan:notification:ListInbox`.
- Marking messages as read manually uses `quyan:notification:MarkInboxRead`.
- Confirming messages opened through an email pixel uses `quyan:notification:ConfirmPixelOpenedInboxRead`.
- Each message resource is `acs:notification:*:<accountId>:inbox-item/<userId>/<itemId>`. The server determines the account and user; submitting another user's message ID does not grant access.
- Messages are filtered by authorization before pagination. Total, unread, and opened-but-unconfirmed counts include only visible messages.
- When selecting message IDs to mark as read, every target must be authorized. A missing, inactive, or denied target prevents the entire batch from updating. Duplicate IDs count once, and already-read messages do not count again.
- Mark-all and email-open confirmation update only authorized messages belonging to the executing user. Denied messages remain unchanged. Fetching an email image does not bypass confirmation authorization.

## Webhook permissions

- In IAM enforce mode, listing, creating, updating and deleting use `quyan:notification:ListWebhooks`, `quyan:notification:CreateWebhook`, `quyan:notification:UpdateWebhook` and `quyan:notification:DeleteWebhook` respectively. Each requires an explicit grant; signing in alone does not grant access. Legacy notification-management permission maps to these operations; other Actions in JSON policies do not expand automatically.
- Creation targets the executing user's own `acs:quyan:*:<accountId>:user/<userId>`. An authorized creation can initialize missing notification preferences while preserving existing preferences and subscriptions. Creating a Webhook does not grant permission to read or update preferences.
- Existing Webhooks use `acs:notification:*:<accountId>:webhook/<userId>/<webhookId>` and can be individually authorized or scoped through resource groups. Only the executing user's targets are accessible; wildcard grants cannot switch to another user.
- Lists return only authorized Webhooks, with explicit Deny taking precedence. Signing secrets are never returned; `hasSecret` only indicates whether one is configured. An explicit `null` clears the secret; omitting the field preserves it.
- Inactive identities, preferences or role sessions cannot manage Webhooks. If a target changes after authorization, refresh and retry. Deleting a target disables it. Delivery tests require their own grants, described below.

## Test-delivery permissions

- Testing a Webhook uses `quyan:notification:TestWebhook` on its concrete `acs:notification:*:<accountId>:webhook/<userId>/<webhookId>`. Listing or updating Webhooks does not grant test-delivery permission.
- Sending a test email uses `quyan:notification:TestEmail` on the executing user's `acs:quyan:*:<accountId>:user/<userId>`. Reading or updating preferences does not grant test-email permission.
- Both operations require explicit grants and honor explicit Deny, conditions, resource-group scope and valid role sessions. Legacy notification-management permission maps to both; test delivery can be denied separately while retaining editing access.
- Tests use your own saved destinations. Supplied email addresses, user IDs or Actions cannot replace the target. An authorized test email may initialize missing preferences; clearing the configured email prevents sending. Test email creates an inbox message for you.
- Tests send real notifications. Changes to the target, identity or preferences before delivery can require refreshing and retrying. Delivery failures show a general message without signing secrets, SMTP credentials or upstream response content.

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
- Initial subscriptions and thresholds follow the server configuration when notification preferences are first created.

### Webhooks and delivery logs

- Webhook list (name, URL, format, and enabled status).
- Add, edit, and test webhook actions.
- Paginated delivery log showing event, channel, status, time, and error message.

### Admin: global notification config

Admins can change the following global defaults via the **server configuration** page (stored under `CONFIG_KEYS.NOTIFICATION`):

| Setting                   | Meaning                                        |
| ------------------------- | ---------------------------------------------- |
| `defaultSubscribedEvents` | Default event subscriptions for new users      |
| `defaultThresholds`       | Default balance alert thresholds for new users |

These defaults initialize preferences that have not yet been created; they do not directly overwrite saved preferences. Subscriptions for newly introduced events may also be synchronized on a later read.

## Common actions

1. Confirm the email address that should receive alerts.
2. Enable only the events you actually need to avoid notification fatigue.
3. Add webhooks for automation or external monitoring tools.
4. Use the test action before relying on a new delivery target.
5. When alerts do not arrive, check the status and error message in delivery logs, as well as the destination email or webhook.

## Notes

- Webhooks should point to endpoints you control.
- Event subscription changes take effect immediately with no restart required.
- Filter inbox messages by unread status, mark messages individually or mark all as read. Use the confirmation action to mark email-opened messages as read in bulk.

## Related pages

- [Settings]({{DOCS_BASE_URL}}/en/account-settings)
- [Server configuration]({{DOCS_BASE_URL}}/en/server-configuration)
- [System logs]({{DOCS_BASE_URL}}/en/system-logs)
