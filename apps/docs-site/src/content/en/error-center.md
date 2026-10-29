# Error center

The error center groups unexpected frontend and backend errors by fingerprint. Use it to find recent errors, inspect stacks and context, and track handling status. Status changes record progress; they do not fix an error or stop collection.

## Requirements

- Open **Error Center** on the core management site. Error-report read permission is required.
- Group details, occurrences, and status updates require separate access. Opening the list or seeing a status button does not establish permission for the next operation.
- Errors can contain business data. Browser reports redact some common sensitive fields and text patterns, and the server masks some sensitive context fields. Redaction cannot identify every sensitive value. Check messages, stacks, and context before sharing them.

## Find an error group

1. Select a **Source** and **Status** as needed. Changing or clearing either filter queries immediately and returns to the first page.
2. Enter a search term and press Enter. Search matches text in group messages, error types, routes, or fingerprints. It does not search occurrence stacks or context.
3. Review results from most recently seen to oldest, then open the target group with its view button.

Initially, all sources and statuses are included, with 20 groups per page. Times use the browser's local format. The page has no date-range filter or automatic refresh.

Clearing the search input alone does not run a query. Press Enter or click **Refresh**. The top **Refresh** uses the current form values to reload the current page; it does not reload occurrences in an open detail drawer. **Clear filters** clears the search, status, and source and returns to the first page.

A failed list request shows a failure message and clears the results. Zero rows in this state do not mean that no errors exist. Use the retry action to load again.

## Inspect details and occurrences

1. Open a group and confirm that its details loaded successfully.
2. Review its error type, source, status, route, fingerprint, and message.
3. Expand recent occurrences to inspect available stacks and context. Occurrences are ordered newest first, with times in the browser's local format.
4. If context or another source provides a request ID, search for related records in [System logs]({{DOCS_BASE_URL}}/en/system-logs).

One group can contain multiple similar errors. Grouping normalizes some numbers and identifiers in error text, so the same fingerprint does not guarantee identical messages or root causes. The group message keeps the first recorded summary; it may differ from the latest occurrence's original message.

Details show at most the **50 most recent occurrences** in the group, with no page control for older records. The cumulative count can exceed the number displayed. Request ID, user ID, HTTP status, and client version have no separate display fields. An occurrence may have no stack or context.

If the group-details request fails, the drawer may retain the list summary and will not proceed to load occurrences. A summary or empty occurrence area does not establish that details loaded. Close and reopen the drawer to retry. Use the same method after a separate occurrence-loading failure, and check the relevant read access.

## Update handling status

Click a target status button in the detail drawer. The change submits immediately, with no additional save or confirmation. On success the list reloads; if the group no longer matches the status filter, it disappears from that list.

| Status                        | Tracking purpose                                                             |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Open (`open`)                 | Initial state for a new error; select it again to continue handling a group. |
| Acknowledged (`acknowledged`) | The issue has been seen and is being investigated or scheduled for handling. |
| Resolved (`resolved`)         | The operator considers the issue resolved.                                   |
| Ignored (`ignored`)           | The group is not being followed up for now.                                  |

You can switch directly between these states; there is no required sequence. **A resolved or ignored group does not automatically return to Open when the error recurs.** Its last-seen time and count still update. To investigate recurrence, include all statuses and check the latest occurrence time.

Changing status does not delete records, disable reporting, retry failed requests, or roll back business operations. Reloading the list does not reload occurrences in the drawer. Close and reopen it for current details.

## Collection scope and retention

The center collects browser runtime errors, Vue component errors, unhandled promise rejections, and unexpected server exceptions connected to its reporters. It is not an inventory of every request or failed operation.

- The browser briefly deduplicates similar reports and sends them in delayed batches. Network loss, page exit, browser storage limits, queue capacity, report size limits, or server rate limits can delay or lose reports.
- Saving server errors can also fail. An absent record does not prove that an error did not occur.
- Occurrence counts represent saved reports, rather than actual failures, failed requests, or affected users. One fingerprint can also merge errors with different parameters.
- Text and context have length, depth, and item limits. Displayed content can be truncated or redacted and cannot reconstruct a complete request.

When lifecycle scheduling runs successfully, it deletes **entire groups whose last occurrence was more than 90 days ago, together with their occurrences**. Retention is not applied separately to each occurrence: a recurring group can retain older records. Open, Resolved, and other handling statuses do not change this rule. Cleanup requires the schedule to be enabled and run successfully, so deletion is not guaranteed immediately at expiry. The page provides no delete or restore action.

## IAM authorization

With IAM enforcement enabled, the following actions are independent. The resource is the selected group, `acs:platform:*:platform:error-group/<groupId>`.

| Task                   | Required action                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browse groups          | `quyan:system:error_report:ListErrorGroups`, evaluated for each group.                                                                            |
| Read a group summary   | `quyan:system:error_report:GetErrorGroup`.                                                                                                        |
| Read occurrences       | `quyan:system:error_report:ListErrorOccurrences`, authorized against the parent group.                                                            |
| Change handling status | `quyan:system:error_report:UpdateErrorGroupStatus` and `quyan:system:error_report:GetErrorGroup` on the same resource to read the updated result. |

List access does not grant details or occurrences. The page reads the group summary before loading occurrences, so investigation requires both read grants. Granting the update action does not automatically satisfy its read dependency; the action catalog lists it under `requiredActions`.

Operators also need error-report read eligibility from a platform global user group, and both read and update eligibility to change status. Account ownership, private account groups, added user permissions, or wildcard policies alone cannot replace that eligibility. Role sessions use role policies and do not inherit group Allow grants. These management operations do not accept OAuth access tokens.

Lists are filtered before pagination; totals include only authorized active groups. Occurrence totals include only active records in the parent group. Revoked access, expired or revoked role sessions, invalid groups, or data changing during a query can fail a request. Refresh and retry. New groups beyond the query's initial boundary appear in the next query.

Status updates also require replay protection. If authorization rechecks fail before commit, the status change is rolled back. Legacy and shadow modes retain their existing permission and response behavior.

## Troubleshooting

| Symptom                                                     | Action                                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A group is listed but details or occurrences cannot be read | Check summary and occurrence access separately, then close and reopen the drawer.                                  |
| Recurring errors are missing after a fix                    | Clear the status filter and refresh. A resolved group retains that status when it recurs.                          |
| The count increases but detail records stay unchanged       | Close and reopen details. The top Refresh updates only the list.                                                   |
| A status update reports an error                            | Reopen details to check the current state. Check update and summary-read grants; sign in again if needed.          |
| Older occurrences cannot be found                           | Details show only the latest 50. If the entire group was removed by retention cleanup, the page cannot restore it. |

Related: [System logs]({{DOCS_BASE_URL}}/en/system-logs), [Business operation logs]({{DOCS_BASE_URL}}/en/business-logs), and [Data lifecycle]({{DOCS_BASE_URL}}/en/data-lifecycle).
