# Auth Center integration

Auth Center issues RS256-signed JWT access tokens to registered integrations. Your system verifies signatures and claims using trusted JWKS, then applies its own business authorization. To extend a user session, exchange a refresh token at Auth Center for new tokens.

## Choose an integration

| Scenario                                                    | Client and grant types                                             | Tokens                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Website with a trusted backend; user login or consent       | Confidential, `authorization_code`, optionally `refresh_token`     | User JWT; a refresh token is also issued when refresh grants are enabled |
| SPA, mobile app, or desktop app without safe secret storage | Public, `authorization_code` with PKCE, optionally `refresh_token` | User JWT; public clients have no Client Secret                           |
| Backend service or scheduled job without a user             | Confidential, `client_credentials`                                 | Application JWT, without a refresh token                                 |

Auth Center applications, credentials, and tokens are managed separately from [ordinary OAuth applications](/en/oauth-app-management). Auth Center JWTs are for integrations configured to verify them. Do not assume they replace platform login or ordinary OAuth tokens when calling platform business APIs.

## Prepare the integration

1. Create an application in [Auth Center app management](/en/auth-center-client-management). Configure client type, minimum grant types, scopes, callbacks, and token lifetimes.
2. Save a confidential application's Client Secret immediately after creation, then submit for review. Only `approved` applications can authorize, exchange, or refresh tokens.
3. Ask the deployment administrator for the actual API origin, exact issuer, JWKS URL, and authorization interface URL for user flows.
4. Define the Client ID, scopes, user or application identity, and post-revocation access controls your system accepts.

Auth Center authorization preview and decision are APIs requiring a platform login identity. The deployment must provide an authorization interface calling these APIs. The built-in `/oauth/authorize` page uses separate ordinary OAuth APIs and cannot serve directly as the Auth Center entry point.

## Authorize and obtain tokens

### User authorization-code flow

1. Generate random state and a PKCE verifier, then calculate an S256 challenge. PKCE is mandatory for public clients and recommended for confidential clients.
2. Send the user to the deployment's authorization interface with the Client ID, exact registered callback, requested scopes, state, and challenge.
3. The interface uses the user's platform login to request a preview and submit the user's explicit approval or denial. A successful response provides `redirectTo`; the interface performs the redirect.
4. At the callback, verify state for the same attempt, then send the code, callback, verifier, and client information to the token endpoint. Confidential clients include the secret; public clients omit it.
5. Verify the JWT before establishing your user session. Authorization codes expire after 5 minutes and cannot be reused after successful exchange. Restart authorization after failure or an uncertain outcome.

An application's allowed scope is not user consent. Consent and current grantable scopes are still checked. Denial returns callback error information instead of a code. Callback scheme, host, port, path, and trailing slash must match registration exactly.

### Machine-to-machine access

After a confidential application enables `client_credentials` and passes review, its server requests a token with the Client ID and Client Secret, optionally specifying space-separated scopes. The access token represents the application, not a signed-in end user. Request another token after expiry; do not use a refresh token.

### Refresh and revocation

Enabling `refresh_token` also requires `authorization_code`. Successful refresh issues new access and refresh tokens and revokes the refresh token used. Store the replacement securely and coordinate concurrent refreshes. Effective scopes remain limited by user consent and the application's current allowed scopes.

Use `POST /v1/auth-center/revoke` for an unneeded token, providing that token and the client's required authentication. Revocation targets the submitted token; revoking one access token does not revoke every refresh token. Complete necessary revocations before deleting an application.

## Endpoints and response formats

These paths are relative to the deployment's API origin. Confirm that the actual proxy paths are reachable first.

| Method and path                                        | Purpose                                  | Response and identity requirements                                                                                                      |
| ------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/auth-center/.well-known/openid-configuration` | Discovery information                    | Public read; business envelope `{ code, message, data }`                                                                                |
| `GET /v1/auth-center/.well-known/jwks.json`            | Verification keys                        | Public read; key set at `data.keys`                                                                                                     |
| `GET /v1/auth-center/authorize`                        | Authorization preview                    | Platform login and preview action authorization; business envelope                                                                      |
| `POST /v1/auth-center/authorize`                       | User decision                            | Platform login and decision action authorization; callback at `data.redirectTo`                                                         |
| `POST /v1/auth-center/token`                           | Code exchange, refresh, or machine grant | JSON request; successful raw response contains `access_token`, `token_type`, `expires_in`, `scope`, and `refresh_token` when applicable |
| `POST /v1/auth-center/revoke`                          | Revoke the specified token               | Client authentication; successful raw response is `{ revoked: true }`                                                                   |

Discovery constructs `authorization_endpoint`, `token_endpoint`, and `jwks_uri` from the configured issuer, which may differ from the public routes above. Have the administrator confirm proxy mappings. If those URLs are unreachable, use the supplied actual endpoints and configure JWT verification separately with the exact issuer supplied by the administrator. Resolve inconsistencies between discovery and issuance configuration instead of disabling issuer checks.

If a library requires raw JWKS, check HTTP status and numeric `code: 0`, then pass the key set in `data` to the verifier. For token responses, check HTTP success and valid token contents first. Failed responses may also contain fields such as `access_token`; their presence does not prove success. The discovery pathname does not imply ID Token issuance; current token responses do not contain `id_token`.

## Verify JWTs in your system

1. Fetch and cache JWKS from a preconfigured trusted URL and select the key matching the token header's `kid`. Refresh trusted keys for an unknown kid and reject the token if no match exists.
2. Allow only RS256 and verify the signature, expiry, exact issuer, and expected audience. The audience is the issuing application's public Client ID; do not choose it directly from requester input.
3. Require `token_use: access_token` and check scopes, grant type, and identity as needed. User flows use the user ID as `sub` and include `uid`. Machine flows use the Client ID as `sub` and do not contain a user identity.
4. Apply your own permissions using the verified identity. Decoding a JWT or verifying its signature does not grant every business operation.

Local verification alone cannot immediately detect server-side token revocation, application deletion, or account suspension. Choose lifetimes and additional access controls appropriate to the risk. Secret rotation, application deletion, and signing out of the console do not guarantee that every local verifier immediately rejects old JWTs.

## Troubleshooting

| Symptom                                               | What to check                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Discovery data cannot be passed to a standard library | Extract `data` from the business envelope and confirm discovered URLs are reachable through the deployment proxy |
| Authorization URL returns JSON or a sign-in error     | It is an API; use the deployment's authorization interface and platform login identity                           |
| Exchange or refresh is denied                         | Check approval, allowed grants, secret, callback, PKCE, and whether the code or token is used or expired         |
| Signature, issuer, or audience validation fails       | Check trusted JWKS, kid, RS256, exact issuer, and your Client ID; do not skip failed checks                      |
| Machine token has no refresh token                    | `client_credentials` issues access tokens only; request another after expiry                                     |
| A revoked JWT still works in an integration           | Local verification does not read server-side revocation state; review lifetime and integration access controls   |

## Related documentation

- [Auth Center app management](/en/auth-center-client-management)
- [Auth Center app review](/en/auth-center-client-review-management)
- [Node.js integration example](/en/auth-center-node-sdk)
- [Python integration example](/en/auth-center-python-sdk)
- [Browser SPA example](/en/auth-center-browser-spa-example)
- [API documentation](/en/api-documentation)
