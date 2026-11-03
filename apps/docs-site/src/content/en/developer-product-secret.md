# Secret Vault

Secret Vault stores third-party API keys, webhook credentials, and similar values for supported platform features to reference by alias. The console and management APIs return only metadata such as alias, version, and timestamps; they do not read back plaintext. Currently, [Push Aggregation]({{DOCS_BASE_URL}}/en/developer-product-push) can use a vault secret as a channel's Bearer credential.

## Prerequisites

Create an enabled Secret Vault instance and ask the administrator to configure vault encryption. Without that configuration, metadata may still be visible while writing or using secrets fails. See [Developer products overview]({{DOCS_BASE_URL}}/en/developer-products-overview) for instance management.

| Operation                                  | Product permission                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| View aliases, versions, and last-use times | `product:secret:read`                                                                     |
| Add a secret or rotate its value           | `product:secret:write`                                                                    |
| Bind a secret to a supported feature       | `product:secret:use`, plus that feature's configuration and required metadata permissions |
| Delete a secret                            | `product:secret:manage`                                                                   |

Metadata access does not grant use, rotation, or deletion. These management operations use a sign-in session. Product API keys do not provide a general plaintext secret retrieval API.

## Write a secret

1. Open the Secret Vault product console and the target instance's details.
2. Select Write secret and enter an alias and value.
3. Check the instance and alias, then select Save. After success, check the alias and version in the list.

| Field | Requirement                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alias | 1–100 characters, starting with an uppercase English letter, followed only by uppercase letters, digits, and underscores, such as `WEBHOOK_TOKEN` |
| Value | 1–20,000 characters, saved as entered without trimming leading or trailing whitespace                                                             |

The console converts aliases to uppercase. Writing an existing alias replaces its value and increases the version without an additional overwrite confirmation. Check the alias before saving to avoid accidental replacement. Save results contain no plaintext value; preserve the original source in your own credential management process if needed.

The list is sorted by alias, without pagination or polling. The top-level refresh reloads only instances. Close and reopen instance details to reload secret metadata.

## Rotate and delete

Select Rotate for an alias, enter a new value, and save. Rotation cannot change the alias and does not read the previous value. The first write has version 1; overwrites and rotations increment it and clear last-use time. There is no historical-version viewer or rollback. Restoring a previous credential requires writing the old value from your own records again.

References identify an alias rather than a fixed version. After rotation, subsequent channel uses read the new value; an in-progress delivery may still use a value read earlier. Have the recipient accept the new credential first, then rotate and test dependent channels. Updating the vault does not create or revoke credentials at the third-party service.

Deletion requires confirmation and is permanent. Remove or change channel references first, or later uses of the alias will fail. Disabling or deleting the whole vault instance also makes references unavailable. If you later write the same alias again, retained references may use the newly written value; this is not historical version recovery.

## Reference a secret in a push channel

1. In Push Aggregation channel configuration, select a vault instance with the same storage owner as the push resources.
2. Select an alias, or write a secret through the channel form if you have write permission.
3. Save the channel, send a test message, and inspect each channel's actual delivery result.

At delivery time, the platform reads the value and sends it to the channel endpoint as `Authorization: Bearer ...`. Bind secrets only to endpoints you trust. A user able to configure channels with a secret reference can use that credential, even without reading it back; grant access accordingly.

Instance and alias selection, writing values, and saving channels involve separate permissions. In IAM enforcement mode, the project-management API requires `quyan:developer:UseSecret` for the exact alias when saving a reference. The product console also checks read and use eligibility for the selected vault instance. See [Push Aggregation]({{DOCS_BASE_URL}}/en/developer-product-push) for full prerequisites.

## Interpret last-use time

Last-use time helps indicate whether the platform recently read a secret; it does not prove successful message delivery. Creating or editing a referenced push channel through the product console also reads the secret to validate the reference. A time may therefore appear before any message is sent. In IAM enforcement mode, the project-management API checks reference metadata only and does not update last-use time for that check.

Delivery can still fail after reading the secret. Treat timestamp updates as a hint rather than a complete audit trail. Rotation clears the timestamp, so Never used does not establish that the alias has never been used historically. Check send results and available delivery logs to establish delivery outcomes.

Writing, rotating, and listing metadata do not use the product call metering API. Pushes using a secret follow the push product's current quota and charging rules; see the Push Aggregation guide.

## Project management API and authorization scope

Management APIs return no secret values. Administrators can grant `quyan:developer:ListSecrets`, `PutSecret`, `DeleteSecret`, and reference-related `UseSecret` separately per alias. Project grants do not automatically cover all aliases. Alias resources use `acs:developer:*:<accountId>:secret/<projectId>/<ALIAS>`; prefer `resourceArn` from project-management responses when configuring policies.

The instance console's `GET /v1/products/secret/instances/{instanceId}/secrets` checks `ListSecrets` on the backing project and returns instance metadata without per-alias filtering.

For a granular list, use `GET /v1/developer/projects/{projectId}/secrets/page`. It accepts `page` and `pageSize`, returning `items`, `page`, `pageSize`, and `hasNext`, without `total`. IAM enforcement mode filters per alias. Empty pages can still have subsequent pages; follow `hasNext`. In enforcement mode, the old array endpoint returns only the default first page. See [RAM management]({{DOCS_BASE_URL}}/en/ram-management) for policy rules.

## Troubleshooting

| Symptom                                                 | Action                                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vault is not configured                                 | Ask an administrator to configure a dedicated encryption master key; ordinary users do not enter or obtain that key                                                            |
| Invalid alias                                           | Start with an uppercase letter, use allowed characters, and check the normalized alias                                                                                         |
| Write succeeds but the value cannot be viewed           | Expected behavior; test through a channel that uses the credential if needed                                                                                                   |
| A list remains after loading fails                      | It may be a previous result, including another instance's data; select Retry in the error and wait for success before acting                                                   |
| Rotation or deletion succeeds but the list is unchanged | The follow-up refresh may have failed; retry and check alias/version before repeating rotation                                                                                 |
| Channel reference is unavailable or delivery fails      | Check that the vault instance is enabled, the alias exists, use is authorized, and the endpoint accepts the current credential                                                 |
| Metadata loads but secret use cannot decrypt            | Ask an administrator to check encryption configuration; existing secrets depend on the original master key, and changing configuration alone does not re-encrypt existing data |
