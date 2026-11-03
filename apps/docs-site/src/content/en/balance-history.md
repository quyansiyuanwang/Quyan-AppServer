# Account balance & transfers

Use this page to manage account balance, redeem codes, and send balance. API usage metrics and consumption records are kept on the separate Consumption records page.

## Before you start

After signing in, open **Account balance** on the account site. Redemption credits the currently signed-in account, so check your account identity first.

Gift-code creation and direct transfers must be enabled by the server. Your balance must cover the recipient amount plus the fee. Both methods accept a recipient amount from 0.01 to 100000 per operation, with up to four decimal places.

In IAM enforcement mode, balance reads, transaction reads, redemption, gift-code creation and cancellation, and direct transfers have separate authorization checks. An explicit Deny can restrict an individual operation. The gift-code list and total include only your authorized codes; an empty list does not necessarily mean you have never created one.

## Redeem a code

1. Paste the complete code into the redemption field at the top of the page.
2. Select **Redeem** and wait for success. Administrator codes and gift codes from other users use this entry point. You cannot redeem a gift code you created yourself.
3. Check the updated balance. Use the refresh button in the account transactions section to see the corresponding transaction.

Missing, redeemed, cancelled, or expired codes cannot be used. Check with the person who supplied the code without sharing the full code publicly.

## Create a balance gift code

1. In the transfer section, select **Create Gift Code**. Enter the amount the recipient should receive and, optionally, an expiry time later than the current time.
2. Check the current fee rate, fee, total debit, and estimated fee and total refund after cancellation. The sender pays the fee in addition to the recipient amount.
3. Submit and complete any required security challenge. On success, the recipient amount and fee are deducted immediately. Creation fails if your balance is insufficient.

After creation, select the masked code in **My gift codes** to copy the full code. Share the full code only with the intended recipient; someone else who obtains it may also be able to redeem it.

- Expiry prevents redemption but does not automatically refund the balance. The creator can still cancel an expired code if it has not been redeemed.
- Only an active user other than the creator can redeem the code.
- The creator can cancel an unredeemed code. Cancellation returns the recipient amount plus the configured portion of the fee.
- A redeemed or cancelled code cannot be used or cancelled again.

The fee and cancellation-refund rates are captured by the server when the code is created. Later configuration changes do not alter an existing code.

### Cancel an unredeemed code

Find the code in **My gift codes**, select **Cancel**, confirm, and complete any required security challenge. On success, the code becomes cancelled and the refund is credited to the creator's balance. If the recipient redeemed it first, cancellation fails; refresh the list to check its state.

## Direct transfer

1. Select **Direct transfer** in the transfer section. Enter the recipient's exact username and recipient amount, and optionally a note of up to 500 characters.
2. Check the username, current rate, fee, and total debit. The recipient amount excludes the fee, which the sender pays in addition.
3. Submit, confirm the warning that the transfer cannot be reversed, and complete any required security challenge. On success, check your balance and outgoing transaction.

You cannot transfer to yourself or an unavailable user. A completed direct transfer cannot be reversed. There is no user directory or fuzzy search, so verify the username before submitting.

## Account transactions

Account transactions help you reconcile balance changes. The loaded range defaults to the last day; you can also select the last 7 days, 30 days, or all history. These day ranges count backward from the current time rather than using calendar days. The date filter only applies to records in the loaded range. To find older transactions, first expand the range and wait for background loading, then set the date filter. Selecting all history may require confirmation.

The server currently returns only transactions from the last 30 days. All history does not mean the complete history since account creation. Local caches may retain older records, but cannot guarantee complete history. Cached records may appear first, and loading or refresh failures can leave the list incomplete. Try switching to a shorter range and expanding it again. If the result remains uncertain, ask an administrator to verify it instead of relying on the list alone to determine whether a transaction completed.

API usage records are not shown here. Open [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records) to filter by model, channel, token, and usage type.

## Notes

- The top refresh button updates the balance. The refresh button in the transfer section reloads configuration and the current gift-code page; account transactions have a separate refresh button.
- If redeeming, creating, or cancelling a code, or making a direct transfer times out or the connection is interrupted, the outcome may be unknown. Refresh the balance and account transactions; for gift-code creation or cancellation, refresh **My gift codes** as well. Check whether the operation completed before retrying. Contact an administrator if the result remains unclear.
- Creating or cancelling a gift code and making a direct transfer can require an additional security challenge.
- Feature availability, fee rates, and fee-refund rates are controlled by the current server configuration.
- Amounts shown before submission are previews. Final debits and refunds are determined by the server result.

## Troubleshooting

| Situation                                               | What to do                                                                                                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gift-code creation or direct-transfer button is missing | Refresh the transfer section and wait for configuration and codes to load successfully. If the button remains missing, ask an administrator whether the feature is enabled. |
| The list does not change after paging, or refresh fails | A failed load can retain the last successful data. Do not treat that list as the requested page; refresh again and wait for success.                                        |
| A code cannot be copied                                 | Copying requires browser clipboard access. Allow access, select the code again, and check the actual pasted value.                                                          |
| An expired code still has an active state               | Active state does not guarantee that the code has not expired. Its creator can cancel an unredeemed expired code to receive the applicable refund.                          |

## Related pages

- [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records)
- [My monthly passes]({{DOCS_BASE_URL}}/en/my-monthly-passes)
- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
