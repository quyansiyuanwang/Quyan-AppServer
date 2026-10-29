# Secret Vault

Secret Vault stores deployment-time credentials such as third-party API keys and webhook secrets. An alias is unique within an instance and its value is write-only: after creation or rotation, the Console list shows only the alias, version, and last-use time, never the plaintext.

## How it is used

Aliases must be 1–100 characters, start with an uppercase letter, and then contain only uppercase letters, digits, and underscores, for example `OPENAI_KEY`. Secret values must be 1–20,000 characters. When configuring a channel in [Push Aggregation]({{DOCS_BASE_URL}}/en/developer-product-push), select a Secret Vault instance and alias belonging to the same storage owner. During delivery, the platform reads the secret and sends it to the channel endpoint as a Bearer credential; bind it only to an endpoint you trust. Configuring the reference may also require separate permission to use the secret; see the Push Aggregation guide.

## Manage secrets in the console

Open a Secret Vault instance, select Write secret, enter an alias and value, and save. Writing an existing alias replaces its value and increments the version; first make sure dependent services are ready to use the new credential. You can also select Rotate in the list and save a new value under the same alias. The old value cannot be retrieved from the console.

Deletion requires confirmation. Before deleting, check whether any channels reference the alias.

## Lifecycle and permissions

Creating or rotating needs Secret write, deletion needs Secret manage, and metadata listing needs Secret read. Deletion is permanent; subsequent deliveries fail if a push channel still references the alias. The platform encrypts the secret using a dedicated master key and stores the ciphertext, IV, and authentication tag.

## JWT project management

Project Secret management grants `quyan:developer:ListSecrets`, `PutSecret`, and `DeleteSecret` on `acs:developer:*:<accountId>:secret/<projectId>/<ALIAS>`. Creation, rotation, and deletion check the operation and exact alias; same-account delegation preserves the project owner. Project grants do not automatically cover all aliases.

`GET /v1/developer/projects/{projectId}/secrets/page` accepts page/pageSize and returns alias-filtered items, page, pageSize, and hasNext. Empty pages may have a next page, with no total. In enforce, the old array endpoint returns only the default first page. Returned resourceArn values can be copied into policies, and every response contains metadata only. See [RAM management](./ram-management) for authorization and resource-group rules.
