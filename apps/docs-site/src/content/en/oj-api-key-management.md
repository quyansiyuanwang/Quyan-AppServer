# OJ API key management

Use this page to maintain API keys for OJ submitter workflows.

## Page purpose

- Create and manage OJ submitter API keys.
- Review channel binding and usage.
- Create a replacement key and delete the old one when changing credentials.

## What you will see

### Key list

- Key name.
- Masked key display; copying is available only when the API returns the credential.
- Bound channel.
- Request count and total tokens.
- Last-used time and expiry.

### Management actions

- Create key.
- Edit key.
- Copy key.
- Delete key.

## Common actions

1. Create a key with a name that identifies the submitter or scenario.
2. Copy the key immediately after creation and store it securely.
3. Check bound channel and expiry before troubleshooting failed requests.
4. To replace a credential, create and save a new key, update the submitter configuration, and confirm it works before deleting the old key. Deletion requires step-up verification; the old key then stops working.

## Notes

- In IAM enforcement mode, reading key metadata and revealing its credential are separate permissions. Without `quyan:oj:RevealApiKey`, creation or list responses may omit the key and the page cannot copy it. With reveal permission, the list can return the credential again, so restrict access carefully.
- OJ API keys are separate from general account access keys.
- Usage anomalies are easier to investigate with the usage-statistics page.

## Related pages

- [OJ usage statistics]({{DOCS_BASE_URL}}/en/oj-usage-statistics)
- [OJ pricing management]({{DOCS_BASE_URL}}/en/oj-pricing-management)
