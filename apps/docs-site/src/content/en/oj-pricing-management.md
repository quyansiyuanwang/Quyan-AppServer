# OJ pricing management

Use this page to maintain provider and model pricing used by OJ submitter workflows.

## Page purpose

- Add pricing records.
- Edit existing provider or model rates.
- Remove outdated pricing entries.
- Maintain multipliers for token-cost calculations.

## What you will see

### Pricing list

- Provider.
- Model.
- Input and output prices.
- Multiplier values.
- Cache-creation and cache-read multipliers.

### Management actions

- Add model pricing.
- Edit pricing.
- Delete pricing.

## Common actions

1. Add a pricing entry for a new provider or model.
2. Review all rate fields carefully before saving.
3. Update multipliers when billing logic changes.
4. Delete obsolete entries only after confirming they are no longer referenced.

## What the multipliers mean

Each pricing record has three multipliers applied on top of the base input/output token price:

- **Multiplier** — a general adjustment applied to both input and output token costs (default `1.0`, i.e. no adjustment). Use this to mark a model up or down relative to its base rate.
- **Cache-creation multiplier** — applied to tokens written into the provider's prompt cache for the first time (default `1.25`, i.e. 25% more expensive than a normal input token). Creating a cache entry costs slightly more than a regular request.
- **Cache-read multiplier** — applied to tokens served from an existing prompt cache (default `0.1`, i.e. 90% cheaper than a normal input token). Reusing cached content is billed as substantially discounted.

A request's final cost is calculated as `input tokens x input price x multiplier + output tokens x output price x multiplier + cache-creation tokens x input price x cache-creation multiplier + cache-read tokens x input price x cache-read multiplier`.

## Notes

- Pricing changes can affect cost reporting and any user-visible estimates.
- Review usage statistics after large pricing updates to confirm outputs look reasonable.
- Permissions may restrict who can add or edit pricing.

## Related pages

- `oj-api-key-management`
- `oj-usage-statistics`
