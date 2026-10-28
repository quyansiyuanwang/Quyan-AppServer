# System logs

Use this page to inspect API logs, log statistics, and server log files.

## Page purpose

- Filter and review API request logs.
- Inspect request and response details, including headers.
- Browse server log files and search inside them.
- Review log statistics charts.
- Support troubleshooting for backend and infrastructure problems.

## What you will see

### Log statistics panel

- Request volume distribution by status code (2xx / 4xx / 5xx).
- Daily request trend chart.
- Error rate trend for spotting anomalous periods quickly.
- Requires `API_LOG_READ` or `SYSTEM_LOG_READ` permission.

### API logs tab

- Filters by method, path, status code, user, request ID, IP, and date range.
- Expandable log rows showing:
  - Request and response payloads.
  - **Request and response headers** (captured after logging module enhancement).
  - Request ID, IP, User-Agent, and other metadata.
- Pagination.

> **Note**: Request bodies for high-frequency paths such as `/relay/proxy` are not recorded by default to reduce storage load.

### Server logs tab

- Server log file list organized by type.
- File content viewer.
- Search within the file.
- Line-limit controls.

## Common actions

1. Check the statistics panel first to find the time window with elevated error rates.
2. Use filters to narrow down the target request or incident window.
3. Expand a log row to inspect payloads, request headers, and response headers.
4. Search server log files when the issue is deeper than a single API request.
5. Use the request ID (`x-request-id`) to correlate across tools and services.

## Notes

- Request and response payloads can contain sensitive operational data.
- Response-header logging helps debug CORS, cache, and rate-limit header issues.
- Log expansion is useful for trace analysis; file search works better for recurring patterns.
- This page is central for diagnosing relay, auth, billing, and monitoring issues.

## Related pages

- [Business logs]({{DOCS_BASE_URL}}/en/business-logs)
- [Upstream status]({{DOCS_BASE_URL}}/en/upstream-status)
- [IP monitoring dashboard]({{DOCS_BASE_URL}}/en/ip-monitoring-dashboard)

## Server log resource permissions

IAM `enforce` mode authorizes individual server log files:

```text
acs:platform:*:platform:server-log-file/combined-2026-10-14.log
acs:platform:*:platform:server-log-file/error-2026-10-14.log.gz
```

- `quyan:system:server_log:ListFiles` selects which file metadata appears in the list. Unauthorized files are omitted.
- `quyan:system:server_log:GetFileContent` controls reading, tail limits and searching within the selected file. Listing grants do not grant content access.
- Both operations require the current user to hold `SYSTEM_SERVER_LOG_READ` in an active global group. Account policies, user additions, private groups and role policies cannot replace this operational qualification. Role sessions do not inherit the global group's Allow.
- Use the complete filename in the ARN. Compressed and uncompressed files are separate resources. A matching explicit Deny takes precedence; absence of Allow denies access. Revoked grants, changed policies or lost operational qualification during a read prevent content from being returned.

`legacy` and `shadow` preserve the original permission checks and responses. `shadow` also records IAM evaluations before enforcement is enabled.

## Resource permissions for API log details

IAM `enforce` mode uses `quyan:system:log:GetLogDetail` on `acs:platform:*:platform:api-request-log/<logId>`. These logs are deployment diagnostics. The current user must hold either `API_LOG_READ` or `SYSTEM_LOG_READ` in an active global group; account policies and private groups cannot replace that qualification. Role sessions require their own log policy and do not inherit the group's Allow.

Request details, headers and payloads are read only after authorizing the specific log. Matching Deny takes precedence and cannot be bypassed using the other legacy permission alias. Changes to policies, bindings, role sessions or log state during a read prevent the hydrated result from being returned. Unauthorized or unresolved resources return a permission denial without disclosing whether the log exists.

`legacy` and `shadow` preserve the original either-permission check and response. `shadow` additionally records the new IAM decision. Log detail, list and statistics endpoints have separate permission rules; a detail grant does not authorize the entire collection.

## Resource permissions for API log lists

IAM `enforce` mode evaluates `quyan:system:log:ListLogs` against each `acs:platform:*:platform:api-request-log/<logId>`. Logs with matching Deny or no Allow are excluded before pagination and totals. Only the allowed page's full list fields are read. Existing username, keyword, method, status and date filters, size information and username display are retained. A list grant does not grant `GetLogDetail`.

Listing also requires either `API_LOG_READ` or `SYSTEM_LOG_READ` in a global group. Each request uses fixed filters and a time boundary; newer logs appear in the next request. Revoked grants, changed policies or log changes affecting the authorized total cause the request to be denied rather than returning stale results. `legacy` and `shadow` preserve original pagination and totals; the latter also records resource decisions.

## Resource permissions for API log statistics

IAM `enforce` mode uses the independent `quyan:system:log:GetLogStatistics` Action on each API log ARN. Only authorized records contribute to totals, unique users and IPs, daily series, status and method distributions, and top paths. List or detail permissions alone do not grant statistics access. If no matching records are authorized, the report contains zero requests.

The same active global-group qualification (`API_LOG_READ` or `SYSTEM_LOG_READ`) is required. Existing filters and date-range behavior are retained. Statistics use a fixed time boundary and verify contributing records and grants before returning; newer logs appear on the next request, and changes to existing contributions or authorization cause a permission denial. `legacy` and `shadow` preserve the original report, with IAM resource decisions additionally recorded in `shadow`.
