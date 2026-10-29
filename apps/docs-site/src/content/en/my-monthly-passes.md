# My monthly passes

Review the monthly-pass benefits assigned to your account, or switch to **Monthly Pass Purchase Center** to purchase a published plan.

## Page purpose

- See active, pending, or expired passes.
- Review quota totals and remaining usage.
- Check validity windows and channel/model limits.

## What you will see

### Pass list

- Pass name or template name.
- Status badge.
- Validity start and end time.
- Remaining, used, and total quota.

### Limits and availability

- Quota windows and their limits.
- Allowed channels.
- Allowed models.
- Mobile-friendly card layout when space is limited.

## Common actions

1. Reload the entire page if a new pass is missing. The top refresh button updates the header balance, but does not refresh the assigned-pass list or the purchase center plan cards.
2. Filter by status to distinguish active, pending, expired, and disabled passes.
3. Compare remaining quota with recent usage before heavy workloads.
4. Check allowed channels and models before troubleshooting a request restriction.

## Coverage and balance charges

When a relay API request is settled, the system automatically looks for enabled passes that are within their validity periods, have quota remaining, and match the request's channel and model. If several passes apply, those expiring sooner are used first; passes with the same expiry are used in creation order, oldest first.

Any cost left uncovered is charged to your account balance. Purchasing a pass does not turn off balance charging. For example, if a request costs 5 and an applicable amount-based pass covers only 3, the remaining 2 is charged to your balance. The request must still meet the relay token's status, permission, quota-window, and routing requirements.

Use the monthly pass coverage and API usage records in [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records) to reconcile coverage and balance charges. The price paid to purchase a pass is separate from the amount covered on each later request.

## Common issues

| Issue                                                  | What to check                                                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The pass is active but did not cover a request         | The status badge uses the pass's enabled status and validity dates, not its available quota. Check remaining quota, window limits, channels, and models. A disabled template also affects usage. |
| The pass has quota remaining but a request was charged | The channel or model may not match, or the pass may cover only part of the cost. Review the consumption details rather than relying on the status badge.                                         |
| A new pass is missing or the list is empty             | Reload the page and confirm it loads successfully. The page loads only the first 100 records, and permissions may filter them. Ask an administrator to check missing records.                    |
| The header balance shows `-`                           | This can mean a zero balance or a failed lookup. Check [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history).                                                                      |

## Notes

- A pass can be visible before it becomes active if it has a future start time.
- Limits can apply to the full validity period and to quota windows measured in amount, requests, or tokens. A window counts usage over its configured number of hours backward from the current time. For example, a 24-hour window does not reset at midnight; its available quota recovers as earlier usage leaves the window.
- The page currently loads only the first 100 assigned passes; the status filter applies to those loaded records.

## IAM permissions

With IAM enforcement enabled, My Monthly Passes authorizes each `acs:monthly-pass:*:<accountId>:assignment/<userId>/<passId>` using `quyan:monthly_pass:ListMyPasses` and never reads another user's assignments. Your own assignment, template and usage children are readable by default, with explicit Deny taking precedence. Template details use `acs:monthly-pass:*:<accountId>:template/<userId>/<templateId>`. Window usage requires every related `acs:monthly-pass:*:<accountId>:usage/<userId>/<passId>/<usageId>` to be allowed. Denied template details or window counters remain empty while an allowed assignment's own quotas remain visible.

## Related pages

- [Purchase a monthly pass]({{DOCS_BASE_URL}}/en/monthly-pass-purchase)
- [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history)
- [Monthly pass management]({{DOCS_BASE_URL}}/en/monthly-pass-management)
