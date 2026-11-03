# Notification settings

Use **Settings → Event Center** to manage your notification email, event subscriptions and webhooks, and to review inbox messages and external delivery results. These settings apply to the signed-in user. Administrators maintain global defaults in Server configuration.

## Before you begin

Wait for the event list and saved preferences to load. Reading preferences, saving preferences, managing webhooks, testing delivery and viewing history can be authorized separately. Opening the page does not grant every operation; see the permissions section below.

If events are missing or preferences look unexpected, check connectivity and permissions, then reload the page. Avoid saving an empty form: saving submits the current selections and thresholds and can overwrite existing settings.

## Configure notification preferences

1. In **Notification Preferences**, enter a **Notification Email**. It can differ from your account email. Saving it blank stops email notifications; it does not fall back to the account email.
2. Select the events you want. **Select All** and **Clear All** only change the form until you save.
3. Enter thresholds for supported events, using the table below.
4. Set the cooldown using days and hours:minutes. For example, `0 days 01:00` means 60 minutes.
5. Select **Save Preferences**, or **Save** on mobile. Changes take effect after a successful save, without restarting the service.

When preferences are first created, the email comes from your account, the cooldown is 60 minutes, and subscriptions and thresholds come from server configuration. Later changes to your account email or global defaults do not directly overwrite saved preferences.

Unsubscribing from a threshold event and saving also removes its saved custom threshold. Review the threshold when subscribing again.

### How alert thresholds work

| Event                    | Trigger                                                                              | Example                                 |
| ------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------- |
| Low balance              | Balance falls below the threshold, in Qu                                             | `10`: notify below 10 Qu                |
| Monthly pass quota low   | Remaining quota as a percentage of total is at or below the threshold                | `20`: notify with 20% or less remaining |
| Monthly pass daily limit | Usage in the current quota window reaches or exceeds the threshold percentage        | `80`: notify at 80% window usage        |
| Relay token quota low    | A token with a positive quota limit reaches or exceeds the threshold percentage used | `80`: notify at 80% used                |

Thresholds support two decimal places; the server accepts 0–100000. Percentages normally use 0–100. Balance and quota alerts are checked during relevant balance changes or usage settlement. Changing a threshold does not immediately scan historical data, and these alerts are not continuous real-time monitoring.

The monthly pass daily-limit alert uses the pass's rolling window, which defaults to 24 hours, rather than resetting at midnight. The current alert calculates usage from amounts covered in that window. For passes measured in requests or tokens, do not rely on this alert alone to determine the usage percentage. It does not apply to passes without a daily quota.

### Effects of cooldowns and subscriptions

Each user and event shares one cooldown across email and all webhooks. Once an ordinary delivery starts, later events of that type can remain suppressed even if a channel fails. Changing a destination does not immediately clear an existing cooldown.

**Use a cooldown greater than 0.** In the current version, setting it to 0 can leave a cooldown that does not expire after the first delivery, suppressing later ordinary notifications of the same type. If you previously saved 0, change it to a positive duration. If notifications do not resume, ask an administrator to check the existing cooldown state; changing the duration alone may not restore delivery.

Unsubscribing stops the corresponding email and webhook notifications. Some events can still create inbox messages, but certain alerts, including balance and monthly-pass alerts, check subscriptions before creating a notification. The inbox therefore does not provide a complete record of all events. An event that enters notification delivery can also create only an inbox message before its external delivery is skipped by cooldown.

## Add and maintain webhooks

1. In **Webhooks**, select **Add Webhook**, or **Create** on mobile.
2. Enter a name and a destination URL you control. Choose Generic JSON, Discord, Slack, Feishu or WeCom format.
3. Enter a signing secret if required by your receiver, and choose whether the target is **Enabled**. Names allow up to 100 characters, URLs 2048, and secrets 200.
4. Select **Save**, then test from the list and check the receiving system.

Signing secrets are never displayed again. **When editing an existing webhook, re-enter any secret you still need, even if you are only changing its name. Saving a blank secret clears the existing value.** Through the API, omitting the secret field preserves it and explicitly sending `null` clears it. The page sends `null` for an empty edit field.

Signatures use the `X-Webhook-Signature` header with a value of `sha256=<digest>`. The digest is HMAC-SHA256 of the actual JSON body using the configured secret. Selecting a robot format changes the message format; it does not automatically implement each robot platform's native signing protocol. Check compatibility if your receiver requires a different signature scheme.

To pause ordinary delivery, edit the target, clear **Enabled** and save. Deletion requires confirmation and removes it as a delivery target. The page has no restore action; existing delivery history remains available. Disabled targets can still be tested manually.

## Test saved destinations

**Test** beside the email field or in the webhook list sends a real notification using the saved email, URL, format and secret. Testing inside an existing webhook's edit dialog also uses the previously saved version. Save new targets before testing.

Tests use a simulated low-balance notification. Its balance and threshold are examples, not your actual balance. Tests bypass ordinary subscriptions and cooldowns; a test email also creates an inbox message for you. Tests do not create ordinary delivery-history entries, so history cannot establish whether a test ran.

A successful result means the send request completed, not that a person received or read the message. Email can enter spam folders. A webhook receiver can return HTTP success while reporting a robot business error in its response body. Check for the actual message at the destination. A successful test also does not establish that ordinary events meet subscription, threshold and cooldown conditions.

## View and mark inbox messages

1. In **Inbox**, review titles, content, timestamps and read status, or enable **Unread only**. Unread messages appear first; pages contain 20 messages.
2. Select **Mark as read** on a message, or **Mark all as read** to process all authorized unread messages belonging to you, across pages.
3. If messages show that their emails were opened but await confirmation, select **Confirm opened emails as read** to mark eligible authorized messages as read.
4. Use **Refresh** in this section for current messages and counts. The page does not poll automatically.

Email-open status depends on a tracking image. Clients that block images can prevent recording, while automatic image loading can create a record. It is not proof that the recipient read the email. Loading the image alone does not mark an inbox message as read; confirmation or manual marking is required. The page has no action to mark read messages unread again.

## Review notification history

**Notification History** lists ordinary email and webhook deliveries with their event, title, channel, status, time and error. Pages contain 20 entries. Use the section's **Refresh** action to reload.

| Status  | Meaning and next step                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------- |
| Success | The send request reported no transport error; still check the mailbox or receiving system                 |
| Failed  | Review the error and check the address, server mail configuration, connectivity and receiver requirements |
| Pending | No final result is available; refresh to check again. It does not mean delivered                          |

The page has no retry or resend action for historical messages, and failed deliveries are not retried automatically. Cooldown suppression, unsubscribed events, missing external destinations and test deliveries can leave no ordinary history entry. An empty history does not prove that no event occurred.

If inbox or history loading fails, old rows and counts can remain even after page or filter changes. Refresh and confirm a successful load before judging message status or delivery results.

## Admin: set global defaults

Set **Default Subscribed Events** and **Default Trigger Thresholds** in the notification section of [Server configuration]({{DOCS_BASE_URL}}/en/server-configuration). They initialize preferences that do not yet exist and do not directly overwrite existing user settings.

When new events are introduced, later preference reads may subscribe them automatically, so review your selections. Known events you explicitly unsubscribed from are not resubscribed by this synchronization.

## Permissions and availability

In legacy permission mode, preferences, webhooks, tests and history require notification-management permission. Signed-in users can access their own event catalog and inbox.

In IAM enforcement mode, operations are authorized separately. All Actions below start with `quyan:notification:`.

| Operation                                    | Action                                                          | Resource                                     |
| -------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| Read or save preferences                     | `GetPreferences`, `UpdatePreferences`                           | Your user resource                           |
| View event catalog                           | `ListEvents`                                                    | Your user resource; default self grant       |
| Create webhook or test email                 | `CreateWebhook`, `TestEmail`                                    | Your user resource                           |
| List, update, delete or test webhooks        | `ListWebhooks`, `UpdateWebhook`, `DeleteWebhook`, `TestWebhook` | Relevant webhook resource                    |
| View delivery history                        | `ListDeliveryLogs`                                              | Relevant delivery-log resource               |
| List inbox, mark read or confirm email opens | `ListInbox`, `MarkInboxRead`, `ConfirmPixelOpenedInboxRead`     | Relevant inbox resource; default self grants |

Resource formats use the account and user established by server authentication:

- Your user: `acs:quyan:*:<accountId>:user/<userId>`.
- Webhook: `acs:notification:*:<accountId>:webhook/<userId>/<webhookId>`.
- Delivery log: `acs:notification:*:<accountId>:delivery-log/<userId>/<logId>`.
- Inbox message: `acs:notification:*:<accountId>:inbox-item/<userId>/<itemId>`.

Operations without a default self grant require explicit authorization. Legacy notification-management permission maps to the corresponding operations; other Actions do not automatically expand access. Viewing or editing does not include testing, and creating a webhook does not grant preference access. An authorized preference read, webhook creation or email test may initialize missing preferences.

Every operation is limited to the executing user. Wildcards, another user ID or a supplied ARN cannot change the target. Explicit Deny overrides Allow; conditions and resource groups can further restrict scope. Assumed roles use their valid session permissions. Inactive identities, sessions or preferences prevent operations. Refresh and retry after a concurrent change.

Webhook, log and inbox lists are filtered by authorization before display. Message totals, unread counts and opened-but-unconfirmed counts include only visible messages. Mark-all and email confirmation process only messages authorized for that action, leaving denied messages unchanged. Through the API, a batch of explicit message IDs updates nothing if any target is missing, inactive or unauthorized. Duplicate IDs count once; already-read messages do not count again.

## Troubleshooting

| Problem                                                   | What to check                                                                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Email test succeeds but ordinary alerts do not arrive     | Check saved subscriptions, thresholds and a positive cooldown, then confirm an event actually triggered        |
| Testing after entering a new email still uses the old one | Save preferences first; an enabled Test button does not mean the new address was saved                         |
| Webhook signature checks fail after editing               | Check whether saving a blank field cleared the secret, and whether the receiver supports this signature scheme |
| Events or webhooks unexpectedly appear empty              | Check connectivity and read permissions, then reload; avoid overwriting saved preferences                      |
| Editing works but testing is denied                       | Ask an administrator to check the separate test Action                                                         |

## Related pages

- [Settings]({{DOCS_BASE_URL}}/en/account-settings)
- [Server configuration]({{DOCS_BASE_URL}}/en/server-configuration)
- [System logs]({{DOCS_BASE_URL}}/en/system-logs)
