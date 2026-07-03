# Notification settings

Use this page to manage how the system contacts you about important events, and for admins to set global notification defaults.

## Page purpose

- Configure notification email and cooldown behavior.
- Set event subscriptions and alert thresholds.
- Manage webhook delivery targets.
- Review delivery history.
- (Admins) Adjust global default subscribed events and balance thresholds.

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
