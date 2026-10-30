# AI request logs

Use AI request logs to investigate relay inference identities, execution outcomes, and saved content. For failed calls, interrupted streams, or content issues, find the request by ID and time, then inspect its bodies and upstream attempts.

## Requirements

- Sign in with `relay:ai_request_log:read`. With IAM enforcement, you also need reading eligibility from a platform global user group and actions on the relevant logs, as described below.
- Viewing upstream attempts or searching attempt errors also requires `relay:request_diagnostics:read`. IAM enforcement adds a separate diagnostic action.
- This page does not accept OAuth access tokens. Logs can contain prompts, tool arguments, model output, and business data. Grant access according to investigation needs and protect any copied content.

## Find a request

1. Open **AI request logs** and set the time range. The default is the 24 hours before the page opened. Shortcuts offer the last hour, 24 hours, 7 days, or 30 days; a custom range is also available.
2. Enter a request ID, user, token, or content keyword. Expand advanced filters to narrow the search.
3. Select **Search**, or press Enter within the search form, to query from the first page.
4. Open a matching record to inspect its request, response, and upstream attempts separately. The list defaults to 20 records per page, with 50 and 100 also available.

Filters combine: a record must satisfy every supplied condition. The main matching rules are:

| Filter                                                                       | Matching and limits                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main search                                                                  | Searches request IDs, user/token names or IDs, models, error summaries, and saved bodies. Searching upstream attempt errors is restricted by diagnostic permissions |
| User, token, model, request ID, IP                                           | Substring matching; user and token filters each match either name or ID                                                                                             |
| Format, HTTP status, outcome, streaming, failure stage, body omission reason | Matches the selected value; HTTP status must be an integer from 100 through 599                                                                                     |
| Truncation                                                                   | Truncated means at least one body was truncated. Not truncated means neither body has a truncation flag; it does not guarantee that bodies were saved               |
| Duration                                                                     | Nonnegative integer milliseconds; the minimum must not exceed the maximum                                                                                           |
| Time                                                                         | The start must not be later than the end. Clearing the range removes the time restriction                                                                           |

Editing or clearing a filter alone does not query. **Search** returns to page one. **Refresh** and pagination use the current form values; refresh retains the current page. Changing page size returns to page one. **Reset** clears other filters, sets a new last-24-hours range, and queries immediately.

Time ranges are fixed when the page opens or a shortcut is selected. There is no automatic polling, and **Refresh** does not advance the end time. Select the shortcut again and search to find the latest requests.

User and token identities come from server-side recognition, not user claims in request bodies. Unnamed tokens show their ID. Historical fields that were not captured remain **Not recorded** and are not backfilled.

## Interpret the outcome

Read HTTP status together with execution outcome. An HTTP 200 response can still have an interrupted stream or a settlement failure after the response ends.

| Outcome      | Interpretation                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Processing   | Execution has not produced a final outcome; query again later                                                                               |
| Success      | The current record reports no execution failure; this does not guarantee that the response meets business expectations                      |
| Failed       | Inspect the error summary and failure stage to distinguish authentication, request, routing, upstream, content safety, or settlement issues |
| Interrupted  | The connection or execution was interrupted; investigate the client state and saved response                                                |
| Not recorded | Older records lack this information; do not infer the business outcome solely from HTTP status                                              |

A failed upstream attempt does not necessarily mean the overall request failed. Consider the final outcome and other attempts together.

## Read, search, and copy details

1. Open the record and verify its identity, request ID, time, HTTP status, and outcome.
2. Select **Request** or **Response**. **Analysis and formatting** is selected by default and organizes messages, tools, parameters, output, usage, and errors. Tools start collapsed.
3. Expand the needed structure or load more. Only the initial batch loads by default: 20 parsed items per page or up to 32 KiB per raw segment. Long fields also load in segments.
4. To find text, select a detail search scope and search. Matching is case-insensitive literal text, without regular expressions. It covers all saved content on the selected side, including segments not yet loaded. Results are paginated by occurrence and can locate the corresponding field or nearby stream event.
5. Load upstream attempts separately and load more as needed. Searching their errors requires additional diagnostic permissions. Run a new search after changing the search scope.

**Raw content** shows the saved sanitized representation, not necessarily the original network bytes. Requests, responses, search, and attempts are read independently. Access to the list does not guarantee access to every detail.

Copy controls have the following scope:

| Control                 | Actual scope                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copy current segment    | The last loaded item's text in the current reader, rather than the scroll position or all loaded text                                                                   |
| Load all saved content  | Off by default. Loads batches with progress for the current request or response, view, and selected subtree                                                             |
| Copy all loaded content | Available after enabling load-all and waiting for completion. Parsed output includes item labels and complete item text; raw output concatenates the retrieved segments |

Disabling the switch, changing the reading scope, or leaving details stops further loading. “All” remains limited to the current reader; it does not export requests, responses, and attempts together or recover truncated/omitted content. If the browser rejects copying, check the page access environment and clipboard permissions before retrying.

## Capture scope and limits

This page captures POST inference requests to the relay proxy, both streaming and non-streaming. It covers authentication rejection, body parsing/size rejection, quota and routing issues, upstream errors, timeouts, content safety rejection, interruptions, and settlement failures. Model-list and quota queries are not inference logs.

- Default body retention limits are **64 KiB per request** and **256 KiB per response**. Administrators can adjust them; the effective server configuration applies. Configuration changes do not recapture old records.
- Oversized content may retain only its size and a truncation marker, without a body preview. Detail pagination reads saved content and does not increase capture limits.
- Unknown identity, bodies that cannot be safely parsed, and request size rejection retain safe metadata only, omitting both request and response bodies.
- An overloaded capture queue may omit both bodies and mark them truncated. If the record still cannot be queued, or a database write fails, the entire record may be missing. A missing log does not prove that no request or charge occurred. This page is not a complete billing ledger.
- Binary content is represented by metadata such as type and size. Recognized password, token, and key fields are masked, and authentication headers are not written to AI logs. Arbitrarily formatted sensitive information in prompts or ordinary text is not guaranteed to be detected.
- At most 100 upstream attempts are retained. Error excerpts are limited to 16 KiB each and 64 KiB combined, with truncation indicated when limits are reached.

## Read historical archives

Hot retention defaults to 90 days and can be adjusted in **Data archive**. Records past that age leave hot storage only after an archive task actually processes them. Older records can remain if a policy is disabled, a task has not run, or execution fails. AI request log archives do not automatically expire by default.

This page searches hot storage only. For older records:

1. Expand the time range here and search first.
2. If records were archived, open [Data archive and cleanup]({{DOCS_BASE_URL}}/en/data-lifecycle) and check the corresponding run and artifacts.
3. Download the gzip NDJSON file and inspect it in a controlled environment. This page does not automatically search or restore archived content.

The upload is verified before corresponding hot data is deleted. A run can fail after some batches succeed. Check actual archived and deleted counts rather than assuming the run status describes every record's location.

## Configure IAM access

With IAM enforcement, the reader needs AI log reading eligibility from their actual platform global user group and the appropriate actions on each log. Account ownership, added user permissions, private account groups, and wildcard policies cannot independently establish platform reading eligibility.

The resource is `acs:platform:*:platform:relay-ai-request-log/<logId>`. `<logId>` is the log record ID and differs from the request ID.

| Purpose                       | Action                                     |
| ----------------------------- | ------------------------------------------ |
| List queries                  | `quyan:relay:ai_request_log:ListLogs`      |
| Metadata                      | `quyan:relay:ai_request_log:GetMetadata`   |
| Request or response content   | `quyan:relay:ai_request_log:GetContent`    |
| Content search                | `quyan:relay:ai_request_log:SearchContent` |
| Upstream attempts             | `quyan:relay:ai_request_log:GetAttempts`   |
| Compatibility detail endpoint | `quyan:relay:ai_request_log:GetLog`        |

Viewing attempts or searching attempt errors additionally requires `quyan:relay:ai_request_log:ReadDiagnostics` on the same log and diagnostic reading eligibility from a platform global user group. These permissions do not grant channel, route, or pool topology management capabilities.

The list filters unauthorized records before calculating totals and pagination. List, metadata, content, search, and diagnostic access are authorized separately and cannot substitute for one another. Changes to a record or authorization during queries or segmented reads can cause a failure. Confirm current access and query again.

## Troubleshooting

| Symptom                                                 | Suggested action                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Latest request is missing                               | Reselect a time shortcut and search; check other filters and your authorized scope instead of only refreshing                               |
| Query error followed by an empty list                   | A failed query request clears records and totals. Resolve the error and retry; this differs from a successful zero-result query             |
| Invalid-filter error with old records still visible     | Check status code, duration, and time ordering, then search again. Old records do not represent the new conditions                          |
| List works but bodies or attempts fail                  | Check metadata, content, search, and diagnostic permissions separately. Confirm the log remains in hot storage and retry the failed section |
| Body is missing or remains incomplete after loading all | Check omission reasons and truncation flags. Loading cannot recover unsaved data                                                            |
| HTTP 200 but the call had a problem                     | Inspect the business outcome, failure stage, response, and upstream attempts as well as HTTP status                                         |

## Related pages

- [Data archive and cleanup]({{DOCS_BASE_URL}}/en/data-lifecycle)
