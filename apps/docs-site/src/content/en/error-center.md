# Error center

The error center aggregates browser runtime errors, Vue component errors, unhandled promises, and unexpected server errors for investigation by fingerprint.

## Requirements

- The error-report read permission is required to open the page.
- Browser reports redact some common sensitive fields and text patterns, and the server also masks some sensitive context fields. Redaction cannot identify every sensitive value; avoid putting passwords, tokens, or personal information in error messages.
- Scheduled lifecycle cleanup deletes error groups whose last occurrence was more than 90 days ago, together with their occurrences. Cleanup depends on the schedule being enabled and running successfully; a group that keeps recurring can retain older occurrences for longer than 90 days.

## What You Can See

- Source, last-seen time, route, message, occurrence count, and affected users.
- Error status: `open`, `acknowledged`, `resolved`, or `ignored`.
- Stack traces, request IDs, browser version, and bounded context for each fingerprint.

## Investigation Flow

1. Filter by source, status, or a search term.
2. Open a group and inspect recent occurrences and request IDs.
3. If a request ID is available, use it to find related records in [System logs]({{DOCS_BASE_URL}}/en/system-logs).
4. After handling the issue, update its status if you have update permission.

The detail view shows at most the 50 most recent occurrences in the group; it does not provide a way to page through older occurrences.

The client reporting endpoint is rate limited. Dropped reports never affect the original page action.

## IAM access to error groups and occurrences

With IAM enforcement enabled, each error group uses `acs:platform:*:platform:error-group/<groupId>`. `quyan:system:error_report:GetErrorGroup` reads the group summary; `quyan:system:error_report:ListErrorOccurrences` lists active occurrences belonging to that group, including stacks and bounded context. These are independent permissions: granting one does not grant the other. The occurrence list is authorized at the parent error group and its total includes only active occurrences in that group.

Operators must also have error-report reading eligibility from a platform global user group. Account ownership, private account groups, added user permissions, and wildcard policies cannot independently provide that eligibility. Role sessions use the role's policies and do not inherit group Allow grants.

The server authorizes before loading report details and rechecks access and the error group before returning them. Revoked permissions, an expired or revoked role session, or an invalidated or changed group causes the read to fail. Group browsing uses `quyan:system:error_report:ListErrorGroups` on each error group. Results are filtered before pagination; page totals include only authorized active groups. List access does not grant group details or occurrence access. If an authorized group or access changes during a query, retry to retrieve current results. Newly reported groups beyond the query's initial boundary appear in the next query. Anonymous client reporting stays rate limited. Status updates use `quyan:system:error_report:UpdateErrorGroupStatus` on the selected error group. Because the API returns the updated group summary, it also requires `quyan:system:error_report:GetErrorGroup` on that same resource. The catalog lists this read requirement in `requiredActions`; granting the update action does not automatically grant read access. Operators need both error-report read and update eligibility from a platform global user group. Replay protection remains required. Changes to authorization data or the selected group can reject an update; authorization failure before commit rolls back the status change. The existing permissions and response remain in effect in legacy and shadow modes.
