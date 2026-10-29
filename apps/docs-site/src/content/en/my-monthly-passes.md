# My monthly passes

Use My Monthly Passes to review purchased or assigned benefits. Switch to **Monthly Pass Purchase Center** to buy a plan; see [Purchase a monthly pass]({{DOCS_BASE_URL}}/en/monthly-pass-purchase).

## Check passes and availability

1. Sign in, open My Monthly Passes, and select **View My Monthly Passes**.
2. Filter by active, pending, expired, or disabled state.
3. Check start and end times, quota unit, total, used and remaining quota, then window limits and channel and model scope. Small screens show the same information in cards.

| State    | Meaning and next action                                                                          |
| -------- | ------------------------------------------------------------------------------------------------ |
| Active   | The pass is enabled and within its validity period; still check remaining quota and scope        |
| Pending  | Its start time has not arrived; wait or ask an administrator to check the assignment dates       |
| Expired  | Its end time has passed and it cannot provide coverage                                           |
| Disabled | The pass is not enabled; an administrator must investigate and users cannot enable it themselves |

The state badge does not guarantee coverage. An active pass may still be unusable because its quota is exhausted, a window limit is reached, or its template is disabled.

## Update the list and check new passes

If a purchase, assignment, or carpool delivery is missing, reload the entire page and check for load errors. The top **Refresh** button reloads header balance and plan data, but it does not refresh assigned passes or the plan cards currently displayed in the purchase center.

The list loads only the first 100 permitted passes, ordered by earliest end time, rather than the 100 most recent purchases. State filters apply only to loaded records and do not fetch more passes. With many records, a new pass may be outside this list; ask an administrator to check. Switching tabs does not reload assigned passes either.

## Coverage and balance charges

When a relay API request is settled, the system automatically looks for enabled passes that are within their validity periods, have quota remaining, and match the request's channel and model. If several passes apply, those expiring sooner are used first; passes with the same expiry are used in creation order, oldest first.

| Quota unit | Coverage behavior                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| Amount     | Consumes quota equal to the covered cost and can provide partial coverage                                 |
| Requests   | With at least one request available, consumes one to cover the request's still-uncovered cost             |
| Tokens     | Consumes quota based on request token usage; insufficient quota can cover part of the cost proportionally |

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
- Window recovery does not restore consumed total quota or extend validity.
- Regular monthly passes use their associated template's current model and channel rules. Administrator changes to those restrictions or template availability may affect existing passes; check current scope and actual settlement.

## IAM permissions

With IAM enforcement enabled, My Monthly Passes authorizes each `acs:monthly-pass:*:<accountId>:assignment/<userId>/<passId>` using `quyan:monthly_pass:ListMyPasses` and never reads another user's assignments. Your own assignment, template and usage children are readable by default, with explicit Deny taking precedence. Template details use `acs:monthly-pass:*:<accountId>:template/<userId>/<templateId>`. Window usage requires every related `acs:monthly-pass:*:<accountId>:usage/<userId>/<passId>/<usageId>` to be allowed.

Denied template details or usage can leave details and window counters incomplete while an allowed assignment's own quotas remain visible. When template details are denied, the name may be blank and channel and model fields may say “All”. This does not prove unrestricted coverage; ask an administrator to check detail access and the template's actual rules.

## Related pages

- [Purchase a monthly pass]({{DOCS_BASE_URL}}/en/monthly-pass-purchase)
- [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history)
- [Monthly pass management]({{DOCS_BASE_URL}}/en/monthly-pass-management)
