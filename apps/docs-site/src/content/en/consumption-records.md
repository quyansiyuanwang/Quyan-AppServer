# Consumption records

Use this page to review API, chat, and monthly-pass-covered usage. Open Account balance for balance, redemption, and transfer activity.

## Overview

The summary shows:

- Used quota and total quota.
- Total request count.
- Average TPM (tokens per minute).
- Average RPM (requests per minute).

The list below contains consumption records only. It does not include redemptions, transfers, or other account-balance transactions.

## Filter consumption records

Narrow the results by:

- Usage type: chat, API usage, or monthly pass coverage.
- Token, channel, and model.
- Start and end date.
- Loaded range: 1 day, 7 days, 30 days, or all records.

Filters affect the consumption list and chart view only. Use Clear filters to clear the type, token, channel, model, and date conditions; adjust the loaded range separately.

## Review details

The list supports table and chart views. Expand a record to inspect available model, token, billing, channel, and request-ID details. The visible fields depend on the request type and billing data captured at that time.

## Notes

- Request count, TPM, and RPM use loaded API usage records, excluding zero-charge upstream errors from their totals. TPM sums input and output tokens only. The averages use the time span between the first and last loaded API usage records, including those zero-charge errors, with a minimum of one minute. These averages are not server-side rate-limit settings.
- Open Account balance to reconcile funding, transfers, or refunds.
- A larger loaded range can take longer to fetch the first time.

## Related pages

- [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history)
- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
- [My monthly passes]({{DOCS_BASE_URL}}/en/my-monthly-passes)
