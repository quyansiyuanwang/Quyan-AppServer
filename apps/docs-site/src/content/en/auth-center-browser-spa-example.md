# Auth Center browser integration

A browser application cannot keep a client secret confidential. Register it as a public client and use authorization code with PKCE (S256). This guide describes the integration boundary; the Auth Center authorization APIs must be called by an authorization interface with a signed-in platform identity.

## Before you begin

1. Create a public client in [Auth Center application management]({{DOCS_BASE_URL}}/en/auth-center-client-management), enable `authorization_code`, register the exact callback URI and required scopes, and confirm that the client is approved and enabled. Public authorization-code clients must use PKCE. Enable `refresh_token` if needed; public clients cannot enable `client_credentials`.
2. Confirm the Auth Center authorization interface provided by your deployment. `GET /v1/auth-center/authorize` is an authenticated authorization-preview API, not a page to open directly in the browser. The built-in OAuth authorization page uses separate OAuth APIs.
3. Plan your own backend and session storage: keep Auth Center tokens on the trusted backend, and give the browser only your application's session identifier.

This guide uses a browser plus trusted backend. It does not provide a ready-to-deploy browser-only login application. If your deployment supplies no Auth Center authorization interface, implement that interface first. An Auth Center Client ID cannot simply be used with the built-in OAuth authorization page. Discovery metadata does not create an interactive login page.

## Distinguish the authorization interface from APIs

These paths are relative to the deployment's API root. The authorization interface displays the application and scopes, obtains explicit approval or denial, then handles the returned callback URL.

| API                                         | Caller and result                                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/auth-center/authorize`             | The authorization interface uses a signed-in platform identity to load a preview. Success uses `{ code, message, data }`.                                                    |
| `POST /v1/auth-center/authorize`            | The interface submits the same authorization parameters plus `approve`. Success returns the callback URL in `data.redirectTo`; the API does not itself redirect the browser. |
| `POST /v1/auth-center/token`                | The trusted application backend exchanges a code or refresh token. Success returns the token object directly, without a `data` wrapper.                                      |
| `GET /v1/auth-center/.well-known/jwks.json` | The trusted backend retrieves verification keys from `data.keys` in the success response.                                                                                    |

Preview and consent decisions require a platform login. IAM enforcement additionally requires `quyan:auth_center:GetAuthorizationPreview` and `quyan:auth_center:DecideAuthorization`, respectively. A Client ID, authorization code, or Auth Center access token does not replace that platform identity.

## Start authorization and handle the callback

1. Generate an unpredictable `state` and PKCE verifier for each authorization, then derive the S256 challenge. Keep `state` and the verifier in the current authorization session; do not share them across users or browser sessions.
2. Start authorization through the deployment's interface with `response_type=code`, the Client ID, registered callback URI, scopes, `state`, `code_challenge`, and `code_challenge_method=S256`. Do not omit the method: the server defaults to `plain`, which does not match an S256 challenge. List required scopes explicitly; omitting them uses all scopes configured for the client. After the user signs in and consents, the interface handles the returned callback URL.
3. **Before** exchanging the code, compare the returned `state` with the value saved for that session. Stop and restart if it is missing, mismatched, or expired. Use the verifier from the same authorization attempt and clear temporary data after processing.
4. Have the trusted backend call `POST /v1/auth-center/token` with the code, Client ID, exact callback URI, and `code_verifier`. Public clients omit the client secret. Keep the token response on the backend; do not return or log the refresh token.
5. Follow the [token verification guide]({{DOCS_BASE_URL}}/en/auth-center-node-sdk) to validate signature, issuer, audience, expiry, token use, and required scopes before creating your own application session. Reuse its verification functions, but omit `client_secret` when exchanging for this public client; do not copy the confidential-client registration requirements. Use `HttpOnly`, `Secure`, and an appropriate `SameSite` cookie policy, together with server-side CSRF protection.

Authorization codes expire after five minutes and are single-use. Successful refresh rotates the refresh token. After a network failure, do not assume the server did not process the request; authorize again if the new token cannot be recovered. A refresh token is returned only when the client has enabled the refresh grant.

Denial returns `error=access_denied` and the original `state` to the callback without a code. Validate `state`, show the cancellation result, and clear the temporary session without exchanging tokens. Even for previous consent, `requireConsent=false` in a preview is not a new code; complete the authorization-decision step. Approval fails if requested scopes are currently unavailable for that user.

## Session and sign-out boundaries

Local verification does not query remote revocation, user status, or client disablement. Your application session also does not automatically end when the user signs out of the platform. Manage session lifetime, sign-out, token storage, and revocation in your backend, and recheck returned scopes after refreshing. Decoding a JWT alone must not create a browser login session.

Codes in callback URLs are temporary. After processing, clear the URL and temporary authorization session to avoid repeated exchange. Use preconfirmed deployment settings for the issuer and JWKS address; do not select a trusted issuer from unverified token contents.

## Troubleshooting

- **Authorization preview returns 401 or 403**: confirm the authorization interface has a valid platform login and permissions, and the application is approved.
- **Callback rejected**: check that the callback URI exactly matches the registered value and the session's `state` is still valid.
- **Token exchange fails**: confirm the PKCE verifier matches the original challenge and the authorization code has not expired or already been used.
- **Token verification fails**: check the deployment's JWKS, configured issuer, Client ID, and required scopes. Parsing JWT contents alone does not establish authorization.

## Related documentation

- [Auth Center integration]({{DOCS_BASE_URL}}/en/auth-center-app-management)
- [Auth Center Node SDK]({{DOCS_BASE_URL}}/en/auth-center-node-sdk)
- [Auth Center Python SDK]({{DOCS_BASE_URL}}/en/auth-center-python-sdk)
