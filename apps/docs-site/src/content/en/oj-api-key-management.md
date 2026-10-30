# OJ API key management

OJ API keys let submitters call the OJ question-answering API and settle charges against the key owner's balance. This page manages the signed-in user's own keys. OJ keys do not manage other users, sign in to the console, or replace account access keys or relay tokens.

## Prerequisites

Opening the page requires `OJ_APIKEY_READ`. Creating, editing, and deleting require `OJ_APIKEY_CREATE`, `OJ_APIKEY_UPDATE`, and `OJ_APIKEY_DELETE`, respectively. IAM enforcement checks the actions and resources below separately; visible buttons do not guarantee access.

Creation and deletion require the prompted step-up verification and request protection. A bound channel must currently be available to the user. Channel choices also have separate read authorization; a successful key-list query does not establish that the channel selector loaded successfully.

## Create and save a key

1. Choose Create API Key and enter a recognizable name of up to 100 characters.
2. Optionally select an expiry and channel. A blank expiry means no expiration. If setting an expiry, choose a future time.
3. Confirm and complete the required verification.
4. Copy the new credential from the success dialog into the submitter's secure configuration. If copying fails, select the read-only text field manually.
5. Verify with a real request, then check expiry, channel, and usage in the list.

**Successful creation returns the newly generated credential. Reading an existing credential again requires separate reveal permission.** Do not assume you can copy it after closing the dialog, or that a user with management grants cannot obtain keys they create. If the success field is unexpectedly empty, check the creation result before creating more keys; never use an empty value as a credential.

Without a channel selection, requests use the deployment's default upstream configuration. Selecting a channel does not enable every model: requests need active pricing, enough balance, and an available upstream. Candidates from a bound channel or pool must also support Anthropic format and allow the requested model. Hidden channels and automatic proxy pools cannot be bound directly for this business use.

## Use the key in a submitter

Configure the submitter with the API base address and new key. Use the service address for the OJ API; do not substitute the management-site address or Relay Base URL. Set the variables below to actual values and replace the model with one priced and available in your deployment.

```bash
curl "${API_BASE_URL}/v1/products/oj-submitter/ask" \
  -H "X-API-Key: ${OJ_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"question":"Explain how to solve this problem","model":"your-enabled-model","maxTokens":256}'
```

Questions must contain 1–10,000 characters after trimming. Optional `maxTokens` limits output, ranges from 1 to 32,000, and defaults to 4,096. Success returns the answer, token count, and cost. Calls incur charges using the model rates in [OJ pricing management]({{DOCS_BASE_URL}}/en/oj-pricing-management). A failed balance check or final settlement does not return a successful result.

## View and edit keys

The list shows name, masked credential, bound channel, cumulative requests and tokens, last-used time, and expiry. Expired keys can remain listed. There is no search, pagination, bulk export, or automatic refresh; reopen the page to update the list.

Copy Key copies the complete credential rather than the displayed mask. The list copy button appears only when the response includes a credential. Reveal permission can let the list return full keys again; masking the display does not replace reveal authorization.

Editing starts from loaded list values without fetching details first. Check these differences before saving:

| Field   | Save behavior                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------- |
| Name    | A new name renames the key; leaving it blank retains the old name                                     |
| Expiry  | Clearing removes the existing expiry instead of preserving it                                         |
| Channel | Clearing or selecting the default channel removes the binding and uses default upstream configuration |

Saving submits both expiry and channel. Reload after another operator changes the entry to avoid overwriting new configuration with old values. Editing neither generates a new credential nor resets usage. Failed creation/editing retains form input; closing the dialog clears the form. There is no autosave.

## Replace or delete a credential

1. Create and securely save a replacement key.
2. Update the submitter and confirm the new key works.
3. Choose Delete on the old key, verify the target, confirm, and complete the required verification.
4. Query again to confirm the old key is no longer listed.

Deleted keys fail new credential checks, and there is no restore or undo action. Do not rely on deletion to cancel requests already started. Clearing expiry does not revoke a key. Deletion also does not erase settled usage or refund historical charges.

Expiration rejects subsequent checks without automatically removing the management entry. Update expiry to continue using the same credential, or create a new key to replace it.

## Usage and IAM scope

Request count, cumulative tokens, and last-used time update after successful settlement rather than on every attempt. Tokens are input plus output, without a separate cache count. Use [OJ usage statistics]({{DOCS_BASE_URL}}/en/oj-usage-statistics) to check dated records and costs; it cannot attribute individual records to a key.

With IAM enforcement, operations have independent authorization and manage only the current user's keys. A wider resource pattern does not bypass ownership checks.

| Operation                     | IAM action                | Resource                                             |
| ----------------------------- | ------------------------- | ---------------------------------------------------- |
| Create                        | `quyan:oj:CreateApiKey`   | Current user                                         |
| List                          | `quyan:oj:ListApiKeys`    | Each actual key                                      |
| Details                       | `quyan:oj:GetApiKey`      | Target key                                           |
| Reveal an existing credential | `quyan:oj:RevealApiKey`   | Target key, with the corresponding read also allowed |
| Edit                          | `quyan:oj:UpdateApiKey`   | Target key                                           |
| Delete                        | `quyan:oj:DeleteApiKey`   | Target key                                           |
| Statistics API                | `quyan:oj:GetApiKeyStats` | Each included key                                    |

The user resource is `acs:quyan:*:<account-id>:user/<user-id>`; a key uses `acs:oj:*:<account-id>:api-key/<user-id>/<key-id>`. The account ID belongs to the account owner. Key ID means the record ID, not the full credential.

Lists return allowed records only. Detail access does not replace list access, and metadata reads do not automatically grant reveal access. Returning an existing credential after editing also requires reveal permission; returning a new credential on creation is part of issuance. The statistics API sums only allowed, undeleted keys. Its totals can decrease after deletion or authorization changes and are not a complete historical bill. The page does not display these aggregate cards.

Management APIs use login authentication and do not accept third-party OAuth access tokens. Role sessions use role grants; matching Deny takes priority. Changes to enabled status, identity, authorization, or the target during an operation can cause rejection. Missing, deleted, or unauthorized targets are denied in enforce mode. Changing the URL ID cannot manage someone else's key.

## Troubleshooting

| Symptom                                                  | What to do                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Key metadata is visible without a copy button            | Check existing-credential reveal access; the mask cannot reconstruct the key                      |
| A new key is missing from the list                       | Check list grants and query again before creating another key                                     |
| Channel options are empty or fail to load                | Reopen and check independent channel read grants and availability                                 |
| The credential stays unchanged after editing             | Editing updates name, expiry, and channel only; create a key to rotate credentials                |
| Saving or deleting succeeds, followed by a loading error | The write may have completed. Query before retrying it                                            |
| An old list remains after a loading error                | Previous results are retained. Reload successfully before acting                                  |
| A key cannot call the API                                | Check the full credential, expiry, balance, model pricing, channel format, and model restrictions |

## Related pages

- [OJ usage statistics]({{DOCS_BASE_URL}}/en/oj-usage-statistics)
- [OJ pricing management]({{DOCS_BASE_URL}}/en/oj-pricing-management)
- [Account access key management]({{DOCS_BASE_URL}}/en/access-key-management)
