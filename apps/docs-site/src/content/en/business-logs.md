# Business logs

Use **Business Operation Logs** in the core management site to review collected business audit records: who performed an action, which user or resource it affected, and its recorded outcome. For API requests and server errors, also use [System logs]({{DOCS_BASE_URL}}/en/system-logs).

## Before you begin

You need `SYSTEM_BUSINESS_LOG_READ`. IAM enforcement also requires active deployment-managed global group eligibility, with separate grants for the list, statistics and filter catalog, as described below.

The page is read-only and provides no action to edit or delete logs, or undo business operations. It covers collected records you can access; it is not a complete operation history or a replacement for current business state.

## Find an operation

1. Open **Business Operation Logs** and narrow results by **Operation Type** or **Operation Category**. The selectors list supported operations, not just operations that already have records.
2. Enter a username or complete user ID in **Actor** or **Target**. Confirming or leaving a changed text field, or changing a selection, reloads results without a separate Search button.
3. Set **IP Address** and **Date Range** if needed. Filter changes return the list to page one and reload statistics.
4. Find the record, check its time, description, target and status, then expand its details.

Filters can be combined. Clearing a field removes that restriction. No date range is selected initially, allowing queries across historical records still in the log store.

### What filters match

| Filter                     | Matching behavior                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation type or category | Matches the selected catalog value                                                                                                                            |
| Actor                      | Active users whose current usernames contain the text, or whose complete user ID matches                                                                      |
| Target                     | Active target users whose current usernames contain the text, or whose complete user ID matches; does not search resource types, resource IDs or descriptions |
| IP address                 | Partial text match, with loopback and IPv4-mapped addresses normalized for the query                                                                          |
| Date range                 | Recorded timestamps between the selected instants, including boundaries, with a maximum span of 30 days                                                       |

Username matching expands to at most 100 active users per query. Broad names can omit results; prefer a complete user ID for a precise lookup. Disabled or deleted users may not be found through Actor or Target text filters. Clear that field and narrow by operation type, time or IP instead.

**The current status filter has a limitation: selecting Failed can also query successful records.** To investigate failures, clear the status filter and check the actual success/failure tags in the list. A filtered result with no failures does not establish that none occurred.

If the selected interval exceeds 30 days or ends before it starts, the page warns and restores the previous valid range. For longer investigations, query separate intervals or clear the date range to inspect retained history. Clearing a range does not recover archived or deleted records.

## Read record details

On desktop, use the expand icon at the start of a row. On mobile, expand **Changes** on a card. Details use data already returned with the list rather than loading a separate operation record.

| Field                         | How to interpret it                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Actor                         | A currently resolvable username. Missing usernames can display as System; that label alone does not prove an automatic system action |
| Target                        | A target user takes precedence; otherwise a resource type and ID can appear. The Target filter searches only users                   |
| Description and status        | Describe this recorded action. Success or failure does not guarantee the outcome of later external deliveries or related actions     |
| Changes and metadata          | Appear when recorded, with credentials masked. An empty area does not prove that nothing changed                                     |
| Error message                 | May contain a failure reason, but may not have been collected; compare related logs                                                  |
| Request ID, IP and user agent | Can correlate a request when available. The page has no dedicated request-ID search field                                            |

Usernames resolve from current active-user data rather than a historical username snapshot. Use user IDs when investigating renamed or deactivated accounts. Masking sensitive fields does not mean every description or error is suitable for public sharing.

## Review statistics and refresh results

Desktop shows summaries for total, successful and failed logs, distinct actors, targets and IPs, plus daily trends and operation, category and success/failure distributions. Mobile does not display statistics.

Statistics cover all records matching the current filters and authorized for statistics, rather than just the current page. Keep these limits in mind:

- **Unique Targets** counts distinct target user IDs; it excludes targets identified only by resource ID. **System Triggered Logs** counts records without an actor user ID.
- Trends group dates in UTC, while list timestamps use your browser's local time. Records near midnight can therefore appear on different dates.
- The list defaults to 10 rows per page. Desktop also offers 20, 50 or 100. Pagination and page-size changes update only the list.
- The top **Refresh** button reloads the current list page with the current form values. It does not reload statistics or the filter catalog, or move the date range forward.
- Reapply filters or reload the page to refresh statistics as well. The page does not poll automatically.

The list, statistics and catalog load separately and can have different permission scopes, so list totals and charts can differ. Previous data can remain after a load failure. Check error messages and confirm a successful load before drawing conclusions.

## Permissions and availability

Legacy and shadow modes retain effective `SYSTEM_BUSINESS_LOG_READ` checks. IAM enforcement requires membership in an active deployment-managed global group with `SYSTEM_BUSINESS_LOG_READ`. Account ownership, account policies, private groups and personal additions cannot replace that eligibility. Endpoints use a signed-in identity and do not accept OAuth access tokens.

| Operation                               | Action                                       | Resource                                                          |
| --------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| Get operation type and category catalog | `quyan:system:business_log:GetFilterOptions` | `acs:platform:*:platform:system/business-log-options`             |
| View list and its details               | `quyan:system:business_log:ListLogs`         | `acs:platform:*:platform:business-log/<log ID>`                   |
| View statistics                         | `quyan:system:business_log:GetLogStatistics` | The same log resource, authorized individually before aggregation |

These operations are authorized separately. Catalog access does not read logs or grant list or statistics access. Explicit Deny overrides Allow; records without a matching Allow do not enter the relevant list or statistics. Lists are filtered before totals and pagination. Statistics deduplication and distributions include only records authorized for that operation.

Each query fixes its data boundary; newer logs appear on a later query. Changes to eligibility, policies, role sessions or records contributing to the result during a read can cause refusal; query again. Shadow mode additionally evaluates IAM while retaining the previous response behavior.

## Troubleshooting

| Problem                                         | What to do                                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No results after entering a resource ID         | Clear Target, which matches users only; find resource operations by type and time                                                                                                           |
| Charts do not update after Refresh              | The top button updates only the list; reapply filters or reload the page                                                                                                                    |
| Selecting Failed still shows successful records | Clear the status filter and use actual record tags to assess current-version results                                                                                                        |
| Empty operation catalog but visible logs        | Check catalog permission and load errors; catalog and list access are separate                                                                                                              |
| Older operation cannot be found                 | Check filters, current user status and authorization, then inspect [Data archiving and cleanup]({{DOCS_BASE_URL}}/en/data-lifecycle). Missing logs do not prove an operation never occurred |

## Related pages

- [User management]({{DOCS_BASE_URL}}/en/user-management)
- [Balance management]({{DOCS_BASE_URL}}/en/balance-management)
- [System logs]({{DOCS_BASE_URL}}/en/system-logs)
- [Data archiving and cleanup]({{DOCS_BASE_URL}}/en/data-lifecycle)
