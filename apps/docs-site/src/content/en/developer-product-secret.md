# Secret Vault

Secret Vault stores deployment-time credentials such as third-party API keys and webhook secrets. An alias is unique within an instance and its value is write-only: after creation or rotation, the Console shows only the alias, version, update time, and last-use time, never the plaintext.

## How it is used

Aliases must start with an uppercase letter and then contain only uppercase letters, digits, and underscores, for example `OPENAI_KEY`. Supported API-relay outbound requests can use `{{OPENAI_KEY}}` in request headers and JSON string values. Replacement happens immediately before the request leaves the platform; logs and errors retain only the alias.

Undefined aliases, malformed nested placeholders, and replacements that exceed request limits stop the request. URLs, paths, query parameters, and JSON object keys are not replacement targets in this initial release.

## Lifecycle and permissions

Creating or rotating needs Secret write, deletion needs Secret manage, and metadata listing needs Secret read. Deletion is permanent; downstream requests that still reference the alias are explicitly rejected. The platform encrypts ciphertext, IV, and authentication tag with a dedicated master key.
