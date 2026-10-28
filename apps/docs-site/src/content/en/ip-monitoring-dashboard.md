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
- When the operator has 2FA enabled, writes may trigger a step-up challenge; a valid trusted window can satisfy the current security rules.

### Whitelist management

- List of whitelisted IPs exempt from ban logic.
- Add and remove entries.
- When the operator has 2FA enabled, writes may trigger a step-up challenge; a valid trusted window can satisfy the current security rules.

## Whitelist read permissions

With IAM enforcement, whitelist management reads require `IP_WHITELIST_READ` in an actual deployment-wide group. Listing uses `quyan:ip_whitelist:ListEntries`, and status checks use `quyan:ip_whitelist:GetStatus`. Both use `acs:platform:*:platform:ip-whitelist/<record-id>`. IPv4/IPv6 addresses locate an existing record; its resource ID always comes from the database, never from the address or a caller-supplied account.

Authorization is applied per record before pagination, and `total` counts only authorized records. Status checks read the current expiry; an existing expired record returns `false`. Missing, deleted, or unauthorized records cannot be safely resolved for authorization and return 403 in enforce mode. Results are withheld if grants, role sessions, or records become invalid during a read. Automatic anti-abuse checks retain their internal whitelist read flow.

## Whitelist write permissions

With IAM enforcement, creating entries requires deployment-wide `IP_WHITELIST_CREATE` eligibility and `quyan:ip_whitelist:CreateEntry` on `acs:platform:*:platform:ip-whitelist-control/default`. The transaction also authorizes the actual `acs:platform:*:platform:ip-whitelist/<record-id>` before committing. Removing an entry requires deployment-wide `IP_WHITELIST_DELETE` eligibility and `quyan:ip_whitelist:DeleteEntry` on that entry's actual ARN. Account ownership and account-created groups cannot grant deployment-wide eligibility. Two-factor verification and replay protection rules still apply.

IPv4 and IPv6 inputs must be valid addresses. An active duplicate returns 409. Re-adding a deleted address restores its original record ID, preserving resource-scoped Deny rules. Missing or unauthorized removal targets return 403 in enforce mode. Identity, group, record and policy checks run again inside the transaction; a failed check rolls back the entire change. Cached positive whitelist status is checked against the database, so expiry or deletion cannot leave an automatic ban exemption active.

## Error weights and decay

Error weights are the core of the IP ban system:

- Each type of error (e.g. failed login, invalid token, spam) carries a configurable weight.
- When an IP's accumulated weight crosses a threshold, it is placed into the corresponding ban level.
- **Error decay** gradually reduces the weight over time. The decay rate, minimum threshold, and interval are all configurable in **server configuration → IP ban section**.
- The decay estimate on the detail page shows when the IP is expected to drop below each threshold if no new errors occur.

Use the page to review an IP’s error status and adjust its accumulated weight. The API uses `GET /v1/ip-blacklist/error-status/{ip}` to query, `PUT /v1/ip-blacklist/error-status/{ip}` to set the accumulated weight, and `DELETE /v1/ip-blacklist/error-status/{ip}` to reset it. Setting and resetting have different effects, described below.

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

- [Server configuration]({{DOCS_BASE_URL}}/en/server-configuration)
- [System logs]({{DOCS_BASE_URL}}/en/system-logs)
- [Business logs]({{DOCS_BASE_URL}}/en/business-logs)

## IAM permissions for a specific IP

In IAM `enforce` mode, ban checks use `quyan:system:ip_blacklist:CheckIPAddress` and real-time error status uses the independent `quyan:system:ip_blacklist:GetIPAddressErrorStatus`. Both authorize `acs:platform:*:platform:ip-address/<address identifier>` and require the current user to hold `IP_BLACKLIST_READ` in an active global group. Private groups, user additions and account policies cannot replace this platform qualification.

IPv4 addresses are used directly, for example `acs:platform:*:platform:ip-address/192.0.2.1`. IPv6 uses lowercase compressed notation with colons replaced by underscores: `2001:db8::1` maps to `acs:platform:*:platform:ip-address/2001_db8__1`. IPv4-mapped IPv6 addresses normalize to IPv4; consistent with existing IP normalization, the IPv6 loopback address normalizes to `127.0.0.1`. Queries still use your original address to look up existing records and weights.

A matching explicit Deny takes precedence; without a matching Allow, the query is denied. The two grants are independent and do not grant list, dashboard or weight modification access. Unbanned or expired addresses return no ban details; real-time status retains the configured error decay behavior. If policies, qualification, role sessions or ban records change during a read, the result is denied. `legacy` and `shadow` retain previous query permissions, with IAM decisions also recorded in `shadow`.

## Resource permissions for blacklist lists

In IAM `enforce` mode, lists use the independent `quyan:system:ip_blacklist:ListBlacklists` Action and check each record's `acs:platform:*:platform:ip-address/<address identifier>`. You still need `IP_BLACKLIST_READ` in an active global group; ban-check or real-time error status grants cannot replace list access.

The total, `offset` and `limit` all reflect allowed records, with explicit Deny taking precedence. Without a matching Allow, the list is empty. Allowed expired ban records remain visible, and details are read only for the current page. Each query fixes its cutoff position; if authorization or records contributing to the total change during the read, the request is denied and must be retried. `legacy` and `shadow` retain previous list behavior, with IAM decisions also recorded in `shadow`.

## Retrieve blacklist details by record ID

`GET /v1/ip-blacklist/{id}` now returns real record details, including retained expired history. IAM `enforce` mode uses the independent `quyan:system:ip_blacklist:GetBlacklist` Action: the server resolves the actual IP from the record ID and authorizes that address's resource ARN. It also requires `IP_BLACKLIST_READ` in an active global group; list and ban-check grants cannot replace detail access.

Missing, deleted or unsafe records are denied in `enforce` mode without falling back to an all-resource grant. The record's address, revision and current authorization are rechecked before the response. `legacy` and `shadow` provide details under the previous effective permission and return 404 for a missing record; `shadow` also records IAM decisions.

## Weight modification permissions for a specific IP

In IAM `enforce` mode, setting weight uses the independent `quyan:system:ip_blacklist:SetIPAddressErrorWeight` Action; resetting uses `quyan:system:ip_blacklist:ResetIPAddressErrorWeight`. Both authorize the target IP's resource ARN and require `IP_BLACKLIST_UPDATE` in the current user's active global group. Read grants, private groups and user additions cannot replace this platform qualification. Set and reset grants do not substitute for each other.

Setting a positive integer replaces the weight and updates the decay start time. Setting `0` clears only weight and decay time, retaining the error breakdown and current-hour count. Reset clears all four values. Both operations retain two-factor verification and replay protection and do not automatically remove an existing ban.

Before modification, the server rechecks the current identity, group qualification, role session and policies. A failed check prevents the modification. Redis must confirm the write outcome. If the response says the modification was not confirmed, query the current status before deciding whether to retry: this response proves neither that the data changed nor that it remained unchanged. The server does not retry the modification automatically. `legacy` and `shadow` retain previous permissions and write behavior; `shadow` also records IAM diagnostics.

## Update permissions for a specific blacklist record

In IAM `enforce` mode, editing the ban reason or expiry uses the independent `quyan:system:ip_blacklist:UpdateBlacklist` Action and authorizes the target IP's resource ARN. The current user must also hold `IP_BLACKLIST_UPDATE` in an active global group. Weight set, reset and read grants cannot replace blacklist record update permission.

Updates apply to active records, including retained expired history, without changing the ban level, type or original operator. Missing and deleted records are denied in `enforce` mode even with a wildcard Allow; an update does not restore deleted records. `legacy` and `shadow` retain previous update behavior and return 404 for missing records. The server rechecks the record revision, identity, platform qualification and policies within a transaction, retaining two-factor verification and replay protection. A record or authorization change before modification denies the update; check the current state before submitting again.

## Resource permissions for manual bans and unbans

In IAM `enforce` mode, manual bans use `quyan:system:ip_blacklist:CreateBlacklist`; unbans use `quyan:system:ip_blacklist:DeleteBlacklist`. Each Action authorizes the target IP's ARN and requires the corresponding `IP_BLACKLIST_CREATE` or `IP_BLACKLIST_DELETE` qualification in the current user's active global group. Create, update, unban and weight permissions are independent.

Manual bans record the authenticated user as the operator. Permanent bans retain the system's existing long-term expiry representation. Banning a previously deleted IP reuses its record ID. An existing active record causes a conflict without overwriting its reason or level. Unbanning soft-deletes an active ban record and leaves error weight intact; resetting weight is a separate operation. Missing or deleted unban targets are denied in `enforce`; `legacy` and `shadow` retain previous behavior and return 404 when there is no active record.

Both operations retain two-factor verification, replay protection and business logs. Revocation or a record change before modification denies the write. Background automatic bans continue to use server-configured error thresholds independently of these manual operation permissions.

## IP resource scope for the monitoring dashboard

In IAM `enforce` mode, the dashboard uses the independent `quyan:system:ip_blacklist:GetMonitoringDashboard` Action and checks the IP resource ARN for each ban record and ban activity event. You must also hold `IP_BLACKLIST_READ` in an active global group. List, detail and status grants cannot replace dashboard authorization.

The dashboard excludes IPs without Allow or with a matching Deny before computing active-ban totals, level/type distributions and 24-hour/7-day activity totals. Recent bans show up to 20 records. The timeline and Top IP list sample up to 1000 authorized events from the last 7 days; Top IP shows up to 10 addresses. Activity totals count all authorized events and can therefore exceed the timeline sample. Each Top IP's current status is also based only on authorized active bans.

The active-ban summary preserves the existing expiry rules: expired records and records with a null expiry are excluded, while the long-term expiry used for manual permanent bans still qualifies. Each query fixes its time cutoff. If records, events or authorization affecting the result change during the read, the result is denied. An event whose IP cannot be safely identified also denies the request without falling back to all resources. `legacy` and `shadow` retain previous aggregate behavior, with IAM diagnostics also recorded in `shadow`.
