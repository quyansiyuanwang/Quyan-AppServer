# IP monitoring dashboard

Use the IP monitoring dashboard to inspect an IP's error weight and ban status, resolve false positives, and maintain blacklist and whitelist entries.

## Prerequisites

Open **System → IP monitoring** in the console. Page access requires `ip_blacklist:read`; individual operations need the following permissions.

| Operation                                       | Required permission   |
| ----------------------------------------------- | --------------------- |
| Read monitoring data, blacklists, and IP status | `ip_blacklist:read`   |
| Adjust or reset weight, edit blacklists         | `ip_blacklist:update` |
| Manually ban an IP                              | `ip_blacklist:create` |
| Unban an IP                                     | `ip_blacklist:delete` |
| Read whitelists                                 | `ip_whitelist:read`   |
| Add whitelist entries                           | `ip_whitelist:create` |
| Remove whitelist entries                        | `ip_whitelist:delete` |

IAM enforcement also checks actual deployment-wide group eligibility, the operation Action, and the target resource, as described later in this guide. Opening the page does not grant access to every tab or IP. Writes may require a two-factor challenge when the operator has 2FA enabled; trusted windows and replay protection follow the current security rules.

## Query a specific IP

1. Enter an IP on the monitoring tab and click **Query** or press Enter. The page may prefill the client IP identified by the server, but does not query it automatically.
2. Review **ban status**, **error weight**, **current level**, and the three level thresholds.
3. Review the error breakdown alongside business logs. To confirm expiry, find the corresponding entry on the blacklist tab.
4. After changing weights or blacklist/whitelist entries, query the IP again to confirm its current state.

**The current level uses the error weight at query time; ban status uses existing blacklist records. These can differ.** An existing ban can remain effective after weight decays into the normal range. Manual bans can also have no automatic ban level. An effective whitelist does not delete blacklist records: the query may still report “banned” while requests receive the whitelist exemption.

Breakdown values are accumulated weight contributions for each error category; percentages use those contributions, rather than request counts or maliciousness probabilities. The breakdown does not decay with the total weight, and manually setting weight does not rewrite it. Its sum can therefore differ from the current weight.

### Understand decay and trend estimates

When weight reaches a threshold, an automatic ban check can create or upgrade a ban. Checks also consider the current-hour error count, taking the greater of that count and the decayed accumulated weight. Automatic ban enablement, thresholds, and durations use the current settings under **Server configuration → IP ban**. Level 3 does not always mean a permanent ban.

With decay enabled, accumulated weight decreases at the configured interval and rate, and clears below the minimum threshold. Queries calculate elapsed decay; the page is not a live countdown.

- **Decay estimate** assumes no new errors and estimates time to a threshold or zero. It does not promise an unban time. Decay neither lowers an existing ban record's level nor removes a ban early.
- **Trend estimate** projects the next level from the last two successful manual queries for the same IP. It appears only when queries are at least about 3 seconds apart and weight increases. It does not continuously monitor traffic or guarantee that growth continues at that rate.

Changing thresholds or disabling automatic bans does not delete existing bans. Query weight again and separately check the blacklist record and expiry.

## Choose between weight changes and unbanning

| Operation                        | Effect                                                                                              | Removes an existing ban? |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------ |
| Set a positive integer weight    | Replaces accumulated weight and restarts decay timing; retains the breakdown and current-hour count | No                       |
| Set weight to `0`                | Clears accumulated weight and decay timing; retains the breakdown and current-hour count            | No                       |
| Reset weight                     | Clears accumulated weight, decay timing, breakdown, and current-hour count                          | No                       |
| Unban from the blacklist         | Removes that blacklist entry; retains error weight                                                  | Yes                      |
| Add an effective whitelist entry | Exempts the IP from blacklist enforcement; retains the ban record and weight                        | No                       |

For a false positive, verify the source and error breakdown, **reset weight** if appropriate, then **unban** it on the blacklist tab. Unbanning while retaining high weight can allow another automatic ban later; new errors can also accumulate fresh weight.

After a successful query, click **Adjust weight**, enter a nonnegative integer, and confirm, or click **Reset weight**. The UI caps the input at twice the current level-3 threshold. The API independently accepts only integers from `0` to `1000000`; values outside that range are rejected even if the UI allows them.

Setting and resetting use `PUT /v1/ip-blacklist/error-status/{ip}` and `DELETE /v1/ip-blacklist/error-status/{ip}`; querying uses `GET /v1/ip-blacklist/error-status/{ip}`. The page queries again after a change. A successful-change notice followed by a query failure does not mean the change rolled back; query again to confirm.

## Maintain blacklists

1. Open the blacklist tab to review IP, ban type, level, reason, and expiry. Retained expired entries also appear; an entry does not necessarily mean requests are still blocked.
2. For a manual ban, click **Ban IP**, enter the address and reason, choose 1 hour, 24 hours, 7 days, or permanent, and confirm. The default is 1 hour; reasons support up to 500 characters. The current add dialog accepts only IPv4-shaped addresses, not IPv6.
3. To change an entry, click **Edit** and adjust its reason or expiry. This does not change its IP, ban type, level, or original operator. Clearing the expiry field does not make the entry permanent.
4. To remove a ban, click **Unban** on that row, verify the IP, and confirm. This removes only the blacklist entry, leaving error weight intact.

“Permanent” uses the system's long-term expiry representation, currently `2099-12-31`, rather than an absent expiry field. Creating an entry for an IP with an undeleted record conflicts even if the record has expired. Edit the existing entry, or remove and recreate it after checking the impact.

### Search and pagination limits

Blacklist search filters IP substrings only within **currently loaded records**, rather than the whole database. Repeated searches further narrow the current result, and local filtering does not change the pagination total. No search match does not prove an IP is unbanned; use the specific-IP query on the monitoring tab to confirm.

Clearing search reloads the current page. Refreshing or changing pages retrieves that page without applying the text still in the search box. The default page size is 20; options are 10, 20, 50, and 100. Changing page size returns to page 1.

## Maintain whitelists

**An effective whitelist entry skips IP blacklist enforcement, including manual bans.** It does not grant login identity, API permissions, or other business access, and does not bypass every rate limit or security rule. Add only verified, trusted source IPs that need this exemption.

1. Open the whitelist tab, click the add button, and enter the IP and purpose.
2. Optionally set an expiry; leaving it empty means no expiry. The current add dialog accepts only IPv4-shaped addresses. The whitelist API supports valid IPv4 and IPv6 addresses; API support does not imply UI support.
3. Submit and verify the address and expiry in the list. Expired records may remain listed but no longer provide an exemption.
4. When the exemption is no longer needed, remove the entry and confirm. If an existing blacklist record remains effective, removing the whitelist can resume blocking. Check the blacklist first.

The page has no whitelist edit operation. To change a reason or expiry, check the impact, then remove and re-add the entry; the exemption is temporarily absent between these steps. With IAM enforcement, adding an undeleted entry, including an expired one, returns 409. Restoring a deleted address retains its original record ID.

The default whitelist page size is 20; options are 10, 20, 50, and 100. Changing page size returns to page 1.

## Refresh and statistics scope

The monitoring overview refreshes every 30 seconds and supports manual refresh. **Overview refresh does not update the specific-IP query, blacklist, or whitelist.** Query the IP again or refresh each list separately. Failed overview or list requests can leave previous data visible: check the error notice before treating it as current. A failed specific-IP query clears its result.

The overview displays active-ban totals, counts for the three levels, and frequently banned IPs. Manual bans can have no automatic level, so level counts need not sum to the total. Top IPs uses at most 1000 ban activity events from the last 7 days and shows up to 10 addresses; it is not a complete historical ranking.

The monitoring API also returns recent bans, 24-hour and 7-day activity totals, and a timeline; the current page does not necessarily display every field. Recent bans include up to 20 entries. The timeline shares the 1000-event sampling limit; activity totals can exceed the sample count. With IAM enforcement, all results reflect only IPs you are authorized to view, as described below.

## Whitelist read permissions

With IAM enforcement, whitelist management reads require `IP_WHITELIST_READ` in an actual deployment-wide group. Listing uses `quyan:ip_whitelist:ListEntries`, and status checks use `quyan:ip_whitelist:GetStatus`. Both use `acs:platform:*:platform:ip-whitelist/<record-id>`. IPv4/IPv6 addresses locate an existing record; its resource ID always comes from the database, never from the address or a caller-supplied account.

Authorization is applied per record before pagination, and `total` counts only authorized records. Status checks read the current expiry; an existing expired record returns `false`. Missing, deleted, or unauthorized records cannot be safely resolved for authorization and return 403 in enforce mode. Results are withheld if grants, role sessions, or records become invalid during a read. Automatic anti-abuse checks retain their internal whitelist read flow.

## Whitelist write permissions

With IAM enforcement, creating entries requires deployment-wide `IP_WHITELIST_CREATE` eligibility and `quyan:ip_whitelist:CreateEntry` on `acs:platform:*:platform:ip-whitelist-control/default`. The transaction also authorizes the actual `acs:platform:*:platform:ip-whitelist/<record-id>` before committing. Removing an entry requires deployment-wide `IP_WHITELIST_DELETE` eligibility and `quyan:ip_whitelist:DeleteEntry` on that entry's actual ARN. Account ownership and account-created groups cannot grant deployment-wide eligibility. Two-factor verification and replay protection rules still apply.

Whitelist API inputs must be valid IPv4 or IPv6 addresses. An undeleted duplicate, including an expired entry, returns 409. Re-adding a deleted address restores its original record ID, preserving resource-scoped Deny rules. Missing or unauthorized removal targets return 403 in enforce mode. Identity, group, record and policy checks run again inside the transaction; a failed check rolls back the entire change. Cached positive whitelist status is checked against the database, so expiry or deletion cannot leave an automatic ban exemption active.

## IAM permissions for a specific IP

In IAM `enforce` mode, ban checks use `quyan:system:ip_blacklist:CheckIPAddress` and real-time error status uses the independent `quyan:system:ip_blacklist:GetIPAddressErrorStatus`. Both authorize `acs:platform:*:platform:ip-address/<address identifier>` and require the current user to hold `IP_BLACKLIST_READ` in an active global group. Private groups, user additions and account policies cannot replace this platform qualification.

IPv4 addresses are used directly, for example `acs:platform:*:platform:ip-address/192.0.2.1`. IPv6 uses lowercase compressed notation with colons replaced by underscores: `2001:db8::1` maps to `acs:platform:*:platform:ip-address/2001_db8__1`. IPv4-mapped IPv6 addresses normalize to IPv4; consistent with existing IP normalization, the IPv6 loopback address normalizes to `127.0.0.1`. Queries still use your original address to look up existing records and weights.

A matching explicit Deny takes precedence; without a matching Allow, the query is denied. The two grants are independent and do not grant list, dashboard or weight modification access. Unbanned or expired addresses return no ban details; real-time status retains the configured error decay behavior. If policies, qualification, role sessions or ban records change during a read, the result is denied. `legacy` and `shadow` retain previous query permissions, with IAM decisions also recorded in `shadow`.

## Resource permissions for blacklist lists

In IAM `enforce` mode, lists use the independent `quyan:system:ip_blacklist:ListBlacklists` Action and check each record's `acs:platform:*:platform:ip-address/<address identifier>`. You still need `IP_BLACKLIST_READ` in an active global group; ban-check or real-time error status grants cannot replace list access.

The total, `offset` and `limit` all reflect allowed records, with explicit Deny taking precedence. Without a matching Allow, the list is empty. Allowed expired ban records remain visible, and details are read only for the current page. Each query fixes its cutoff position; if authorization or records contributing to the total change during the read, the request is denied and must be retried. `legacy` and `shadow` retain previous list behavior, with IAM decisions also recorded in `shadow`.

## Retrieve blacklist details by record ID

`GET /v1/ip-blacklist/{id}` returns record details, including retained expired history. IAM `enforce` mode uses the independent `quyan:system:ip_blacklist:GetBlacklist` Action: the server resolves the actual IP from the record ID and authorizes that address's resource ARN. It also requires `IP_BLACKLIST_READ` in an active global group; list and ban-check grants cannot replace detail access.

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

Manual bans record the authenticated user as the operator. Permanent bans retain the system's existing long-term expiry representation. Banning a previously deleted IP reuses its record ID. An existing undeleted record, including an expired entry, causes a conflict without overwriting its reason or level. Unbanning removes an undeleted ban record, including an expired entry, and leaves error weight intact; resetting weight is a separate operation. Missing or deleted unban targets are denied in `enforce`; `legacy` and `shadow` retain previous behavior and return 404 when there is no active record.

Both operations retain two-factor verification, replay protection and business logs. Revocation or a record change before modification denies the write. Background automatic bans continue to use server-configured error thresholds independently of these manual operation permissions.

## IP resource scope for the monitoring dashboard

In IAM `enforce` mode, the dashboard uses the independent `quyan:system:ip_blacklist:GetMonitoringDashboard` Action and checks the IP resource ARN for each ban record and ban activity event. You must also hold `IP_BLACKLIST_READ` in an active global group. List, detail and status grants cannot replace dashboard authorization.

The dashboard excludes IPs without Allow or with a matching Deny before computing active-ban totals, level/type distributions and 24-hour/7-day activity totals. Recent bans show up to 20 records. The timeline and Top IP list sample up to 1000 authorized events from the last 7 days; Top IP shows up to 10 addresses. Activity totals count all authorized events and can therefore exceed the timeline sample. Each Top IP's current status is also based only on authorized active bans.

The active-ban summary preserves the existing expiry rules: expired records and records with a null expiry are excluded, while the long-term expiry used for manual permanent bans still qualifies. Each query fixes its time cutoff. If records, events or authorization affecting the result change during the read, the result is denied. An event whose IP cannot be safely identified also denies the request without falling back to all resources. `legacy` and `shadow` retain previous aggregate behavior, with IAM diagnostics also recorded in `shadow`.

## Related pages

- [Server configuration]({{DOCS_BASE_URL}}/en/server-configuration)
- [System logs]({{DOCS_BASE_URL}}/en/system-logs)
- [Business logs]({{DOCS_BASE_URL}}/en/business-logs)
