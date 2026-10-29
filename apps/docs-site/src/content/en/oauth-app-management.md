# OAuth app management

Use this page to register OAuth 2.0 client applications for third-party integrations.

## Integration quick start

1. Choose a confidential or public client for the deployment shape.
2. Register the exact Redirect URI used by the application.
3. Select scopes using least privilege; if the scope catalog fails to load, retry before submitting.
4. Create the app and submit it for review.
5. Use the Client ID with the authorization-code flow; keep a confidential client secret on the server only.

The management page shows the same checklist and links back to this guide.

## What OAuth is

OAuth 2.0 is an **authorization protocol**. It allows a third-party application to access part of a user's account data or capabilities **without receiving the user's password directly**.

In practical terms:

- You create an OAuth app in this system.
- A third-party app sends the user here for authorization.
- The user approves a set of scopes.
- This system returns the authorization result to the third-party app.
- The app only receives the approved access, not the user's login credentials.

This page is where you control which external apps may request access, which redirect URIs are allowed, and what scopes they can ask for.

## Page purpose

- Create OAuth applications for external websites or tools.
- Configure redirect URIs and basic app metadata.
- Review client IDs, scopes, and secret status.
- Rotate or delete credentials when an integration changes.

## What you will see

### Application list

- Application name and client ID.
- Client type: confidential or public.
- Redirect URI count and recent usage time.
- Secret preview for confidential clients.

### Create / edit dialog

The dialog normally includes:

- **Application name** for identification.
- **Description** for business context.
- **Client type** to decide whether a secret can be safely stored.
- **Redirect URIs** for allowed post-authorization return targets.
- **OAuth scopes** for requested permissions.
- **Homepage / Logo / Policy / ToS URLs** for app identity and compliance.

### Management actions

- Create a new OAuth app.
- Edit redirect URIs, scopes, and URLs.
- Rotate the client secret.
- Delete an unused app.

## Client type: confidential vs public

The client type decides whether the application can safely keep credentials secret.

### Confidential client

Use this for:

- Websites with their own backend
- Server-rendered apps
- Systems that can keep secrets in server-side environment variables

Characteristics:

- The system issues a **client secret**.
- The app is expected to use that secret only on the server side.
- If the secret leaks, another party may impersonate the app in OAuth flows.

Recommendations:

- Store the secret only on the backend.
- Never ship it in browser code, mobile apps, desktop bundles, or public repositories.
- Rotate it immediately if exposure is suspected.

### Public client

Use this for:

- Single-page applications (SPA)
- Mobile apps
- Desktop clients
- Browser extensions

Characteristics:

- A public client must **not rely on a client secret as a security boundary**.
- Any secret embedded in software distributed to end users may be extracted.
- Security depends more on correct redirect URI control, safer authorization flow handling, and narrower scopes.

Simple rule:

- **Confidential client**: can safely store a secret.
- **Public client**: cannot safely store a secret.

## Field and behavior details

### Application name

- Used in management views and may also affect how the app is recognized in the authorization flow.
- Prefer a real product or integration name so users can identify it.

### Description

- Adds context for operators and reviewers.
- Use it to explain what the integration does and who uses it.

### Redirect URI

This is one of the most important OAuth settings.

- After the user approves access, the system only redirects to a **registered redirect URI**.
- The redirect URI in the OAuth request must **match exactly**.
- Differences in protocol, host, port, path, or trailing slash can cause authorization failure.

Recommendations:

- Register separate URIs for development, staging, and production.
- Avoid broad or uncontrolled callback targets.
- Remove old URIs when they are no longer needed.

### Client secret (confidential clients only)

- The full secret may only be shown once after creation or rotation.
- The list normally shows only a preview, not the full plaintext value.
- If the integration loses the secret, the correct action is to rotate it and store the new value securely.

### Homepage, Logo, Policy, and ToS URLs

These fields provide app identity metadata:

- **Homepage URL**: app home page
- **Logo URL**: app icon or logo
- **Policy URL**: privacy policy
- **ToS URL**: terms of service

Typical uses:

- Help users recognize the app during authorization
- Expose compliance and legal information
- Improve trust and clarity in management or consent views

## What OAuth scopes are

OAuth scopes define **which capabilities the third-party app wants to access**.

Core principles:

- **Request only what is needed**
- **Use least privilege**
- **Make the authorization intent understandable**

A scope does not mean “full access after login.” It means “access only to the capabilities approved for that scope.”

## How to read the OAuth Scope reference table

The **OAuth Scope reference table** at the top of the page helps administrators understand each available scope. It normally includes:

- **Scope**: the identifier used directly in authorization requests
- **Description**: a short meaning summary
- **Access**: the kind of data or capability granted
- **Notes**: extra caveats, sensitivity notes, or usage guidance

This table helps answer questions such as:

- Which scopes are safe for common integrations?
- Which scopes are sensitive and should be granted carefully?
- Does a given app actually need the scope it is requesting?

## Common scope meanings

| Scope          | Typical meaning                             | Risk note                                                                        |
| -------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| `profile`      | Read basic profile data                     | Usually low-risk baseline access                                                 |
| `email`        | Read email-related information              | Contains personal identity data                                                  |
| `notification` | Access notification-related features        | May affect notification flows                                                    |
| `oauth_client` | Access OAuth client management capabilities | May approach app-level administration                                            |
| `accesskey`    | Start a new access-key creation flow        | Only for creating and receiving a new key, not reading or deleting existing ones |
| `passkey`      | Access passkey-related features             | Touches authentication management                                                |
| `two_factor`   | Access two-factor related features          | High-sensitivity security scope                                                  |

Scopes such as `email` and `two_factor` should usually be treated as more sensitive and granted with extra care.

For the `accesskey` scope, the intended meaning is narrower than a general “manage keys” permission: a third-party app may create a new access key for the user and receive that newly created secret once, but it must not treat the authorization as permission to read or delete existing keys.

## Recommended setup strategy

### If your integration has a backend

- Prefer a **confidential client**.
- Store the client secret only on the server.
- Register only the redirect URIs you truly use.
- Request only the scopes the business flow requires.

### If your integration is frontend-only or runs on user devices

- Prefer a **public client**.
- Do not assume a client secret can remain private.
- Control redirect URIs and scope selection more strictly.
- Avoid high-sensitivity scopes unless they are truly required.

## Common issues and checks

### Redirect URI mismatch during authorization

Check whether:

- the request URI exactly matches the registered value
- a trailing slash differs
- the port differs
- the wrong environment URI was used

### Full client secret is no longer visible

This is usually expected.

- Full secrets are often shown only once.
- If the value was not saved, rotate the secret and store the new one securely.

### Not sure whether to choose confidential or public

The key question is not feature size. It is:

- **Can the application keep the secret only on a trusted server and never expose it to end users?**

If not, treat it as a public client.

## Common actions

1. Create an app and choose the correct client type.
2. Add every allowed redirect URI exactly as your integration will use it.
3. Copy the client secret immediately if one is issued.
4. Rotate the secret if it may have been exposed.

## Integrate the authorization-code flow

1. Create the application, complete review, and record its Client ID. Keep a confidential client's secret on the server.
2. Start authorization using `/oauth/authorize` on the identity site, with the callback URI, requested scopes, a random `state`, and a PKCE challenge.
3. Validate `state` at the callback, then exchange the authorization code and matching PKCE verifier at the API's `/v1/oauth/token` endpoint.
4. Use the access token to call permitted APIs, such as `/v1/users/me` with the `profile` scope.

See the [OAuth authorization-code example](/en/oauth-demo) for runnable code and security guidance.

## Review workflow notes

OAuth apps are no longer always “create and use immediately”. In many cases they move through a review workflow. Both app owners and platform operators should understand this.

### Status meanings

| Status     | Meaning                          | Usable in the real OAuth flow |
| ---------- | -------------------------------- | ----------------------------- |
| `draft`    | Draft, not submitted yet         | No                            |
| `pending`  | Submitted and waiting for review | No                            |
| `approved` | Review passed                    | Yes                           |
| `rejected` | Rejected and must be revised     | No                            |

### Review-related notes

- The app can only be used in the actual authorization flow after it reaches `approved`.
- After rejection, the owner should revise the app based on the review comment and resubmit it.
- Saving an approved or rejected app in the console returns it to `draft` and clears the previous review comment, even if the fields were unchanged. An approved app cannot start new authorizations until it passes review again; plan the integration change and resubmit it for review.
- Review comments should be visible to both administrators and app owners so fixes can be made efficiently.

## Redirect URI configuration guidance

The redirect URI must exactly match a registered address, including its scheme, host, port, path, and trailing slash.

### Recommended practice

- Register development, staging, and production URIs separately
- Use complete and controlled HTTPS URLs
- Match protocol, host, port, and path exactly
- Remove obsolete callback URLs quickly

### Common mistakes

- Missing trailing slash
- Wrong domain
- Mixing test and production environments
- Using a frontend page URL instead of the actual backend callback handler

## Token lifecycle and access

The token endpoint is `POST /v1/oauth/token` on the API site. If the response includes a refresh token, use the `refresh_token` grant to request a new access token. Revoke a token that is no longer needed using `POST /v1/oauth/revoke`; consult the API reference for the request fields and client authentication requirements.

A granted scope does not bypass account permissions, resource authorization, or other security checks. Store client secrets and tokens securely and never put confidential client secrets in distributed browser or desktop code.

## Related pages

- [Account settings](/en/account-settings)
- [API documentation](/en/api-documentation)
- [OAuth app review](/en/oauth-app-review-management)
