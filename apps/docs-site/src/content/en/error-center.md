# Error center

The error center aggregates browser runtime errors, Vue component errors, unhandled promises, and unexpected server errors for investigation by fingerprint.

## Requirements

- The error-report read permission is required to open the page.
- Passwords, tokens, cookies, authorization headers, and secrets are redacted before storage.
- Error details are retained for 90 days and then removed automatically.

## IAM access to error groups and occurrences

With IAM enforcement enabled, each error group uses `acs:platform:*:platform:error-group/<groupId>`. `quyan:system:error_report:GetErrorGroup` reads the group summary; `quyan:system:error_report:ListErrorOccurrences` lists active occurrences belonging to that group, including stacks and bounded context. These are independent permissions: granting one does not grant the other. The occurrence list is authorized at the parent error group and its total includes only active occurrences in that group.

Operators must also have error-report reading eligibility from a platform global user group. Account ownership, private account groups, added user permissions, and wildcard policies cannot independently provide that eligibility. Role sessions use the role's policies and do not inherit group Allow grants.

The server authorizes before loading report details and rechecks access and the error group before returning them. Revoked permissions, an expired or revoked role session, or an invalidated or changed group causes the read to fail. Group browsing uses `quyan:system:error_report:ListErrorGroups` on each error group. Results are filtered before pagination; page totals include only authorized active groups. List access does not grant group details or occurrence access. If an authorized group or access changes during a query, retry to retrieve current results. Newly reported groups beyond the query's initial boundary appear in the next query. Anonymous client reporting stays rate limited. Status updates use `quyan:system:error_report:UpdateErrorGroupStatus` on the selected error group. Because the API returns the updated group summary, it also requires `quyan:system:error_report:GetErrorGroup` on that same resource. The catalog lists this read requirement in `requiredActions`; granting the update action does not automatically grant read access. Operators need both error-report read and update eligibility from a platform global user group. Replay protection remains required. Changes to authorization data or the selected group can reject an update; authorization failure before commit rolls back the status change. The existing permissions and response remain in effect in legacy and shadow modes.

## What You Can See

- Source, last-seen time, route, message, occurrence count, and affected users.
- Error status: `open`, `acknowledged`, `resolved`, or `ignored`.
- Stack traces, request IDs, browser version, and bounded context for each fingerprint.

## Investigation Flow

1. Filter by source, status, or a search term.
2. Open a group and inspect recent occurrences and request IDs.
3. Use the request ID in System Logs to follow the request chain.
4. Update the status after the issue is handled.

The client reporting endpoint is rate limited. Dropped reports never affect the original page action.
