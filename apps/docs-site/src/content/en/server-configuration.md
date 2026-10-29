# Server configuration

Use this page to maintain global server-side settings. Operators with 2FA enabled may need a step-up challenge when saving settings.

## Page purpose

- Configure registration behavior (open/closed, max accounts per email, default group, code expiry).
- Maintain billing settings (recharge ratio).
- Manage SMTP and email delivery configuration.
- Tune IP-ban thresholds and ban durations.
- Configure captcha providers and trust window.
- Adjust heartbeat interval and timeout.
- Set relay upstream URL and API key.
- Configure the relay upstream proxy, with a per-channel opt-in switch.
- Configure notification default events and balance thresholds.

## What you will see

### Configuration sections

| Section                  | Key parameters                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| **Registration**         | Open/closed toggle, max accounts per email, default group, verification code expiry (seconds)       |
| **Billing**              | Recharge ratio (`rechargeRatio`)                                                                    |
| **SMTP**                 | Host, port, TLS, sender account and display name                                                    |
| **Captcha**              | Provider (`recaptcha` / `turnstile` etc.), fallback provider, minimum score, trust window (minutes) |
| **Heartbeat**            | Interval seconds, timeout seconds                                                                   |
| **IP ban**               | Three-tier thresholds and ban durations, error-decay switch and rate                                |
| **Relay**                | Upstream URL and API key                                                                            |
| **Relay upstream proxy** | Proxy toggle and HTTP/HTTPS/SOCKS URL; applies only to channels that opt in                         |
| **Notification**         | Default subscribed events, balance alert thresholds                                                 |

### Public read-only endpoints

- `GET /v1/config/public/registration` — used by the frontend to decide whether to show the register button.
- `GET /v1/config/public/captcha` — used by the frontend to load the active captcha provider and enabled state.

### Editing tools

- Collapsible per-section layout with an independent save button per section.
- When the operator has 2FA enabled, saving may trigger a step-up challenge; a valid trusted window can satisfy the current security rules.
- Requires `SYSTEM_CONFIG` permission.

## Resource-level configuration permissions

Membership in a deployment administrator group with `SYSTEM_CONFIG` is required to manage global settings. Deployments enforcing IAM additionally require `quyan:system:ListConfigurations` for reads or `quyan:system:UpdateConfigurations` for saves on `acs:platform:*:platform:config-item/<configuration-key>`. An ordinary account owner or account policy cannot grant deployment administrator eligibility.

Reading the registration, SMTP, site, billing, notification, heartbeat, remote terminal unbind, relay, upstream proxy, auto proxy pool, IP ban, captcha, or social sign-in section checks every configuration key in that section; a denied key rejects the whole read. The generic configuration list shows only authorized keys. If any key in a save is unauthorized, another administrator has changed the configuration, or authorization expires before commit, the whole save fails without partial changes. Public registration, captcha, and social sign-in endpoints continue to expose only public settings needed for their entry points. Credentials needed for sign-in and captcha verification stay on the server and are not returned by public configuration endpoints.

With IAM enforcement, SMTP passwords, relay API keys, social sign-in client/app secrets, and upstream or proxy URLs containing usernames or passwords are shown as `[configured]`. Keeping that placeholder preserves the corresponding stored value; a new value replaces it, and an explicitly submitted empty string clears it. The placeholder is never stored as a configuration value. Saving auto proxy pool settings also requires step-up verification and replay protection. The sample count must be 1–1000 and the statistics window must be 1–8760 hours.

In enforcement mode, reading or updating `notification.ticketAssignmentRules` through the general configuration API also requires active global-group eligibility for `TICKET_REVIEW_UPDATE` and the corresponding `quyan:ticket:GetAssignmentRules` or `quyan:ticket:UpdateAssignmentRules` grant. A Deny on the dedicated operation also restricts the general configuration entry point. Without these permissions, the generic list hides the key; reads of the notification section and batch saves containing that key are rejected.

## Common actions

1. Expand the section you need to adjust.
2. Edit only the values relevant to the current task.
3. Save and complete the step-up challenge if prompted.
4. Re-check related monitoring after major rule changes.

## Notes

- Small changes here can affect registration, billing, mail delivery, captcha behavior, and abuse controls.
- SMTP mistakes often surface in notification or password-recovery flows — send a test email after any change.
- The relay upstream proxy is disabled by default. Enable it here and enter a proxy URL, then enable “Use proxy” in each channel that should use it; other channels remain direct.
- Proxy URLs may contain credentials and should be treated as sensitive configuration. Other server-side outbound requests are not routed through this setting.
- IP-ban and decay changes should be coordinated with monitoring data.
- The captcha trust window (`trustWindowMinutes`) controls how long a verified session can skip repeated captcha checks.

## AI resource protection (advanced)

Groups cover admission and memory, stream parsing and conversion, chat and support, audit, connection pools, images and probes, and compiled rules. Suggested values, units and valid ranges come from the server. Saving the complete configuration retains system-config permissions, step-up verification and replay protection; no restart is needed.

Running requests keep their content budgets; lowering concurrency does not terminate them. Other processes refresh within five seconds. A context count of 0 disables only the count limit; byte and database limits remain. When legacy environment values are detected, management configuration takes precedence after the first save.

Oversized request bodies receive 413 before an upstream call and are not charged. Capacity failures do not retry another channel. Non-stream text and image responses are size-checked before success is sent, so an image may start arriving later than the upstream first byte.

Ordinary same-protocol streams are not stopped solely because cumulative forwarded bytes exceed the retained-text capacity. Frame parsing, protocol conversion, content review and chat storage still have their own capacities. Overflow detected before response headers receives 413. Once SSE has started, its HTTP status cannot change; clients must check `error` / `response.failed` events. A server capacity failure then produces an explicit error, no successful completion marker and no user charge; any persisted partial chat message remains failed. Partial output from an upstream failure or a client-initiated stop keeps the existing settlement rules.

## Related pages

- [IP monitoring dashboard]({{DOCS_BASE_URL}}/en/ip-monitoring-dashboard)
- [Notification settings]({{DOCS_BASE_URL}}/en/notification-settings)
- [Relay settings]({{DOCS_BASE_URL}}/en/relay-settings)
