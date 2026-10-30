# Consumption statistics

Use Consumption statistics to review deployment-wide spending trends and filter reports by user, model, channel, or relay token. It helps identify concentrations of spending. Check the relevant detail pages for transaction reconciliation, request success rates, and OJ usage.

## Prerequisites

Opening the page requires `SYSTEM_CONSUMPTION_STATS_READ`. IAM enforcement also requires eligibility from a real deployment-wide management group and `quyan:system:GetConsumptionStatistics` on `acs:platform:*:platform:system/consumption-stats`. Individual additions or account policies cannot replace that group eligibility.

Authorization covers the entire deployment report, including filter choices and dimensional details. Selecting one user narrows the report rather than turning the API into a personal query. For your own usage, use [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records) or [OJ usage statistics]({{DOCS_BASE_URL}}/en/oj-usage-statistics).

## Query a report

1. Open the page and wait for the initial report. The default range is the last seven calendar days, including today.
2. Select start and end dates. Changing dates immediately queries the report.
3. Select users, models, channels, or tokens, then choose Apply filters.
4. Check the summary and displayed range before comparing trends and breakdowns.
5. Choose Refresh for current data. Clear all filters removes resource selections while retaining the date range.

There is no automatic refresh. Ranges longer than 30 days are queried in segments and merged, which can take longer. Segments are not a snapshot from one instant; narrow the range and refresh when reconciling changing data.

Dates are selected in browser local time and converted to timestamps. The server then uses calendar-day boundaries in its own timezone, including daily buckets. Different browser/server timezones can shift boundaries from local expectations. Align ranges and timezones when comparing pages.

## Use filters

Selections within one dimension use OR; different dimensions combine with AND. No selections in a dimension means no restriction for it.

Search inside a selector matches candidate names or identifiers. By default it uses a case-insensitive regular expression, such as `gpt-4.*`; `/pattern/i` also works. Invalid regex falls back to plain-text matching. **Search narrows choices without selecting them or querying the report.**

Select all, invert, and clear affect only current search results, preserving other selections. Clear the search before operating on the entire dimension. Use Clear all filters to remove selections in every dimension.

Choices come from reportable data in the selected dates rather than a directory of every user, model, or channel. A missing option can mean no matching records in that period. Refreshing or changing dates removes selections no longer available and may trigger another query. Check the scope after loading finishes. Each API filter dimension accepts up to 1,000 selections; reduce selections if validation fails.

Counts and tags reflect current choices, which can differ from the old report before applying them. Refreshing or changing dates also submits current choices. After errors, do not treat old or intermediate results as the report for new selections.

## Understand the reporting scope

Reports use active API usage charges and monthly-pass coverage records within the selected dates, grouped by their consumption association. They exclude top-ups, transfers, gifts, and all failed-attempt totals. Request count means grouped records rather than HTTP log entries and cannot establish the success rate of every attempted call.

**This report is not a complete OJ bill.** Multiple calls using one OJ key can be grouped together, so requests, tokens, and costs may differ from OJ transaction totals. Reconcile OJ usage with its usage-statistics page and balance transactions rather than using this report alone to decide whether charges are missing or excessive.

A missing matching relay-usage detail does not necessarily exclude a spending record. Some records can remain included without relay-token attribution. Applying a token filter can exclude those records. Archiving or deleting historical data can also change report coverage; permanent complete history is not guaranteed.

| Metric          | Meaning                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| Total spend     | Balance charges plus monthly-pass coverage, not the balance debit alone |
| Charged spend   | Balance charges from included records                                   |
| Covered spend   | Amount covered by monthly passes, not a second balance debit            |
| Consuming users | Distinct users with positive total spend                                |
| Active users    | Distinct users represented in the report, not online or signed-in users |
| Requests        | Grouped record count, also used for average spend per request           |
| Tokens          | Saved total-token values; cache tokens appear on a separate card        |

The page's zero-charge request value counts **zero total spend**. Fully covered requests with positive total spend are excluded from it. It does not mean every request without a balance debit.

Amounts display four decimal places; average tokens per request use two. Totals use recorded amounts rather than repricing history after channel renaming or rate changes.

## Read charts and breakdowns

- Daily trends show total spend, requests, and consuming users, with separate axes for money and counts. Dates without records can be absent; their absence does not establish a query failure that day.
- The channel pie includes only the top eight channels by spend. Slice percentages are relative to those eight; the channel table's shares use the entire current report, so the percentages can differ.
- Model and user charts each include the top ten by spend. Use the tables for the full returned breakdown.
- Channels are grouped by name, so identically named channels can merge. Names can come from historical spending records and do not identify current channel IDs. User names are resolved from currently available names, falling back to user IDs.

Desktop shows four charts and fuller channel, model, and user tables. Mobile shows only daily trends and reduced tables in collapsible sections. Use desktop for charge, coverage, request, and share columns.

There is no token breakdown table, raw request detail, or export button. Use consumption records, balance management, and business logs for individual requests or financial adjustments. This report does not change balances.

## Authorization and troubleshooting

Management queries use the signed-in identity and do not accept third-party OAuth access tokens. Authorization and global-group eligibility are checked before reading and before returning results. Role sessions use role grants. Matching Deny, invalid identity, or session revocation rejects the entire report.

| Symptom                                          | What to do                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Values do not change after selection             | Choose Apply filters and confirm success; tags do not prove filters were applied          |
| A user or model is missing from choices          | Check dates and report scope; choices are not a complete resource directory               |
| Results suddenly widen                           | Check whether unavailable selections were removed; an empty dimension is unrestricted     |
| Total spend exceeds balance debits               | Check monthly-pass coverage and any OJ grouping differences                               |
| Pie percentages differ from the table            | The pie uses the top eight; table shares use the full report's spend                      |
| Old results or initial zeros remain after errors | Refresh successfully before concluding there is no spending or reconciliation is complete |
| Personal records are needed but access is denied | Use personal consumption records rather than requesting deployment-wide report access     |

## Related pages

- [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records)
- [OJ usage statistics]({{DOCS_BASE_URL}}/en/oj-usage-statistics)
- [Balance management]({{DOCS_BASE_URL}}/en/balance-management)
- [Business logs]({{DOCS_BASE_URL}}/en/business-logs)
