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

The amount entered is what the recipient receives. The sender pays the fee in addition to that amount. Before submission, the dialog shows the current fee rate, fee amount, total debit, and the estimated fee and total refund available after cancellation.

- You can set an optional expiry time. The creator can still cancel an expired code if it has not been redeemed.
- Only an active user other than the creator can redeem the code.
- The creator can cancel an unredeemed code. Cancellation returns the recipient amount plus the configured portion of the fee.
- A redeemed or cancelled code cannot be used or cancelled again.

The fee and cancellation-refund rates are captured by the server when the code is created. Later configuration changes do not alter an existing code.

## Direct transfer

Enter the recipient's exact username and the amount they should receive. The recipient amount excludes the fee; the sender pays it in addition. The dialog shows the current rate, fee, and total debit before submission.

A completed direct transfer cannot be reversed. There is no user directory or fuzzy search, so verify the username before submitting.

## Account transactions

Account transactions help you reconcile balance changes. Use the date and loaded-range controls to inspect recent or longer history. API usage records are not shown here; open Consumption records to filter by model, channel, token, and usage type.

## Notes

- Creating a gift code and making a direct transfer can require an additional security challenge.
- Feature availability, fee rates, and fee-refund rates are controlled by the current server configuration.
- Amounts shown before submission are previews. Final debits and refunds are determined by the server result.

## Related pages

- `consumption-records`
- `my-monthly-passes`
- `relay-token-management`
