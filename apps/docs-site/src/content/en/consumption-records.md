# Consumption records

Use this page to review API, chat, and monthly-pass-covered usage. Open Account balance for balance, redemption, and transfer activity.

After signing in, open **Consumption records** on the account site. This page queries records for your current account. In IAM enforcement mode, quota summaries and transaction queries have separate authorization checks; an unavailable section does not mean there was no consumption.

## Overview

The summary shows:

- Used quota and total quota.
- Total request count.
- Average TPM (tokens per minute).
- Average RPM (requests per minute).

The list below contains consumption records only. It does not include redemptions, transfers, or other account-balance transactions. The quota summary is fetched separately and does not change with the list filters or loaded range. Request count, average TPM, and average RPM use API usage records in the loaded range; type, token, channel, model, and date filters do not change these figures.

## Filter consumption records

Narrow the results by:

- Usage type: chat, API usage, or monthly pass coverage.
- Token, channel, and model.
- Start and end date.
- Loaded range: 1 day, 7 days, 30 days, or all records.

The loaded range defaults to the last day. Date and other filters apply only to consumption records and charts within the loaded range; token and channel options also come from loaded records. To view older data, first expand the range and wait for background loading, then set the filters. The page may ask for confirmation when you first select all records. Cached records may appear first; if loading or refresh fails, the records, filter options, and statistics may be incomplete. Try switching to a shorter range and expanding it again; ask an administrator to verify the data if you are still unsure.

The model filter matches a case-sensitive substring of the displayed model name; for example, `gpt` matches names containing `gpt`. Token and channel filters match the selected names exactly. The 1-, 7-, and 30-day ranges count backward from the current time rather than using calendar days.

The server currently returns only transactions from the last 30 days. All records does not retrieve the complete history since account creation. Local caches may retain older records, but cannot guarantee complete history. Ask an administrator to help reconcile earlier consumption.

Use Clear filters to clear the type, token, channel, model, and date conditions; adjust the loaded range separately.

## Review details

The list supports table and chart views. Expand a record to inspect available model, token, billing, channel, and request-ID details. The visible fields depend on the request type and billing data captured at that time.

### Reconcile monthly pass coverage

One relay API request can produce both a monthly pass coverage record and an API usage record. The coverage record describes the covered portion without deducting balance; the API usage record describes the balance charge for the uncovered portion. A fully covered request may have only a coverage record, while a request with no applicable pass is charged to balance.

Use the time, model, channel, and available request identifiers to find related records. Do not assume the two record types represent two separate requests. The charge for purchasing a pass appears in [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history).

## Troubleshooting

| Situation                                                     | What to do                                                                                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No records appear after setting dates                         | Clear the filters, expand the loaded range, and wait for loading to finish. Records outside the server's last-30-days query window cannot be fetched again. |
| A token or channel is missing from the filter                 | Options come from loaded consumption records, not a directory of all tokens or channels. Expand the loaded range and check again.                           |
| Filtering does not change the request count at the top        | The request statistics use API usage records in the loaded range and do not follow list filters. The quota summary is also independent of the loaded range. |
| Monthly pass coverage appears but the request count seems low | Records containing only monthly pass coverage do not count toward the API request summary. That number does not represent all completed requests.           |

## Notes

- Request count, TPM, and RPM use loaded API usage records, excluding zero-charge upstream errors from their totals. TPM sums input and output tokens only. The averages use the time span between the first and last loaded API usage records, including those zero-charge errors, with a minimum of one minute. These averages are not server-side rate-limit settings.
- Open Account balance to reconcile funding, transfers, or refunds.
- A larger loaded range can take longer to fetch the first time.

## Related pages

- [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history)
- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
- [My monthly passes]({{DOCS_BASE_URL}}/en/my-monthly-passes)
