# Channel supply and earnings

This page is for users who provide standalone relay channels. Submit a channel, follow its review status, and inspect earnings created by actual consumption.

## Submit a channel

Only standalone channels can be submitted. Enter the upstream URL and API key for each enabled protocol format. Keys are sent to the server only for review and relay use; they are never shown in submission lists, earnings lists, or error messages.

Submitted channels remain pending until an administrator lists, rejects, or offboards them. After listing, an administrator can change the sale multiplier, add providers, and configure each provider's commission and settlement mode.

The form also covers format and model restrictions, model mappings, cache-read accounting, time-period multipliers, and context-length multipliers. After a channel is listed, the original submitter cannot edit the live configuration directly. They can submit a complete configuration from My change requests; it stays pending, approved, or rejected with the operator's reason, and is applied atomically only after approval.

The format and model section can probe the corresponding upstream `/v1/models` endpoint. Temporary probe credentials are not persisted or returned. Models that match global pricing can be added to the restriction with one click; unmatched IDs remain visible as pricing gaps.

Administrators with `RELAY_CHANNEL_REVIEW` use the separate Channel Supply Review page for initial submissions and change requests. Multiplier, provider shares, and settlement modes are saved through a separate configuration action.

## Earnings and settlement

Earnings are created only from an amount actually debited from a consumer balance. Failed requests, zero charges, and fully covered monthly-pass usage create no earnings. When a pass covers only part of a request, only the remaining debit is shared. Each earning preserves the channel, provider, and percentage snapshot from when the debit occurred, so later edits never rewrite history.

Providers can use real-time, every-N-days, daily-at-a-fixed-time, or manual settlement. Real-time earnings enter spendable balance directly. Scheduled settlement uses the server's Asia/Shanghai time zone. Manual providers use Transfer to balance on this page. The transfer creates a separate commission transaction in spendable balance; it is not treated as a recharge.

A channel can have several providers. Each provider can receive 0% through 100%, while the total is allowed to exceed 100%. The platform subsidizes the excess, and the channel editor shows the total plus the platform remainder or subsidy.

## Related pages

- `relay-settings`
- `balance-history`
