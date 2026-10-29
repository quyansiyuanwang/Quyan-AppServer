# Secret Vault

Secret Vault stores deployment-time credentials such as third-party API keys and webhook secrets. An alias is unique within an instance and its value is write-only: after creation or rotation, the Console list shows only the alias, version, and last-use time, never the plaintext.

## How it is used

Aliases must be 1–100 characters, start with an uppercase letter, and then contain only uppercase letters, digits, and underscores, for example `OPENAI_KEY`. Secret values must be 1–20,000 characters. When configuring a channel in [Push Aggregation]({{DOCS_BASE_URL}}/en/developer-product-push), select a Secret Vault instance and alias belonging to the same storage owner. During delivery, the platform reads the secret and sends it to the channel endpoint as a Bearer credential; bind it only to an endpoint you trust. Configuring the reference may also require separate permission to use the secret; see the Push Aggregation guide.

## Manage secrets in the console

Open a Secret Vault instance, select Write secret, enter an alias and value, and save. The console converts aliases to uppercase as you type; check the alias before saving, since inputs differing only in case can identify the same secret. Writing an existing alias replaces its value, increments the version, and clears its last-use time; first make sure dependent services are ready to use the new credential. You can also select Rotate in the list and save a new value under the same alias. The old value cannot be retrieved from the console.

Deletion requires confirmation. Before deleting, check whether any channels reference the alias.

Last-use time reflects when the platform read the secret, not whether a push was delivered successfully. When a push channel is created or edited through the product console with a secret reference, the platform also reads the secret to check the reference, which may update last-use time. In IAM enforcement mode, the JWT project-management API checks only reference metadata and does not update that time for this check. A delivery can still fail after the secret is read. To check delivery, inspect the channel statuses in the send result and any delivery logs available to you.

If the list fails to load, it may still show the previous list, including after switching instances; an empty list does not establish that the current instance has no secrets. Select Retry in the error message and wait for a successful load before acting. Refresh can also fail after writing, rotating, or deleting a secret, even if a success message appears. Retry and check the alias and version before repeating the operation. Secret values cannot be read back; verify the credential through a channel that uses it if needed.

## Lifecycle and permissions

Creating or rotating needs Secret write, deletion needs Secret manage, and metadata listing needs Secret read. Deletion is permanent; subsequent deliveries fail if a push channel still references the alias. The platform encrypts the secret using a dedicated master key and stores the ciphertext, IV, and authentication tag.

## JWT project management

Project Secret management grants `quyan:developer:ListSecrets`, `PutSecret`, and `DeleteSecret` on `acs:developer:*:<accountId>:secret/<projectId>/<ALIAS>`. Creation, rotation, and deletion check the operation and exact alias; same-account delegation preserves the project owner. Project grants do not automatically cover all aliases.

`GET /v1/developer/projects/{projectId}/secrets/page` accepts page/pageSize and returns alias-filtered items, page, pageSize, and hasNext. Empty pages may have a next page, with no total. In enforce, the old array endpoint returns only the default first page. Returned resourceArn values can be copied into policies, and every response contains metadata only. See [RAM management]({{DOCS_BASE_URL}}/en/ram-management) for authorization and resource-group rules.
