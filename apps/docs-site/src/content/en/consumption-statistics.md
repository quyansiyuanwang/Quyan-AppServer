# Consumption statistics

Use this page to analyze usage volume across users, models, channels, and relay tokens.

## Management permissions

This page shows a deployment-wide consumption report, including filter choices and dimensional details. With IAM enforcement, you need `SYSTEM_CONSUMPTION_STATS_READ` in an actual deployment administrator group and `quyan:system:GetConsumptionStatistics` on `acs:platform:*:platform:system/consumption-stats`. Ordinary account owners and account policies cannot grant deployment administrator eligibility.

Time, user, model, and channel filters only change the report contents; they do not replace management authorization. Authorization is checked before reading and before returning the report. Explicit Deny, lost deployment eligibility, or a revoked role session prevents the report from being returned. Use personal billing and consumption records to view your own usage.

## Page purpose

- Filter usage by time and resource dimensions.
- Compare trends across channels, models, and users.
- Review summary totals and detailed tables.
- Use regex patterns for advanced filtering on model names or channel names.

## What you will see

### Filter area

- Date-range filter.
- Multi-select filters for users, models, channels, and relay tokens (support keyword search and regex).
- Active filter tags.

### Summary and charts

- Summary cards (total requests, token volume, cost, etc.).
- Daily trend chart.
- Channel distribution chart.
- Model distribution chart.
- User distribution chart. On mobile, only the daily trend chart is shown.

### Detail tables

- Channel table.
- Model table.
- User table.

## How the report is calculated

- The report uses API usage charges and monthly-pass coverage records within the selected dates, grouped by their associated usage record. Transactions without an associated usage record are excluded. The request count reflects these grouped records and is not necessarily the total number of relay requests.
- Total cost includes both balance charges and amounts covered by monthly passes, so it is not the same as the amount deducted from balances. Use balance management to review individual charges when reconciling totals.
- The daily chart shows cost, requests, and other data. The channel chart shows the eight channels with the highest cost; the model and user charts each show the top ten by cost. Use the detail tables below for the full breakdown.

## Common actions

1. Start with a date range that matches the incident or billing period.
2. Narrow the results using user, model, channel, or relay-token filters.
3. Review summary cards before diving into detail tables.
4. Compare chart distributions to identify concentration or anomalies.
5. To investigate a model family, enter a regex in the model filter (e.g. `gpt-4.*`), select the matching options, and click **Apply filters**. Search narrows the choices; it does not select them automatically.

## Notes

- Leaving a dimension with no selected options does not restrict results by that dimension. To narrow the report, select the desired options and click **Apply filters**.
- After searching within a filter, the select-all, invert-selection, and clear controls affect only the current search results; other selections remain. Clear the search to operate on all available options.
- Too many active filters can hide the broader trend, so widen them when totals look suspicious.
- This page is useful for both performance analysis and cost investigation.
- For single-user financial correction, continue into balance management or business logs.
- Requires `SYSTEM_CONSUMPTION_STATS_READ` permission.

## Related pages

- [Balance management]({{DOCS_BASE_URL}}/en/balance-management)
- [System statistics]({{DOCS_BASE_URL}}/en/system-statistics)
- [Business logs]({{DOCS_BASE_URL}}/en/business-logs)
