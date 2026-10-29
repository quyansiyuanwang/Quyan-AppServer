# Account balance & transfers

Use this page to manage account balance, redeem codes, and send balance. API usage metrics and consumption records are kept on the separate Consumption records page.

## What you can do

- Check and refresh your current account balance.
- Redeem a code to add balance to your account.
- Create a shareable balance gift code.
- Transfer balance directly to an exact username.
- Review account funding, transfer, refund, and adjustment transactions.

## Redeem a code

Enter a valid code to add its balance to your account. Administrator codes and balance gift codes created by other users use the same redemption entry point. You cannot redeem a gift code that you created yourself.

## Create a balance gift code

The amount entered is what the recipient receives. The sender pays the fee in addition to that amount. Before submission, the dialog shows the current fee rate, fee amount, total debit, and the estimated fee and total refund available after cancellation. On successful creation, the recipient amount and fee are deducted from your balance immediately; creation fails if your balance is insufficient.

After creation, select the masked code in **My gift codes** to copy the full code. Share the full code only with the intended recipient; someone else who obtains it may also be able to redeem it.

- You can set an optional expiry time. The creator can still cancel an expired code if it has not been redeemed.
- Only an active user other than the creator can redeem the code.
- The creator can cancel an unredeemed code. Cancellation returns the recipient amount plus the configured portion of the fee.
- A redeemed or cancelled code cannot be used or cancelled again.

The fee and cancellation-refund rates are captured by the server when the code is created. Later configuration changes do not alter an existing code.

## Direct transfer

Enter the recipient's exact username and the amount they should receive. The recipient amount excludes the fee; the sender pays it in addition. The dialog shows the current rate, fee, and total debit before submission.

A completed direct transfer cannot be reversed. There is no user directory or fuzzy search, so verify the username before submitting.

## Account transactions

Account transactions help you reconcile balance changes. The loaded range defaults to the last day; you can also select the last 7 days, 30 days, or all history. The date filter only applies to records in the loaded range. To find older transactions, first expand the range and wait for it to load, then set the date filter. API usage records are not shown here; open Consumption records to filter by model, channel, token, and usage type.

## Notes

- Creating a gift code and making a direct transfer can require an additional security challenge.
- Feature availability, fee rates, and fee-refund rates are controlled by the current server configuration.
- Amounts shown before submission are previews. Final debits and refunds are determined by the server result.

## Related pages

- [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records)
- [My monthly passes]({{DOCS_BASE_URL}}/en/my-monthly-passes)
- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
