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
- Requires `SYSTEM_LOGS_READ` or `SYSTEM_LOGS_STATS_READ` permission.

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

- `business-logs`
- `upstream-status`
- `ip-monitoring-dashboard`
