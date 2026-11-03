# Balance management

Use balance management to query user balances, add or deduct balance manually, and verify transactions. Adjustments directly change site balance; confirm the user ID, amount, and reason first.

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
