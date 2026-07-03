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

## Notes

- Pricing changes can affect cost reporting and any user-visible estimates.
- Review usage statistics after large pricing updates to confirm outputs look reasonable.
- Permissions may restrict who can add or edit pricing.

## Related pages

- `oj-api-key-management`
- `oj-usage-statistics`
