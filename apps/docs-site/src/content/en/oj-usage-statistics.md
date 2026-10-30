# OJ usage statistics

Use OJ usage statistics to verify the signed-in user's submitter records, token usage, and settled charges. It does not aggregate other users under the same account or offer a user selector.

## Prerequisites

Opening OJ usage statistics requires `OJ_USAGE_READ`. Queries use the signed-in identity. An OJ API key submits questions; it does not replace login credentials for reading this page.

IAM enforcement also requires `quyan:ojqa:GetUsage` on the current user resource, `acs:quyan:*:<account-id>:user/<current-user-id>`. The account ID belongs to the account owner. A visible page entry does not guarantee query access; matching Deny rules and role-session restrictions still apply.

## Query a date range

1. Open the page, wait for loading to finish, and check for errors. Initially, there is no date limit.
2. Select start and end dates. Date changes immediately trigger a query.
3. Check the summary before the records. Choose Reset to clear dates and return to the first page.

Dates use the browser's local time and are converted to a standard timestamp for querying. On desktop, the end date is normally 00:00 that day. To include a full target day, select the following day as the end date; records at midnight on that following day may also be included. Mobile extends the end date to 23:59:59.999 that day.

Changing dates retains the current page. If records are empty, reset before selecting dates again. There is no automatic refresh; change dates, reset, or reopen the page to update results. After switching device layouts, reset before setting dates to avoid retaining filters from the previous layout.

## Understand the summary

Summary values cover all active usage records for the current user in the selected period, not just the current page.

| Metric         | Meaning                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| Request count  | Number of saved usage records, not all call attempts                                     |
| Total tokens   | Input tokens plus output tokens                                                          |
| Total cost     | Sum of saved charges, displayed to four decimal places                                   |
| Average tokens | Total tokens divided by request count, rounded to the nearest integer; 0 without records |

Upstream failures, request validation failures, and incomplete settlement do not create corresponding usage records. Request count therefore cannot establish the success rate of all attempts. An upstream call can occur before settlement fails; a missing record does not prove that the request was never sent.

Cache creation/read tokens are not listed separately or included in the displayed total tokens, but can incur charges. Historical records retain their settled costs; pricing changes do not recalculate them. See [OJ pricing management]({{DOCS_BASE_URL}}/en/oj-pricing-management) to check charges.

## View records and details

Records appear newest first, showing model, question, input/output tokens, total tokens, cost, and local time. The initial page size is 20; desktop offers sizes of 10, 20, or 50.

**The current query API does not return a total record count. Pagination may show a total of 0 and may not provide access to later pages.** This does not make the summary or displayed records zero. Narrow the date range to continue checking. For integrations, an authorized signed-in identity can call `GET /v1/products/oj-submitter/usage` with explicit `page` and `pageSize` values. Pages start at 1, with up to 200 records per page. The response also omits the total, so a single response does not establish that all records were retrieved.

Choose View Details to check the loaded record's model, time, tokens, and cost, and read the full question and answer. Opening details does not query the record again; query the list first when you need fresh data. Review question and answer content for sensitive information before sharing.

There are no model, question, or API key filters, exports, charts, or per-key attribution. Individual returned records do not identify their key. See [OJ API key management]({{DOCS_BASE_URL}}/en/oj-api-key-management) for each key's cumulative request and token counts.

## Troubleshooting

| Symptom                                           | What to do                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Nonzero summary but pagination total is 0         | The API omits the pagination total. Check summary scope and narrow the date range            |
| Fewer end-date records than expected              | Check whether the desktop end time is midnight and verify the local timezone                 |
| No records after changing dates                   | Reset to the first page, then select dates again                                             |
| Old summary or records remain after a query error | Previous results are retained. Query successfully before relying on them                     |
| Initial totals are 0 with a loading error         | Resolve authentication, authorization, or network errors before concluding there is no usage |
| Cost does not track total tokens proportionally   | Check the model, rates used for that request, and independent cache costs                    |
| Usage remains after deleting a key                | Deleting a credential does not delete settled usage records                                  |

## Related pages

- [OJ API key management]({{DOCS_BASE_URL}}/en/oj-api-key-management)
- [OJ pricing management]({{DOCS_BASE_URL}}/en/oj-pricing-management)
