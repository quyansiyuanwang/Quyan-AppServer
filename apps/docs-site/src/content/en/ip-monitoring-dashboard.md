# IP monitoring dashboard

Use this page to review IP risk data, blacklist state, and whitelist controls.

## Page purpose

- Query current IP status and risk level.
- Inspect error weight, decay behavior, and ban tier.
- Maintain blacklist and whitelist records.
- Reset or manually adjust IP error weights.

## What you will see

### Overview and query tools

- IP status query by address.
- **Ban status and tier**: IPs are scored by accumulated error weight and placed into one of three levels:
  - **Level 1** — temporary soft ban (short duration).
  - **Level 2** — medium-duration ban.
  - **Level 3** — long-duration hard ban.
- Current error weight, thresholds for each level, and time until the current ban expires.
- Error-decay estimate: shows whether the weight will naturally fall below a threshold over time.
- Error breakdown by type (weight per error category is configurable in server configuration).

### Blacklist management

- List of blacklisted IPs with reason, added-by, and expiry.
- Search, add, edit, and delete (unban) entries.
- All writes require **step-up 2FA**.

### Whitelist management

- List of whitelisted IPs exempt from ban logic.
- Add and remove entries.
- All writes require **step-up 2FA**.

## Error weights and decay

Error weights are the core of the IP ban system:

- Each type of error (e.g. failed login, invalid token, spam) carries a configurable weight.
- When an IP's accumulated weight crosses a threshold, it is placed into the corresponding ban level.
- **Error decay** gradually reduces the weight over time. The decay rate, minimum threshold, and interval are all configurable in **server configuration → IP ban section**.
- The decay estimate on the detail page shows when the IP is expected to drop below each threshold if no new errors occur.

To view or change the per-error-type weights, use `GET /ip-blacklist/error-status/{ip}` or the weight editor on this page. Weights can also be reset to zero (`DELETE /ip-blacklist/error-status/{ip}`).

## Common actions

1. Query a suspicious IP to see its current tier, weight, and active ban expiry.
2. Check the error breakdown to understand why the IP was flagged.
3. If the ban was triggered by a false positive, reset the error weight and remove the blacklist entry.
4. If the IP is genuinely malicious, manually create or edit a blacklist entry with an explicit reason.
5. Add IPs of known-trusted infrastructure to the whitelist to prevent them from being auto-banned.
6. After adjusting thresholds in server configuration, re-query affected IPs to confirm the new levels.

## Notes

- Whitelist entries bypass all automatic ban logic — use them only for infrastructure you control.
- Error-decay only reduces weight passively; it does not remove an active ban before its expiry.
- Three ban tiers give graduated responses: tier 1 for transient issues, tier 3 for persistent abuse.
- This page works best when combined with server-configuration (to tune thresholds and weights) and system-logs (to see what requests the IP was making).

## Related pages

- `server-configuration`
- `system-logs`
- `business-logs`
