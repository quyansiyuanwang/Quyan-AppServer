# OJ pricing management

Use OJ pricing management to maintain model rates and cache multipliers for the submitter. Pricing is shared across the deployment by model. Changes affect later requests using that pricing. Provider is descriptive; it does not configure upstream credentials or enable a model automatically.

## Prerequisites

Open OJ pricing management. Reads require `OJ_PRICING_READ`; creation, editing, and deletion require `OJ_PRICING_UPDATE`. IAM enforcement also checks separate resource actions. Writes require replay protection.

The list shows model, provider, input and output prices, the overall multiplier, and cache creation/read multipliers, newest creation first. There is no search, pagination, import, export, or automatic refresh. Reopen the page to load current data.

## Add model pricing

1. Choose Add Model.
2. Enter the exact model name sent by the submitter, with an optional provider.
3. Check input/output prices and all three multipliers, then save.
4. Verify the entry and check charges using a real request and [Usage statistics]({{DOCS_BASE_URL}}/en/oj-usage-statistics).

Model names must contain 1–200 characters after trimming; providers allow up to 100 characters. Input/output prices must be nonnegative, and each multiplier ranges from 0 to 100. Page number controls use two decimal places.

New forms default input and output prices to 0, the overall multiplier to 1, cache creation to 1.25, and cache read to 0.1. Check these initial values against your intended charging rules rather than treating a new form as a correct quote.

Pricing uses exact model lookup. Filling in Provider does not add or strip a prefix. Billing uses the client's requested model name; channel mapping to another upstream model does not automatically select that model's pricing. Requests fail without an active pricing entry. Creating pricing alone does not establish that a channel supports the model.

## Understand prices and multipliers

**Input/output prices are calculated in qu per million tokens. Enter prices per million tokens.**

| Parameter                 | Effect                                         | New-form default |
| ------------------------- | ---------------------------------------------- | ---------------- |
| Overall multiplier        | Adjusts ordinary input and output token costs  | 1                |
| Cache creation multiplier | Applies to cache creation tokens × input price | 1.25             |
| Cache read multiplier     | Applies to cache read tokens × input price     | 0.1              |

The request cost is the sum below, rounded down to four decimal places.

```text
(input tokens × input price × overall multiplier
 + output tokens × output price × overall multiplier
 + cache creation tokens × input price × cache creation multiplier
 + cache read tokens × input price × cache read multiplier) / 1,000,000
```

Cache costs do not also use the overall multiplier. Setting the overall multiplier to 0 does not guarantee zero cost for a request with cache usage. Check both cache multipliers separately. Counts come from upstream usage fields. The usage page's total tokens includes input plus output without listing cache tokens separately.

For calculation only: input price 2, output price 8, overall multiplier 1.5, input 1,000 tokens, output 200 tokens, cache creation 400 tokens, and cache reads 600 tokens. With default cache multipliers, the result is 0.00652 qu and the saved cost is 0.0065 qu. These are illustrative values, not current rates.

Requests use pricing read when they start. Saved historical usage retains its original cost and is not recalculated after edits. Even zero-cost pricing does not remove other OJ conditions, such as a positive balance; a zero price alone does not establish that a call will succeed.

## Edit pricing

1. Choose Edit on the target model.
2. Check every price and multiplier, make changes, and save.
3. Query again and verify the entry and charges for new requests.

The model name cannot be changed in the editor. Leaving Provider blank retains its previous value. To clear it, an integration with update access can explicitly submit an empty string through the update API and verify the result.

The editor uses all rates loaded in the list and submits those values. Reload after another administrator changes pricing to avoid overwriting new rates. Failed saves retain input. Closing or reopening does not establish that input was saved. There is no autosave, approval, scheduled activation, or historical-price rollback.

## Delete pricing

Choose Delete and confirm to stop using the entry as active model pricing. Existing usage records remain, but new requests can fail because pricing is missing.

**Deleted models cannot simply be added again, and the page has no restore action.** Edit existing entries to adjust charges rather than deleting and recreating the same model. If creation reports a duplicate absent from your list, a deleted record may retain the model name or authorization may hide an existing entry. Ask an appropriate administrator to check.

## IAM resource scope

With IAM enforcement, reads require `OJ_PRICING_READ` eligibility in a real deployment-wide group; writes require `OJ_PRICING_UPDATE`. Individual additions or a policy Allow alone cannot replace that group eligibility.

| Operation | IAM action               | Resource                        |
| --------- | ------------------------ | ------------------------------- |
| List      | `quyan:oj:ListPricing`   | Each actual pricing record      |
| Details   | `quyan:oj:GetPricing`    | Target record                   |
| Create    | `quyan:oj:CreatePricing` | Control resource and new record |
| Edit      | `quyan:oj:UpdatePricing` | Target record                   |
| Delete    | `quyan:oj:DeletePricing` | Target record                   |

Records use `acs:platform:*:platform:oj-pricing/<record-id>`; creation also uses `acs:platform:*:platform:oj-pricing-control/default`. Model and provider names do not replace actual record IDs as authorization resources.

The list returns allowed records only. List access does not grant detail or mutation access. Missing, deleted, or unauthorized detail/mutation targets return 403 in enforce mode. Management APIs do not accept OAuth access tokens. Role sessions use role grants, and matching Deny takes priority. Changed grants, identity, or pricing during an operation can cause failure; writes do not partially save. Internal request billing still looks up active model pricing independently of an administrator's list visibility.

## Troubleshooting

| Symptom                                                              | What to do                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Old rates remain after a list-loading error                          | Reopen and verify current values before editing                                     |
| Save succeeds but loading then fails                                 | The write may have completed. Query again before creating duplicates or overwriting |
| Edit/Delete is visible but denied                                    | Check the action, global-group eligibility, and record grant                        |
| Cache costs do not change proportionally with the overall multiplier | Cache costs use independent multipliers; check the full formula                     |
| Historical costs remain unchanged after edits                        | History retains original charges; verify using new requests                         |

## Related pages

- [OJ API Key management]({{DOCS_BASE_URL}}/en/oj-api-key-management)
- [OJ usage statistics]({{DOCS_BASE_URL}}/en/oj-usage-statistics)
