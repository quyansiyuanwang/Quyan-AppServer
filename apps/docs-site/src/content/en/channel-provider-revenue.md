# Channel supply and earnings

This page is for users who provide standalone relay channels. Submit a channel, follow its review status, and inspect earnings created by actual consumption.

## Submit a channel

Only standalone channels can be submitted. Enter the upstream URL and API key for each enabled protocol format. Keys are sent to the server only for review and relay use; they are never shown in submission lists, earnings lists, or error messages.

Submitted channels remain pending until an administrator lists, rejects, or offboards them. After listing, an administrator can change the sale multiplier, add providers, and configure each provider's commission and settlement mode.

## Earnings and settlement

Earnings are created only from an amount actually debited from a consumer balance. Failed requests, zero charges, and fully covered monthly-pass usage create no earnings. When a pass covers only part of a request, only the remaining debit is shared. Each earning preserves the channel, provider, and percentage snapshot from when the debit occurred, so later edits never rewrite history.

Providers can use real-time, every-N-days, daily-at-a-fixed-time, or manual settlement. Real-time earnings enter spendable balance directly. Scheduled settlement uses the server's Asia/Shanghai time zone. Manual providers use Transfer to balance on this page. The transfer creates a separate commission transaction in spendable balance; it is not treated as a recharge.

A channel can have several providers. Each provider can receive 0% through 100%, while the total is allowed to exceed 100%. The platform subsidizes the excess, and the channel editor shows the total plus the platform remainder or subsidy.

## Related pages

- `relay-settings`
- `balance-history`
