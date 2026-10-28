# OJ usage statistics

Use this page to review request volume, token usage, and cost details for the signed-in user’s OJ submitter traffic.

## Page purpose

- Analyze OJ submitter usage over time.
- Compare request, token, and cost totals.
- Inspect detailed usage records.

## What you will see

### Filters and summary

- Date-range filters.
- Summary stats for requests, tokens, cost, and average tokens.

### Usage list

- Table or card list.
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

- Detailed views may contain sensitive prompt or answer content.
- Sudden cost changes are easier to interpret when compared with pricing settings.
- Details do not identify the API key, so this page cannot attribute an individual request to a key. The key-management page shows cumulative request and token counts per key.
- Total tokens are the sum of input and output tokens; cache-creation and cache-read tokens are not separately displayed here.

## Related pages

- [OJ API key management]({{DOCS_BASE_URL}}/en/oj-api-key-management)
- [OJ pricing management]({{DOCS_BASE_URL}}/en/oj-pricing-management)
