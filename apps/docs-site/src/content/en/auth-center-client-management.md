# Auth Center client management

Use this page to maintain Auth Center application records inside the admin console. It is for platform operators or app owners who need to create, edit, submit, rotate secrets, and delete apps.

## Page positioning

This page is different from `auth-center-app-management`:

- [`auth-center-client-management`](/en/auth-center-client-management): admin-page manual for the internal management screen.
- [`auth-center-app-management`](/en/auth-center-app-management): external integration guide for third-party developers.

If you are working inside the admin UI, use this page. If you are integrating an outside system, use `auth-center-app-management`.

## Page purpose

- Create Auth Center apps.
- Configure client type, grant types, redirect URIs, and scopes.
- Adjust access-token and refresh-token lifetimes.
- Review current status and reviewer comments.
- Submit for review, rotate client secrets, and delete apps.

## What you will see

### Reference section

The top of the page includes a grant-type reference table that helps explain:

- `authorization_code` for user login or delegated authorization
- `refresh_token` for renewing expired access tokens
- `client_credentials` for service-to-service access

This area works as a quick decision aid before editing the form.

### App list

Desktop and mobile layouts both show an app list with fields such as:

- app name
- review status and reviewer comment
- `clientId`
- `clientType`
- `grantTypes`
- access-token and refresh-token lifetime
- redirect URI summary
- secret preview
- PKCE requirement
- last-used time

### Main actions

Each app can usually expose these actions:

- Edit
- Submit review
- Regenerate secret
- Delete

`Submit review` only appears for `draft` or `rejected`. Secret rotation only appears when the app actually has a client secret.

### Create / edit dialog

The form is split into several sections:

- basic information
- grant types
- redirect URIs
- token settings
- scopes
- integration metadata

That means a single app record is expected to satisfy business, authorization, security, and callback requirements together.

## Key fields and rules

### `clientType`

Choose between `confidential` and `public`:

- `confidential`: for systems with a trusted backend that can keep secrets safe
- `public`: for SPAs, mobile apps, desktop apps, or browser extensions that cannot safely store secrets

If the code runs on user-controlled devices, it should not be treated as a secret-keeping client.

### `grantTypes`

This page centers around these grant types:

- `authorization_code`
- `refresh_token`
- `client_credentials`

Important constraints:

- `refresh_token` must be used together with `authorization_code`
- `public` clients cannot enable `client_credentials`
- `public + authorization_code` forces PKCE on
- if `authorization_code` is enabled, at least one redirect URI is required

### `redirectUris`

Redirect URIs are one of the easiest parts of a user-facing auth flow to misconfigure.

- They mainly support `authorization_code`.
- Development, staging, and production should be registered separately.
- Scheme, host, port, path, and trailing slash should be exact.
- Old values should be removed quickly after decommissioning.

### `scopes`

The page shows selectable scopes such as `profile`. They describe:

- what the app is allowed to request later
- which capabilities the integrator may ask for during authorization

Scope selection should still follow least privilege.

### `isPkceRequired`

This switch controls whether the authorization-code flow must use PKCE.

- For `public + authorization_code`, the system locks it on.
- For clients that can safely keep secrets, the requirement depends on your security policy.

If you are unsure, stricter is usually better.

### `accessTokenLifetime` and `refreshTokenLifetime`

These fields control:

- `accessTokenLifetime`: how long the JWT is valid for local verification
- `refreshTokenLifetime`: how long the app may return to the auth center for renewal

Current page rule:

- `refreshTokenLifetime` cannot be shorter than `accessTokenLifetime`

In practice, access tokens should usually be shorter-lived than refresh tokens.

## Review status flow

Auth Center apps usually move through these states:

- `draft`: not submitted yet
- `pending`: submitted and waiting for review
- `approved`: accepted for formal integration use
- `rejected`: rejected and needs revision

Important behavior:

- `draft` and `rejected` can normally be edited and submitted again
- editing a previously approved or rejected app usually sends it back to draft-like review preparation
- reviewer comments directly affect the next remediation step for the owner

## Sensitive actions

### Submit review

Submitting means the record is ready for platform review. Before doing so, re-check:

- whether `clientType` matches the real architecture
- whether `grantTypes` are minimal
- whether `redirectUris` are complete and exact
- whether token lifetimes match the risk level

### Regenerate secret

Secret rotation is a sensitive action.

- The old secret should no longer be trusted after rotation.
- The new secret is usually shown in full only once.
- If you suspect exposure, rotate immediately instead of trying to recover the old value.

### Delete app

Deletion is commonly used when:

- the integration plan is abandoned
- the app record was created incorrectly
- the app no longer needs to exist

If the app is already in use by an external system, confirm the retirement plan first.

## Common actions

1. Read the grant-type reference table and confirm the integration model.
2. Create the app and fill in basics, grant types, redirect URIs, and scopes.
3. Set PKCE and token lifetimes according to client type and risk.
4. Re-check list values such as status, redirect URI summary, and secret preview.
5. Submit for review when the record is ready.
6. Rotate the secret if needed and store the new value immediately.

## Permission requirements

This page usually involves:

- `auth_center:client:read`
- `auth_center:client:create`
- `auth_center:client:update`
- `auth_center:client:delete`

Submitting for review belongs to the app maintenance flow. The final approve/reject action is handled separately in `auth-center-client-review-management`.

## Notes

- `client_credentials` does not issue refresh tokens.
- `public` clients should not enable `client_credentials`.
- When using `authorization_code`, redirect URI precision and PKCE requirements should be checked carefully.
- If an app is rejected, fix the reviewer feedback before submitting again.

## Related pages

- [`auth-center-app-management`](/en/auth-center-app-management)
- [`auth-center-client-review-management`](/en/auth-center-client-review-management)
- [`oauth-app-management`](/en/oauth-app-management)
- [`api-documentation`](/en/api-documentation)
