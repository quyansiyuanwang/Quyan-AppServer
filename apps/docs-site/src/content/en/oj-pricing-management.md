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

## IAM pricing read access

With IAM enforcement, management reads require `OJ_PRICING_READ` eligibility in a real deployment-wide group. Listing uses `quyan:oj:ListPricing` and details use `quyan:oj:GetPricing`. The resource is `acs:platform:*:platform:oj-pricing/<record-id>`, where the ID comes from the actual pricing record. Model names, including provider prefixes, locate records and never become ARN identifiers.

The list loads display prices only after each record is authorized. A matching Deny overrides Allow. Missing, deleted or unauthorized detail records return 403 in enforce mode. Price, qualification, policy or role-session changes during a read prevent returning the result. AssumeRole uses its role's grants. Internal billing calculations retain their existing pricing lookup flow.

## IAM pricing write permissions

Creating, updating, and deleting require eligibility from a real global group with `OJ_PRICING_UPDATE`, using `quyan:oj:CreatePricing`, `quyan:oj:UpdatePricing`, and `quyan:oj:DeletePricing` respectively. Creation checks both `acs:platform:*:platform:oj-pricing-control/default` and the actual new record ARN. Updates and deletions check the actual record ARN. Model names are lookup inputs and cannot change the authorization scope.

A matching Deny blocks the entire operation. If identity, eligibility, policies, role sessions, or the target price change before saving, the operation fails without partially saving price changes. Deleted models cannot be directly recreated. Missing or unauthorized mutation targets return 403 in IAM enforcement mode. Replay protection applies to all three write endpoints.

## Notes

- Pricing changes can affect cost reporting and any user-visible estimates.
- Review usage statistics after large pricing updates to confirm outputs look reasonable.
- Permissions may restrict who can add or edit pricing.

## Related pages

- [OJ API key management]({{DOCS_BASE_URL}}/en/oj-api-key-management)
- [OJ usage statistics]({{DOCS_BASE_URL}}/en/oj-usage-statistics)
