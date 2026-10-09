# Secret Vault

Secret Vault stores deployment-time credentials such as third-party API keys and webhook secrets. An alias is unique within an instance and its value is write-only: after creation or rotation, the Console shows only the alias, version, update time, and last-use time, never the plaintext.

## How it is used

Aliases must start with an uppercase letter and then contain only uppercase letters, digits, and underscores, for example `OPENAI_KEY`. Supported API-relay outbound requests can use `{{OPENAI_KEY}}` in request headers and JSON string values. Replacement happens immediately before the request leaves the platform; logs and errors retain only the alias.

Undefined aliases, malformed nested placeholders, and replacements that exceed request limits stop the request. URLs, paths, query parameters, and JSON object keys are not replacement targets in this initial release.

## Lifecycle and permissions

Creating or rotating needs Secret write, deletion needs Secret manage, and metadata listing needs Secret read. Deletion is permanent; downstream requests that still reference the alias are explicitly rejected. The platform encrypts ciphertext, IV, and authentication tag with a dedicated master key.

## JWT project management

Project Secret management grants `quyan:developer:ListSecrets`, `PutSecret`, and `DeleteSecret` on `acs:developer:*:<accountId>:secret/<projectId>/<ALIAS>`. Creation, rotation, and deletion check the operation and exact alias; same-account delegation preserves the project owner. Project grants do not automatically cover all aliases.

`GET /v1/developer/projects/{projectId}/secrets/page` accepts page/pageSize and returns alias-filtered items, page, pageSize, and hasNext. Empty pages may have a next page, with no total. In enforce, the old array endpoint returns only the default first page. Returned resourceArn values can be copied into policies, and every response contains metadata only. See [RAM management](./ram-management) for authorization and resource-group rules.
