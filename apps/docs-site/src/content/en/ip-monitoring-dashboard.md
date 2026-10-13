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

## Whitelist read permissions

With IAM enforcement, whitelist management reads require `IP_WHITELIST_READ` in an actual deployment-wide group. Listing uses `quyan:ip_whitelist:ListEntries`, and status checks use `quyan:ip_whitelist:GetStatus`. Both use `acs:platform:*:platform:ip-whitelist/<record-id>`. IPv4/IPv6 addresses locate an existing record; its resource ID always comes from the database, never from the address or a caller-supplied account.

Authorization is applied per record before pagination, and `total` counts only authorized records. Status checks read the current expiry; an existing expired record returns `false`. Missing, deleted, or unauthorized records cannot be safely resolved for authorization and return 403 in enforce mode. Results are withheld if grants, role sessions, or records become invalid during a read. Automatic anti-abuse checks retain their internal whitelist read flow.

## Whitelist write permissions

With IAM enforcement, creating entries requires deployment-wide `IP_WHITELIST_CREATE` eligibility and `quyan:ip_whitelist:CreateEntry` on `acs:platform:*:platform:ip-whitelist-control/default`. The transaction also authorizes the actual `acs:platform:*:platform:ip-whitelist/<record-id>` before committing. Removing an entry requires deployment-wide `IP_WHITELIST_DELETE` eligibility and `quyan:ip_whitelist:DeleteEntry` on that entry's actual ARN. Account ownership and account-created groups cannot grant deployment-wide eligibility. Step-up 2FA and replay protection remain required.

IPv4 and IPv6 inputs must be valid addresses. An active duplicate returns 409. Re-adding a deleted address restores its original record ID, preserving resource-scoped Deny rules. Missing or unauthorized removal targets return 403 in enforce mode. Identity, group, record and policy checks run again inside the transaction; a failed check rolls back the entire change. Cached positive whitelist status is checked against the database, so expiry or deletion cannot leave an automatic ban exemption active.

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

## IAM permissions for a specific IP

In IAM `enforce` mode, ban checks use `quyan:system:ip_blacklist:CheckIPAddress` and real-time error status uses the independent `quyan:system:ip_blacklist:GetIPAddressErrorStatus`. Both authorize `acs:platform:*:platform:ip-address/<address identifier>` and require the current user to hold `IP_BLACKLIST_READ` in an active global group. Private groups, user additions and account policies cannot replace this platform qualification.

IPv4 addresses are used directly, for example `acs:platform:*:platform:ip-address/192.0.2.1`. IPv6 uses lowercase compressed notation with colons replaced by underscores: `2001:db8::1` maps to `acs:platform:*:platform:ip-address/2001_db8__1`. IPv4-mapped IPv6 addresses normalize to IPv4; consistent with existing IP normalization, the IPv6 loopback address normalizes to `127.0.0.1`. Queries still use your original address to look up existing records and weights.

A matching explicit Deny takes precedence; without a matching Allow, the query is denied. The two grants are independent and do not grant list, dashboard or weight modification access. Unbanned or expired addresses return no ban details; real-time status retains the configured error decay behavior. If policies, qualification, role sessions or ban records change during a read, the result is denied. `legacy` and `shadow` retain previous query permissions, with IAM decisions also recorded in `shadow`.
