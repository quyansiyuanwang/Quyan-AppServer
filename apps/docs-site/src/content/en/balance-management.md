# Balance management

Use this page to review and adjust user balances from an administrator perspective.

## Page purpose

- Search balance records by user.
- Add or deduct balance manually.
- Review transaction history.
- Resolve recharge, compensation, or deduction issues.

## What you will see

### Search area

- User ID search field.
- Balance list.
- Pagination controls.

### Balance details

- Current balance.
- Linked user.
- Entry point to history.

### Management actions

- Adjust balance.
- Open transaction history.

## Common actions

1. Search for the target account by user ID.
2. Confirm whether the displayed balance matches expectations.
3. Open the adjustment dialog and enter either the change amount or the resulting balance; the fields update each other using the displayed balance. A positive amount adds balance, a negative amount deducts it, and the change cannot be zero.
4. Check the “count as statistics” switch and enter a reason before submitting. The switch is on by default: increases count toward total recharge and deductions toward total spending. Turn it off to exclude the adjustment from those totals.
5. After a successful adjustment, the page reloads the current list. Check the account’s actual balance and transaction history.

## Permission requirements

| Action                       | Required permission |
| ---------------------------- | ------------------- |
| View balances / transactions | `BALANCE_READ`      |
| Adjust balance (recharge)    | `BALANCE_RECHARGE`  |

## Notes

- Record a clear reason for auditability. If left blank, the page uses a default recharge or deduction description.
- The target balance is calculated from the balance shown when the dialog opens, and the submitted value is the change amount. If the balance changes concurrently, check the actual balance after submission.
- The list’s **Refresh** clears the user ID filter and returns to the first page. To query again with the filter retained, select **Search**.
- Transaction history initially loads the last seven days. You can select one day, 30 days, or all records; loading all requires confirmation. History **Refresh** adds records since the last load and does not recalculate or trim the selected time range. Select the range again to reload it.
- If the problem is caused by automated consumption, continue into consumption stats or system logs.
- The user-facing equivalent is usually the [Balance and transfers]({{DOCS_BASE_URL}}/en/balance-history) page.

## Related pages

- [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history)
- [Business logs]({{DOCS_BASE_URL}}/en/business-logs)
- [Consumption statistics]({{DOCS_BASE_URL}}/en/consumption-statistics)
