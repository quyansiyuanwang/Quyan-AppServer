# Consumption statistics

Use this page to analyze usage volume across users, models, channels, and relay tokens.

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
- User distribution chart.

### Detail tables

- Channel table.
- Model table.
- User table.

## Common actions

1. Start with a date range that matches the incident or billing period.
2. Narrow the results using user, model, channel, or relay-token filters.
3. Review summary cards before diving into detail tables.
4. Compare chart distributions to identify concentration or anomalies.
5. When investigating a model family, enter a regex in the model filter (e.g. `gpt-4.*`) to match all variants at once.

## Notes

- Too many active filters can hide the broader trend, so widen them when totals look suspicious.
- This page is useful for both performance analysis and cost investigation.
- For single-user financial correction, continue into balance management or business logs.
- Requires `SYSTEM_CONSUMPTION_STATS_READ` permission.

## Related pages

- `balance-management`
- `system-statistics`
- `business-logs`
