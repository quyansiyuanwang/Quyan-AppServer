# Auth Center browser integration

A browser application cannot keep a client secret confidential. Register it as a public client and use authorization code with PKCE (S256). This guide describes the integration boundary; the Auth Center authorization APIs must be called by an authorization interface with a signed-in platform identity.

## Before you begin

1. Create a public client in [Auth Center application management](/en/auth-center-client-management), enable `authorization_code`, register the exact callback URI and required scopes, and submit it for review.
2. Confirm the Auth Center authorization interface provided by your deployment. `GET /v1/auth-center/authorize` is an authenticated authorization-preview API, not a page to open directly in the browser. The built-in OAuth authorization page uses separate OAuth APIs.
3. Plan your own backend and session storage: keep Auth Center tokens on the trusted backend, and give the browser only your application's session identifier.

## Start authorization and handle the callback

1. Generate an unpredictable `state` and PKCE verifier for each authorization, then derive the S256 challenge. Keep `state` and the verifier in the current authorization session; do not share them across users or browser sessions.
2. Start authorization through the interface provided by your deployment with the Client ID, registered callback URI, scopes, `state`, `code_challenge`, and `code_challenge_method=S256`. Do not omit the method: the server defaults to `plain`, which does not match an S256 challenge. After the user signs in and consents, the interface handles the callback URL returned by Auth Center.
3. **Before** exchanging the code, compare the returned `state` with the value saved for that session. Stop and restart if it is missing, mismatched, or expired. Use the verifier from the same authorization attempt and clear temporary data after processing.
4. Have the trusted backend call `POST /v1/auth-center/token` with the code, Client ID, exact callback URI, and `code_verifier`. Public clients omit the client secret. Keep the token response on the backend; do not return or log the refresh token.
5. Follow the [token verification guide](/en/auth-center-node-sdk) to validate signature, issuer, audience, expiry, token use, and required scopes before creating your own application session. Use `HttpOnly`, `Secure`, and an appropriate `SameSite` cookie policy, together with server-side CSRF protection.

Authorization codes are single-use and successful refresh rotates the refresh token. After a network failure, do not assume the server did not process the request; start authorization again if the new token cannot be recovered.

## Troubleshooting

- **Authorization preview returns 401 or 403**: confirm the authorization interface has a valid platform login and permissions, and the application is approved.
- **Callback rejected**: check that the callback URI exactly matches the registered value and the session's `state` is still valid.
- **Token exchange fails**: confirm the PKCE verifier matches the original challenge and the authorization code has not expired or already been used.
- **Token verification fails**: check the deployment's JWKS, configured issuer, Client ID, and required scopes. Parsing JWT contents alone does not establish authorization.

## Related documentation

- [Auth Center integration](/en/auth-center-app-management)
- [Auth Center Node SDK](/en/auth-center-node-sdk)
- [Auth Center Python SDK](/en/auth-center-python-sdk)
