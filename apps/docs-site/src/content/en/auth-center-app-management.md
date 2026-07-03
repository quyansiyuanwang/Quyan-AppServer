# Auth Center app management

Use this page to register external applications that treat this platform as an authentication center.

## Page positioning

This page is the integration guide for third-party systems. Its focus is on flow design, JWT, JWKS, and refresh-token behavior.

If you need the admin-page manual for maintaining these app records, use:

- [`auth-center-client-management`](/en/auth-center-client-management)
- [`auth-center-client-review-management`](/en/auth-center-client-review-management)

## What this feature is

This Auth Center feature is **separate from the existing OAuth 2.0 feature set**.

It is designed for integrators that want:

- a **short-lived JWT access token** for local verification
- a **long-lived refresh token** that can only be exchanged at the auth center
- **asymmetric signing** so downstream systems verify access tokens with **JWKS / public keys**
- per-application control over **access token lifetime** and **refresh token lifetime**
- both **user login / authorization** flows and **machine-to-machine** flows

This means the integrating application can validate the short token on its own, while refresh remains centralized.

## Core model

### Access token

- Short-lived
- JWT format
- Signed by the platform private key
- Verified by the integrator with the public key from JWKS
- Intended to be checked directly by the registered application

### Refresh token

- Longer-lived than the access token
- Opaque to the integrating application
- Must be sent back to the auth center for refresh
- Never verified locally by the third-party application

### Important rule for `client_credentials`

When the app uses `client_credentials`:

- the auth center returns an **access token only**
- **no refresh token is issued**

This keeps machine-to-machine access simpler and avoids unnecessary long-lived credentials.

## Page purpose

Use the management page to:

- create Auth Center apps
- choose `confidential` or `public` client type
- choose allowed grant types
- configure redirect URIs for user-facing flows
- configure access-token and refresh-token lifetimes
- rotate client secrets
- submit apps for review
- review approval state and reviewer comments

## Supported grant types

### `authorization_code`

Use for:

- user login
- delegated user authorization
- browser, mobile, or backend-assisted login flows

Behavior:

- returns a short-lived JWT access token
- may return a refresh token if enabled for the app
- requires at least one registered redirect URI
- public clients should use PKCE

### `refresh_token`

Use for:

- obtaining a new short-lived access token after expiry

Behavior:

- can only be used together with `authorization_code`
- requires the auth center to validate the refresh token
- returns a new access token and may rotate refresh state depending on server policy

### `client_credentials`

Use for:

- server-to-server integration
- internal services
- scheduled jobs
- backend workers

Behavior:

- authenticates the application itself
- does **not** represent an end user
- returns a short-lived JWT access token only
- does **not** issue a refresh token
- cannot be enabled on public clients

## Client type guidance

### Confidential client

Use this when the integrating system has a trusted backend and can safely store a secret.

Typical examples:

- SaaS backend
- internal gateway
- service API
- batch job platform

### Public client

Use this when the code runs on user-controlled devices and cannot safely keep a secret.

Typical examples:

- SPA
- mobile app
- desktop app
- browser extension

For public clients using `authorization_code`, PKCE should be enabled.

## JWT and JWKS verification model

The intended split is:

1. The auth center issues a JWT access token.
2. The registered application fetches the JWKS document.
3. The application selects the matching `kid`.
4. The application verifies the JWT signature, issuer, audience, expiry, and claims locally.
5. When the access token expires, the application sends the refresh token back to the auth center.

This gives you:

- centralized issuance
- decentralized access-token verification
- controlled refresh and revocation behavior

## Typical flows

## 1. User login / user authorization flow

```text
User -> Integrating App -> Auth Center /authorize
User approves or signs in
Auth Center -> redirect_uri with code
Integrating App -> Auth Center /token (authorization_code)
Auth Center -> access_token (+ refresh_token if allowed)
Integrating App verifies access_token with JWKS/public key
```

Recommended when the external system needs a user identity session.

## 2. Refresh flow

```text
Integrating App -> Auth Center /token (refresh_token)
Auth Center validates refresh token
Auth Center -> new access_token (+ optional refresh_token depending on policy)
Integrating App verifies new access_token locally
```

Recommended when the app keeps a user session longer than the access token lifetime.

## 3. App-to-app flow

```text
Service A -> Auth Center /token (client_credentials)
Auth Center -> access_token only
Service A -> Service B / protected API
Service B verifies JWT with JWKS/public key
```

Recommended when no end user is involved.

## Main fields on the management page

### App name and description

Use clear business names so reviewers and operators can identify the integration quickly.

### Redirect URIs

Required for `authorization_code`.

Recommendations:

- register all environments explicitly
- keep exact callback URLs
- remove unused entries quickly

### Grant types

Choose only what the integration actually needs.

- user login only: `authorization_code` + usually `refresh_token`
- server-to-server only: `client_credentials`
- mixed integration: decide carefully per application

### Access token lifetime

This controls how long the JWT remains valid for local verification.

Shorter values improve security. Longer values reduce refresh frequency.

### Refresh token lifetime

This controls how long the integrating app may come back to the auth center for renewal.

It should usually be longer than the access token lifetime.

### Client secret

Only confidential clients should rely on a secret.

If a secret may have leaked, rotate it immediately.

## Review and approval

Auth Center apps can move through review states such as:

- `draft`
- `pending`
- `approved`
- `rejected`

A typical operator flow is:

1. Create the app
2. Configure redirect URIs, grant types, and lifetimes
3. Submit for review
4. Wait for approval
5. Copy the secret if issued
6. Complete integration on the external system

## Discovery and key endpoints

Common endpoints used by integrators:

- `GET /auth-center/.well-known/openid-configuration`
- `GET /auth-center/.well-known/jwks.json`
- `GET /auth-center/authorize`
- `POST /auth-center/authorize`
- `POST /auth-center/token`
- `POST /auth-center/revoke`

## Minimum integration checklist

1. Create the Auth Center app.
2. Choose the correct client type.
3. Enable only the required grant types.
4. Set token lifetimes that match your risk level.
5. Copy and store the client secret if the app is confidential.
6. Implement JWKS-based JWT verification in the integrating system.
7. Use refresh tokens only against the auth center.
8. Do not expect refresh tokens from `client_credentials`.

## Recommended follow-up reading

- [`auth-center-client-management`](/en/auth-center-client-management)
- [`auth-center-node-sdk`](/en/auth-center-node-sdk)
- [`auth-center-python-sdk`](/en/auth-center-python-sdk)
- [`auth-center-browser-spa-example`](/en/auth-center-browser-spa-example)
- [`api-documentation`](/en/api-documentation)
