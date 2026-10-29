# OJ usage statistics

Use this page to review request volume, token usage, and cost details for the signed-in user’s OJ submitter traffic.

## Page purpose

- Analyze OJ submitter usage over time.
- Compare request, token, and cost totals.
- Inspect detailed usage records.

## What you will see

### Filters and summary

- Date-range filters.
- Summary stats for requests, tokens, cost, and average tokens cover all of the current user’s records in the selected period, not just the current list page.
- Average tokens are total tokens divided by request count, rounded to the nearest integer; the value is 0 when there are no records.

### Usage list

- Table or card list, ordered by record time from newest to oldest; the initial request asks for 20 records per page.
- Model, question, token, and cost fields.
- Pagination controls; the current API does not return the total record count, so the page may not provide access to later records.

### Detail view

- Full question content.
- Full answer content.

## Common actions

1. Set the date range you want to inspect.
2. Review top-level totals before opening details.
3. Review model and question content in the returned records; the page does not filter by model or question.
4. Open a detail record when you need the full request and response content.

## Notes

- Initially there is no date limit; select **Reset** to clear date filters. On desktop, the query uses the times returned by the date-range picker, with the end date normally at 00:00. On mobile, the end date extends to 23:59:59.999 that day. To include a full day on desktop, select the following day as the end date; records at midnight on that following day may also be included.
- Changing a date immediately queries the current page without resetting it. If details are empty, select **Reset** to return to the first page, then set the dates again. A failed query may leave previous results visible; check the error and retry before relying on the totals or details.
- Detailed views may contain sensitive prompt or answer content.
- Sudden cost changes are easier to interpret when compared with pricing settings.
- Details do not identify the API key, so this page cannot attribute an individual request to a key. The key-management page shows cumulative request and token counts per key.
- Total tokens are the sum of input and output tokens; cache-creation and cache-read tokens are not separately displayed here.

## Related pages

- [OJ API key management]({{DOCS_BASE_URL}}/en/oj-api-key-management)
- [OJ pricing management]({{DOCS_BASE_URL}}/en/oj-pricing-management)
