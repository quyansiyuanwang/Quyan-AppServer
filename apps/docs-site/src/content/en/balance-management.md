# Balance management

Use balance management to query user balances, add or deduct balance manually, and verify transactions. Adjustments directly change site balance; confirm the user ID, amount, and reason first.

## Account data and overdraft credit

Users with `BALANCE_MANAGEMENT_READ` see the platform account management interface. Users with only the older `BALANCE_READ` permission keep the original interface. The new account list uses server pagination and exact user ID search; users without a balance account show zero values.

A deployment-managed global group must grant the corresponding capability. Reading accounts requires `BALANCE_MANAGEMENT_READ`, correcting data requires separate `BALANCE_ACCOUNT_ADJUST`, and changing credit policies requires separate `BALANCE_OVERDRAFT_MANAGE`. IAM policies can further restrict individual users. Existing balance read or recharge permissions do not grant these new capabilities. Writes recheck authorization and use replay protection and any configured two-factor challenge.

### Configure defaults or individual policies

1. Under **Default overdraft policy**, choose a calculation, bounds, and permitted spending categories, then save. The initial policy disables overdraft. Initial categories are API relay and web chat; categories grant no credit while overdraft is disabled.
2. Defaults apply dynamically to all inheriting users, including existing users. Use **Overdraft policy** in an account row to override the rule and categories independently, or restore either to the default.
3. Batch policies merge selections across pages with pasted user IDs, remove duplicates, and support up to 200 users. For rules and categories separately, choose keep unchanged, user override, or inherit default.
4. Preview total recharge, credit limits, and remaining credit before saving. Editing inputs invalidates the trial. If a target policy or default version changes, the entire batch is rejected; refresh and preview again. Batches do not partially succeed.

| Calculation         | Base credit amount                               |
| ------------------- | ------------------------------------------------ |
| Disable overdraft   | Always zero, ignoring the minimum                |
| Fixed credit        | Fixed amount                                     |
| Recharge percentage | Total recharge × percentage ÷ 100                |
| Fixed + percentage  | Fixed amount + recharge percentage amount        |
| Larger / smaller    | Larger / smaller of fixed and percentage amounts |
| Custom formula      | Restricted arithmetic expression                 |

Enabled calculations apply a minimum and optional maximum, then round down to four decimal places. The base is existing total recharge, including payments, redemptions, received transfers, and counted administrator credits; refunds reduce it. It is not a cash-payments-only statistic.

Formula variables are `totalRecharged`, `totalUsed`, `fixedAmount`, and `percent` (10 means 10%). Supported syntax includes `+ - * /`, parentheses, `min`, `max`, `abs`, and `round`; `round` rounds half up to four places. Example: `min(100, fixedAmount + totalRecharged * percent / 100)`. Scripts, property access, and other functions are unsupported. Division by zero, out-of-range results, and excessive expression length or depth are rejected. When changed statistics make a saved formula invalid, credit becomes zero and the account shows a calculation error.

### Spending categories and shared credit

Credit can be enabled separately for API relay, web chat, developer metered services, OJ questions, monthly pass purchases, carpool, and terminal purchases. Categories share one credit limit. Used credit is the absolute negative balance; remaining credit cannot be below zero. Recharges and statistical corrections can change the computed credit.

AI requests require balance plus applicable credit to be positive before starting. Admitted requests settle their full actual usage and may temporarily exceed the limit, blocking later requests. Existing monthly pass coverage continues to apply. Known-cost purchases must remain above the allowed negative balance after other carpool reservations. Transfers, gift-code withdrawals, and original-payment refunds cannot use credit.

### Correct balance, total recharge, and total usage independently

1. Select **Correct account data** and enable only the fields to change. Changing balance does not automatically change statistics; changing total recharge does not add balance.
2. Choose a delta or target value per field. Total recharge and usage cannot be negative. Amounts allow four decimal places and an absolute maximum of 999999.9999.
3. Enter a reason and preview the before/after account values, credit limit, and remaining credit. Editing inputs requires another trial.
4. Confirm to create a ledger entry and business audit, including a zero-change ledger when only statistics change. Target writes require the source field to match the previously read value; otherwise they fail. Delta writes accumulate against the latest account value.

Unchanged retries within the same dialog reuse an operation ID to prevent duplicate writes. Reopening the dialog or changing inputs starts a new operation. If the network result is unknown, refresh accounts and logs before submitting another correction. A trial does not lock future balances; submission still checks current data, permissions, and amount limits.

The new interface's original **Adjust Balance** and **View History** actions retain their older permissions and account resource boundaries. The former submits a delta with optional statistics counting; the latter paginates authorized records from the last 30 days. New platform permissions do not expand those older account boundaries. The following original-interface instructions apply to users of the legacy balance management workflow.

## Alipay orders and original payment refunds

The **Alipay orders and refunds** panel requires separate `PAYMENT_READ` permission; the containing page still requires its existing balance management permissions. Filter by user ID and review CNY amounts, credited units, Alipay transaction numbers, status, and refund history. Both lists use server pagination.

Refunds additionally require `PAYMENT_REFUND` and any configured two-factor challenge. Select **Original payment refund** on a paid order and enter the amount in CNY and a reason. The initial amount is the remaining refundable amount. Multiple partial refunds are allowed up to the original payment, with one processing refund per order.

Credit is deducted using the original recharge ratio. The server checks available balance after carpool reservations. Insufficient balance rejects the refund without creating debt. Processing holds the credit; success retains the deduction, while a definite Alipay rejection releases it. Timeouts and unknown results remain processing. Refresh the refund record or wait for automatic recovery. Do not use manual balance adjustments as a substitute for refund confirmation.

Successful refunds reduce cumulative recharge and do not count as user spending. Fees and eligibility depend on the Alipay agreement and transaction state. Finished, expired, or partial-refund-restricted transactions may not be refundable.

## Prerequisites

Opening the page requires `BALANCE_READ`. The page also reads the user directory, so corresponding user read access is needed. Adjustments require separate `BALANCE_RECHARGE` permission. Accounts with two-factor authentication may need verification when submitting a change.

With IAM enforcement, balances and transactions are constrained by account membership and resource grants. Seeing someone in the directory does not grant access to their balance. See the authorization section below.

## Query a user's balance

1. Enter the target's complete **User ID** and select **Search**.
2. Check user ID, username, current balance, and update time. The list shows 20 users per page; use pagination to continue.
3. Select **Search** to query again with the filter retained. **Refresh** clears the user ID and returns to page one.

If no balance account is returned, the list displays zero and uses the current time as update time. That timestamp does not prove a recent balance change, and zero alone does not prove an existing account was emptied. The page does not show carpool reservations; the displayed balance is not necessarily fully transferable.

A failed load can leave the old list visible. Resolve the error and query again before making an adjustment.

## Add or deduct balance

1. Select **Adjust Balance** for the target user and recheck the user ID and current balance.
2. Enter **Amount**: positive adds balance, negative deducts it, and zero is invalid. Each adjustment must be from -100000 to 100000 with up to four decimal places. Alternatively, enter **Result Balance** to calculate the change from the displayed balance.
3. Check **Count as Statistics**, enabled by default. An increase adds to cumulative recharge; a deduction adds its absolute amount to cumulative spending. Turning this off still changes balance and records a transaction, but does not increase those two totals.
4. Enter a clear reason, up to 500 characters. If empty, the page supplies a default administrator recharge or deduction description.
5. Select **Confirm** and complete any required verification. Success closes the dialog and reloads the list. Select **View History** to verify the adjustment and actual balance.

**Result Balance is an estimate; the submitted value is the change amount.** For example, entering a target of 15 when the displayed balance is 10 submits +5. If another charge reduces the balance to 8 first, the adjustment produces 13. Refresh and recalculate when precision matters; the field does not lock the final balance.

Manual deductions have no insufficient-balance floor and can produce a negative balance. Check the result before submitting, along with related orders when carpool reservations or concurrent charges exist. Repeating the same change adjusts balance again. There is no undo button; verify the original transaction before making a clearly explained corrective adjustment.

## Inspect transaction history

1. Select **View History** for a user. The dialog initially loads permitted records from the last seven days.
2. Choose one, seven, or 30 days, or **Load All**. Loading all requires confirmation.
3. Filter loaded data by transaction type, token, channel, model, or dates. Check amount, balance before and after, and description. Switch between table and chart views as needed.
4. Use history **Refresh** to fetch new transactions. Select a loading range again to reload that range.

The server returns active transactions within the most recent 30 days only. **Load All does not retrieve an older complete ledger.** Date and other filters in the dialog filter already-loaded data without fetching missing records outside it. Charts and counts also use only loaded, authorized, filtered records; they are not lifetime account statistics.

History refresh appends records since the last load without recalculating or trimming the original time range. Incremental refresh failures may have no separate notification; reselect a range when freshness must be confirmed. Resolve loading errors before treating old records or an empty list as current results.

## Permissions and resource scope

| Task                                     | Required permission |
| ---------------------------------------- | ------------------- |
| Read the user directory used by the page | `USER_READ`         |
| View balances and transactions           | `BALANCE_READ`      |
| Add or deduct balance                    | `BALANCE_RECHARGE`  |

With IAM enforcement, the user directory uses `quyan:user:ListUsers` on deployment-wide `acs:platform:*:platform:user/<userId>` resources and requires deployment-managed global group eligibility for user reads. Balances and transactions instead use current account membership, covering active users within the same account. An Allow cannot move another account's user into that scope.

In the following table, `accountId` is the current account ID.

| Action                               | Resource ARN                                                     |
| ------------------------------------ | ---------------------------------------------------------------- |
| `quyan:balance:GetUserBalance`       | `acs:quyan:*:<accountId>:user/<userId>`                          |
| `quyan:balance:RechargeUserBalance`  | `acs:quyan:*:<accountId>:user/<userId>`                          |
| `quyan:balance:ListUserTransactions` | `acs:balance:*:<accountId>:transaction/<userId>/<transactionId>` |

Reads and adjustments are authorized separately. The page requests balances for the current user list as a batch. One user outside the account or without access can fail the whole balance query instead of being skipped. Narrow the query to one authorized user ID and ask an administrator to align directory and balance access.

Transaction lists count and paginate allowed records only. No visible records does not establish that a user has no consumption. Expired role sessions or changes to account status or permissions can require signing in again or refreshing before checking results.

## Troubleshooting

| Symptom                                      | What to do                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The page opens but the list fails to load    | Check directory access, balance access for every user on the page, and account membership separately                    |
| Actual balance differs from the target       | Check the submitted difference, concurrent charges, and other adjustments against transaction balances before and after |
| Transactions remain with statistics disabled | Expected: the switch controls cumulative recharge and spending, without hiding balance changes                          |
| Connection drops after adjustment            | Search for the user and inspect history before deciding whether to submit another adjustment                            |
| Older records are missing after Load All     | Server queries cover only the most recent 30 days; local date filters cannot extend that range                          |

## Related pages

- [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history)
- [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records)
- [Business logs]({{DOCS_BASE_URL}}/en/business-logs)
- [Consumption statistics]({{DOCS_BASE_URL}}/en/consumption-statistics)
