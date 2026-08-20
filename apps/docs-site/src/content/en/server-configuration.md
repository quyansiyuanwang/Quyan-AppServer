# Server configuration

Use this page to maintain global server-side settings. All write operations require a step-up 2FA challenge.

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

- `GET /config/public/registration` — used by the frontend to decide whether to show the register button.
- `GET /config/public/captcha` — used by the frontend to load the active captcha provider and enabled state.

### Editing tools

- Collapsible per-section layout with an independent save button per section.
- All writes require a **step-up 2FA challenge**.
- Requires `SYSTEM_CONFIG` permission.

## Common actions

1. Expand the section you need to adjust.
2. Edit only the values relevant to the current task.
3. Save and complete the step-up 2FA challenge.
4. Re-check related monitoring after major rule changes.

## Notes

- Small changes here can affect registration, billing, mail delivery, captcha behavior, and abuse controls.
- SMTP mistakes often surface in notification or password-recovery flows — send a test email after any change.
- The relay upstream proxy is disabled by default. Enable it here and enter a proxy URL, then enable “Use proxy” in each channel that should use it; other channels remain direct.
- Proxy URLs may contain credentials and should be treated as sensitive configuration. Other server-side outbound requests are not routed through this setting.
- IP-ban and decay changes should be coordinated with monitoring data.
- The captcha trust window (`trustWindowMinutes`) controls how long a verified session can skip repeated captcha checks.

## Related pages

- `ip-monitoring-dashboard`
- `notification-settings`
- `relay-settings`
