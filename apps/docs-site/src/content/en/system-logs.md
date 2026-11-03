# System logs

Use **System Logs** in the core management site to investigate API requests and server runtime problems. **Request Logs** contains collected API requests and statistics. **Server Logs** reads files in the current server's log directory. Access to the two tabs is separate.

For business audit events, see [Business logs]({{DOCS_BASE_URL}}/en/business-logs). For inference-content investigations, see [AI request logs]({{DOCS_BASE_URL}}/en/ai-request-logs).

## Before you begin

- Request logs require either `API_LOG_READ` or `SYSTEM_LOG_READ`.
- Server logs require `SYSTEM_SERVER_LOG_READ`.
- IAM enforcement additionally requires the corresponding deployment-managed global group eligibility, with separate resource grants for lists, details, statistics or files, as described below.

The page provides no action to edit or delete logs, or undo requests. It does not poll automatically. Refresh manually and check which filters and time range the results represent.

## Find an API request

1. Open **Request Logs** and select methods and status codes; both allow multiple selections.
2. Narrow by path, user, request ID or IP address. Confirming or leaving a changed text field reloads results, as does changing a selection.
3. Set a **Date Range** if needed. Queries include both endpoints and allow at most 30 days per interval.
4. Check the record's time, user, path, sizes and status, then expand its details.

| Filter                  | Matching behavior and limits                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method and status       | Any selected value within a field matches; separate fields combine. Statuses match exact codes, rather than automatically matching all 4xx or 5xx codes |
| Path, request ID and IP | Partial text matching. Request IDs can correlate the same request across logs                                                                           |
| User                    | Partial current username or complete user ID, for active users. Each query expands to at most 100 users; prefer a complete ID for precision             |
| Date range              | Defaults to the last 30 days when unset. Explicit intervals can query older retained records, with at most 30 days per interval                         |

**Clear Filters** resets the form and queries the last 30 days; it does not load all history. The server rejects reversed or overly broad intervals. Adjust the range and query again.

Filter changes return to page one and update both the list and statistics. The list defaults to 20 rows per page; desktop offers 10, 20, 50 or 100. Pagination and page-size changes update only the list. The top **Refresh** button updates the current list page and statistics using current conditions. An explicitly selected date range does not move forward automatically.

### Read request details

On desktop, expand a row using its leading icon. On mobile, expand **Response** on a card. Query and body parameters arrive with the list. Responses, request headers, response headers and some size information load separately on expansion and require detail access to that log.

Request size can come from `Content-Length` or an estimate of the saved body; it is not guaranteed to equal original network traffic. Responses, headers and bodies can be absent, masked, simplified or truncated. Blank areas, `null` and placeholders do not establish that the original request had no content. Saved masked content is not an original byte sequence suitable for replay.

Usernames resolve from current active-user data, not a historical snapshot. A missing username does not mean an anonymous request; also check the user ID. HTTP status describes the HTTP result, which does not necessarily establish business success. Investigate AI stream interruptions and quota settlement using the dedicated AI request records as well.

If detail loading fails, collapsing and reopening does not retry. Select the top **Refresh** button, then expand the record again. If it remains empty, check detail authorization and capture scope.

## Understand statistics

Summaries and charts cover all API logs matching current filters and authorized for statistics, rather than only the current page. Statistics are also available on mobile.

- **Successful Requests** counts HTTP 2xx, **Redirect Requests** counts 3xx, **Client Errors** counts 4xx and **Server Errors** counts 5xx.
- **Daily Request Trend** shows total, 4xx and 5xx counts, not an error rate.
- Date grouping uses the server's local timezone, while list timestamps use your browser's timezone. Compare actual timestamps across timezones.
- **Path Distribution Top 12** groups normalized paths. Some numeric or long identifier segments become `:id`; counts do not represent each original URL separately.
- List, detail and statistics access are independent, so counts can differ. After statistics fail, initial zeros or old charts are not a successful query result.

### Requests that may be missing

General API logs do not guarantee complete traffic coverage. Successful high-frequency requests, such as AI relay requests, token refreshes and some heartbeats, can be omitted. Some paths are excluded regardless of outcome. Failed relay requests can be logged and may retain masked or truncated bodies.

Writes have a short delay, and write failures or buffer pressure can lose records. If a request is missing, check time, authorization, capture scope and dedicated logs before concluding it did not happen. This page queries the current log store; check archived records in [Data archiving and cleanup]({{DOCS_BASE_URL}}/en/data-lifecycle).

## Read server log files

1. Open **Server Logs** and select Combined Log or Error Log. Files sort by modification time, newest first. The page automatically loads the selected file, or the first available file.
2. Select the relevant file. Compressed `.log.gz` files can be read directly in the page without downloading and extracting them.
3. Set **Latest Lines** from 1 to 2000; the default is 200. Changing the limit reloads the selected file.
4. Enter a keyword and select **Load Content** or press Enter. After clearing the keyword, reload to return to the file's tail.
5. Check the content panel's filename, modification time, applied search term, total lines, matched lines and returned lines.

Search checks individual lines in the selected file without case sensitivity. It matches literal text and supports neither regular expressions nor cross-file searches. Without a keyword, the last lines appear. With a keyword, the last matching lines appear in their original file order. A truncation notice means more matching lines were omitted, not that the file was modified or deleted.

**Refresh Files** and the top **Refresh** button on this tab reload the file list and selected content. If the selected file disappears, the first file can be selected instead. An empty list can mean no files of that type or no authorized files. The page has no action to download complete files, continuously follow new lines or delete files.

File content displays saved text. Do not assume it receives the same additional masking as API details. Check user and operational information before sharing snippets.

## Permissions and availability

In IAM enforcement mode, these endpoints use signed-in identities and do not accept OAuth access tokens. API logs require either `API_LOG_READ` or `SYSTEM_LOG_READ` in an active deployment-managed global group. Server logs require that group's `SYSTEM_SERVER_LOG_READ`. Account policies, personal additions, private groups and role policies cannot replace deployment eligibility.

| Operation                      | Action                                   | Resource                                                       |
| ------------------------------ | ---------------------------------------- | -------------------------------------------------------------- |
| API log list                   | `quyan:system:log:ListLogs`              | `acs:platform:*:platform:api-request-log/<log ID>`             |
| API log detail                 | `quyan:system:log:GetLogDetail`          | The same resource for the selected log                         |
| API log statistics             | `quyan:system:log:GetLogStatistics`      | The same resources, authorized individually before aggregation |
| Server file list               | `quyan:system:server_log:ListFiles`      | `acs:platform:*:platform:server-log-file/<complete filename>`  |
| Server file content and search | `quyan:system:server_log:GetFileContent` | The same resource for the selected file                        |

Each operation requires its own grant. Listing does not grant details or statistics, and listing files does not grant content access. A log ID identifies the record, not the request ID. Compressed and uncompressed files are separate resources; for example, `combined-2026-10-14.log` and `combined-2026-10-14.log.gz` need separate grants.

Explicit Deny overrides Allow and cannot be bypassed through the other legacy permission alias. Role sessions use their own valid policies and do not inherit the caller's global-group Allow; the executing identity must still meet deployment eligibility.

API lists are filtered before totals and pagination. Statistics counts, deduplication and distributions cover only records authorized for statistics. File lists return only authorized files. Missing records do not prove that the deployment has no corresponding logs.

Queries use a fixed data boundary; newer logs appear on later queries. Changes to eligibility, policies, bindings, role sessions or contributing records during a read can prevent the response; query again. API details that cannot be read safely may also return an authorization denial. Legacy and shadow modes retain previous checks and responses, with additional IAM evaluation in shadow mode.

## Troubleshooting

| Problem                                                       | What to check                                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A request older than one month is missing after Clear Filters | Select an explicit earlier interval of at most 30 days, and check archiving                                      |
| API record is visible but response or headers are empty       | Refresh the list, reopen details, and check detail access, capture, masking and truncation                       |
| File content does not match the selected file or keyword      | A failed load can leave old content. Check the content panel's filename and applied search term, then load again |
| Only some matching file lines appear                          | Increase the limit and check truncation; at most the last 2000 matching lines are returned                       |
| Chart totals differ from the list                             | Check each operation's grants, filters and load results; they are separate queries                               |

API lists, statistics, file lists and content can all retain old results after failure. The current form may not describe the data still displayed. Confirm a successful load before drawing conclusions.

## Related pages

- [Business logs]({{DOCS_BASE_URL}}/en/business-logs)
- [AI request logs]({{DOCS_BASE_URL}}/en/ai-request-logs)
- [Upstream status]({{DOCS_BASE_URL}}/en/upstream-status)
- [IP monitoring dashboard]({{DOCS_BASE_URL}}/en/ip-monitoring-dashboard)
- [Data archiving and cleanup]({{DOCS_BASE_URL}}/en/data-lifecycle)
