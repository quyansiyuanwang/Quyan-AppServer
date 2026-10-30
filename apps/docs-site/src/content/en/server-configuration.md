# Server configuration

Deployment administrators use this page to maintain registration, billing, mail, security checks, and resource capacity. Changes can affect all users. Read current values before saving each section, then verify the affected workflow.

## Before you start

- Use an account eligible for `SYSTEM_CONFIG` management. IAM-enforced deployments also require read and update grants for the relevant configuration keys, as described below.
- Operators with 2FA enabled may receive a challenge on save; trusted windows follow current rules. Saves also require replay protection.
- Record original values needed for recovery. A secret presence marker is not the secret itself; retain credentials through your existing secure storage process.

## Choose a configuration section

| Section                                | Parameters                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Registration**                       | Registration switch, accounts per email, default group, verification code lifetime in seconds                  |
| **Billing**                            | Recharge ratio, gift-code and direct-transfer switches, fees, and gift-code cancellation fee refund percentage |
| **SMTP**                               | Host, port, TLS, authentication account, and sender identity                                                   |
| **Captcha**                            | Primary and fallback provider, minimum score, and trust window in minutes                                      |
| **Heartbeat**                          | Interval and timeout in seconds                                                                                |
| **IP ban, error decay, error weights** | Separately saved ban thresholds and durations, decay settings, and HTTP/business error weights                 |
| **Site**                               | Public backend URL used for notification email tracking pixels                                                 |
| **Social sign-in**                     | Frontend result URL, QR login switch and timing, GitHub and WeChat credentials                                 |
| **Remote terminal unbind**             | Personal unbind count, statistics window, and rebind cooldown                                                  |
| **Relay upstream proxy**               | Proxy switch and HTTP/HTTPS/SOCKS URL; only channels that opt in use it                                        |
| **Notification**                       | Default subscribed events and alert thresholds                                                                 |
| **AI resource protection**             | Concurrency, queues, memory, content, stream parsing, connection pools, and audit capacities                   |

This page has no separate editor for Relay upstream credentials or auto proxy pool settings. Use the corresponding management entry point or an authorized API. The upstream proxy URL is not the upstream model service URL.

### Public read-only endpoints

- `GET /v1/config/public/registration` — registration entry availability.
- `GET /v1/config/public/captcha` — active captcha provider and enabled state.
- `GET /v1/config/public/social-auth` — public social sign-in settings, excluding client secrets.

## Read, edit, and verify a save

1. Expand the target section and wait for a successful read. Most sections cache their first successful load; collapsing and reopening does not refresh them. Record drafts before refreshing the page to reload. Registration also loads user groups, and notifications also load the event catalog. Failure of either request means the form is not fully loaded.
2. Edit the required values and check the whole section. Saving submits that section's complete settings, including unchanged fields, and requires authorization for the submitted keys. After a load failure, initial values or old drafts may remain; do not save them as if they were current settings.
3. Click that section's save button and complete verification. Drafts in other sections are not saved. There is no page-wide save.
4. Read the values again and test the affected workflow. Ordinary sections do not reload automatically after success. Refreshing the page discards other unsaved drafts. A timeout does not prove the write failed; check server state before retrying.

An old form does not reliably detect every change made since the page opened and can overwrite another administrator's saved values. Reload and coordinate when editing together. Changes to configuration or authorization during request processing can still reject the entire save. Do not repeatedly submit an old draft after failure.

### Keep, replace, or clear a secret

With IAM enforcement, stored SMTP passwords, social sign-in secrets, and credential-bearing URLs appear as `[configured]`. Keeping the marker preserves the value; entering a complete new value replaces it; explicitly submitting an empty string clears it. The marker cannot authenticate to another service. Read again after saving: text remaining in the browser does not prove what the server stored.

### Registration, billing, and mail

- Registration settings control sign-up availability, accounts per email, default group, and verification code lifetime. The group selector contains only currently readable groups. Check group permissions and visibility if the target is missing. Closing registration does not deactivate existing users.
- Billing saves the recharge ratio, both transfer switches, and fee rules together. Values support up to four decimal places; the recharge ratio must be positive and percentages range from 0–100. Do not treat a setting change as recalculation of existing orders or an automatic refund. Check amounts through the applicable transaction workflow.
- Enter an SMTP hostname or IPv4 address, not a URL with a protocol. Check the port, TLS, authentication account, password, sender name, and valid sender email. Saving does not send a test message or prove connectivity; check delivery through an actual notification or verification workflow. The site's public backend URL supplies email tracking pixel links; it does not change server listeners or DNS.

### Captcha and social sign-in

- Primary and fallback captcha providers are `none`, `recaptcha`, or `turnstile`. If the primary is `none`, the fallback must also be `none`; otherwise they must differ. The minimum score is 0–1 for reCAPTCHA. The trust window is 0–1440 minutes; 0 disables reuse of that window. It does not replace login or 2FA. Programmatic requests do not use the browser trust cookie.
- Selecting a provider does not configure its server secret or frontend site key. Have the deployment administrator configure these before testing actual entry points such as login.
- Saving social sign-in first reads current settings, preserves provider endpoints, scopes, and callback paths not editable here, then submits the page fields. A failed read stops the save. Check the callback registered with the provider matches this deployment.
- Some form controls permit a wider range than the server: authorization state lifetime is 60–3600 seconds, QR session lifetime is 60–1800 seconds, and polling is 1–30 seconds. Supply the relevant credentials before enabling GitHub or WeChat. Successful saving does not prove provider connectivity.

### Notifications, online status, and device unbinding

- Default notification events and thresholds initialize user preferences; they do not overwrite existing preferences in bulk. Select all and clear all change the draft until saved. Saving also resubmits loaded ticket assignment rules that are not editable here, so assignment authorization may be required. Manage those rules in [Ticket review]({{DOCS_BASE_URL}}/en/ticket-management).
- Heartbeat intervals are 5–3600 seconds and timeouts are 10–86400 seconds. Reads enforce an effective timeout of at least the interval plus five seconds. Read again after saving rather than relying on unchanged input boxes. These settings affect online detection; they do not directly force users offline.
- A personal remote terminal unbind count of 0 disables personal unbinding; **it does not mean unlimited**. Unbind records share the allowance within one entitlement. The statistics window is 1–8760 hours and rebind cooldown is 0–525600 minutes. Changing the rule does not reset history or uninstall agents.

### IP bans and error scoring

Ban thresholds and durations, error decay, and error weights save separately. The third-level duration supports permanent bans (`-1`). Changing rules does not manually remove existing bans; check the [IP monitoring dashboard]({{DOCS_BASE_URL}}/en/ip-monitoring-dashboard). Saving error weights replaces both entire mappings. Avoid empty or duplicate codes; for duplicates, only the last row's weight is retained. Removing a row does not update the server until saved.

Error decay and weights load through the generic configuration list, which returns only authorized keys. Missing keys can therefore appear as default drafts. A visible form does not prove all configuration was read; confirm read access to the relevant keys before saving.

## Resource-level configuration permissions

Membership in a deployment administrator group with `SYSTEM_CONFIG` is required to manage global settings. Deployments enforcing IAM additionally require `quyan:system:ListConfigurations` for reads or `quyan:system:UpdateConfigurations` for saves on `acs:platform:*:platform:config-item/<configuration-key>`. An ordinary account owner or account policy cannot grant deployment administrator eligibility.

Dedicated reads for registration, SMTP, site, billing, notification, heartbeat, remote terminal unbind, relay, upstream proxy, auto proxy pool, IP ban, captcha, and social sign-in check every key in that configuration set. A denied key rejects the whole read. The generic list returns only authorized keys. An unauthorized key, configuration change during request processing, or identity invalidation before commit rejects the whole save without partial changes. Public endpoints return entry-point settings, without sign-in or captcha secrets.

With IAM enforcement, SMTP passwords, relay API keys, social sign-in client/app secrets, and upstream or proxy URLs containing usernames or passwords are shown as `[configured]`. Keeping that placeholder preserves the corresponding stored value; a new value replaces it, and an explicitly submitted empty string clears it. The placeholder is never stored as a configuration value. Saving auto proxy pool settings also requires step-up verification and replay protection. The sample count must be 1–1000 and the statistics window must be 1–8760 hours.

In enforcement mode, reading or updating `notification.ticketAssignmentRules` through the general configuration API also requires active global-group eligibility for `TICKET_REVIEW_UPDATE` and the corresponding `quyan:ticket:GetAssignmentRules` or `quyan:ticket:UpdateAssignmentRules` grant. A Deny on the dedicated operation also restricts the general configuration entry point. Without these permissions, the generic list hides the key; reads of the notification section and batch saves containing that key are rejected.

## Notes

- Small changes here can affect registration, billing, mail delivery, captcha behavior, and abuse controls.
- SMTP mistakes often surface in notification or password-recovery flows — send a test email after any change.
- The relay upstream proxy is disabled by default. Enable it here and enter a proxy URL, then enable “Use proxy” in each channel that should use it; other channels remain direct.
- Proxy URLs may contain credentials and should be treated as sensitive configuration. Other server-side outbound requests are not routed through this setting.
- IP-ban and decay changes should be coordinated with monitoring data.
- The captcha trust window (`trustWindowMinutes`) controls how long a verified session can skip repeated captcha checks.

## AI resource protection (advanced)

Groups cover admission and memory, stream parsing and conversion, chat and support, audit, connection pools, images and probes, and compiled rules. Suggested values, units and valid ranges come from the server. Saving the complete configuration retains system-config permissions, step-up verification and replay protection; no restart is needed.

Restore defaults replaces the complete draft with server suggestions; saving is still required. Reload replaces the draft with current effective values. Saving submits all AI resource groups and then reloads automatically. If the subsequent read fails, check server state before saving again.

Running requests keep their content budgets; lowering concurrency does not terminate them. Other processes normally attempt to refresh every five seconds and retain old values on read failure; this is not a guarantee that all processes update within five seconds. A context count of 0 disables only the count limit; byte and database limits remain. When legacy environment values are detected, management configuration takes precedence after the first save.

Oversized request bodies receive 413 before an upstream call and are not charged. Capacity failures do not retry another channel. Non-stream text and image responses are size-checked before success is sent, so an image may start arriving later than the upstream first byte.

Ordinary same-protocol streams are not stopped solely because cumulative forwarded bytes exceed the retained-text capacity. Frame parsing, protocol conversion, content review and chat storage still have their own capacities. Overflow detected before response headers receives 413. Once SSE has started, its HTTP status cannot change; clients must check `error` / `response.failed` events. A server capacity failure then produces an explicit error, no successful completion marker and no user charge; any persisted partial chat message remains failed. Partial output from an upstream failure or a client-initiated stop keeps the existing settlement rules.

## Related pages

- [IP monitoring dashboard]({{DOCS_BASE_URL}}/en/ip-monitoring-dashboard)
- [Notification settings]({{DOCS_BASE_URL}}/en/notification-settings)
- [Relay settings]({{DOCS_BASE_URL}}/en/relay-settings)
