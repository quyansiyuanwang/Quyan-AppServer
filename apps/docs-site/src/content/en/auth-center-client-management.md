# Auth Center app management

Manage your own Auth Center applications: create configurations, submit for review, read comments, rotate secrets, and delete apps. For token acquisition and JWT verification, see [Auth Center integration](/en/auth-center-app-management).

## Before you begin

- Page access requires `auth_center:client:read`. Creation, editing, and deletion require `auth_center:client:create`, `auth_center:client:update`, and `auth_center:client:delete`. Review submission and secret rotation are update operations.
- Creation, editing, submission, rotation, and owner deletion require the corresponding two-factor verification and replay protection. Follow console prompts; page access does not grant every operation.
- Scopes come from a dynamic catalog grantable by your current account. Retry in the dialog if loading fails; submission is blocked until the catalog is ready. Role sessions use the role's permissions.
- This page maintains only the current user's own applications. Approval and rejection take place on the separate [Auth Center app review](/en/auth-center-client-review-management) page.

## Create and submit an application

1. Select create and enter the name, purpose, and client type. Choose confidential when a trusted backend can store secrets; choose public for SPAs, mobile apps, desktop apps, and other clients that cannot.
2. Select grants for the actual use case. New confidential applications start with all three grant types selected; clear those you do not need.
3. For user authorization, register at least one complete callback. Configure PKCE, lifetimes, and minimum scopes.
4. Optionally enter homepage, logo, privacy policy, and terms URLs, then save.
5. Save the full Client Secret from the creation dialog immediately for a confidential application. Public applications have no secret. Do not wait until approval to look for it.
6. Check the listed configuration and submit the draft for review. It becomes `pending`; approval is required before authorization and token exchange.

### Grants and PKCE

| Setting                              | Requirements and outcome                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `authorization_code`                 | User authorization, at least one callback, user JWT                                                           |
| `refresh_token`                      | Also requires `authorization_code`; code exchange issues a refresh token, which rotates on successful refresh |
| `client_credentials`                 | Confidential only; application JWT without a refresh token                                                    |
| Public with authorization code       | PKCE is forced on; switching to public automatically removes the machine grant                                |
| Confidential with authorization code | PKCE is configurable; keep it enabled with S256. A secret cannot replace a required verifier                  |

Select at least one grant and one scope in the form. Authorization-code callbacks must match the requested scheme, host, port, path, and trailing slash exactly. Machine-only applications can omit callbacks.

### Fields and lifetimes

| Field                                          | Limits and defaults                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Name and description                           | Name required, 1–100 characters; description optional, up to 2,000 characters                |
| Callback URIs                                  | Up to 20 complete URLs, 500 characters each; at least one when authorization code is enabled |
| Access token lifetime                          | Seconds, 60–86,400; default for new apps: 3,600                                              |
| Refresh token lifetime                         | Seconds, 300–31,536,000; default: 2,592,000 (30 days)                                        |
| Homepage, logo, privacy policy, and terms URLs | Optional, up to 500 characters each; clearing and saving removes the previous value          |

Refresh lifetime cannot be shorter than access lifetime, even for machine-only configuration. This validation does not mean a machine grant issues refresh tokens. New tokens use the configuration at issuance; changing lifetimes does not rewrite the expiry claim of JWTs already issued.

## View and edit configuration

The desktop list shows review status and comments, Client ID, client type, grants, callback summary, secret preview, PKCE, and last-used time. Mobile cards include callback and scope counts and both lifetimes. Check full callbacks and lifetimes in the edit dialog. The page has no keyword search or pagination.

| Status     | Meaning                                               | Next step                                           |
| ---------- | ----------------------------------------------------- | --------------------------------------------------- |
| `draft`    | Created or edited, awaiting submission                | Check details and submit                            |
| `pending`  | Awaiting review                                       | Wait; notify the reviewer if editing further        |
| `approved` | Integration available when other requirements are met | Allow time for another review before making changes |
| `rejected` | Review failed                                         | Revise according to comments and resubmit           |

**Saving an approved or rejected app returns it to `draft`, even when fields are unchanged.** The previous comment, submission time, and review information are cleared. Code exchange, refresh, and machine grants remain unavailable until approval again. Editing a pending application keeps it `pending`; reviewers must check the latest details.

### Change client type

Unlike ordinary OAuth management, this page allows client-type changes. Switching to public clears the existing secret and rechecks grants and PKCE. The old confidential integration configuration cannot simply continue unchanged.

Switching from public to confidential does not generate a Client Secret on save. If no rotation button is available, an authorized integrator can create a new secret using `POST /v1/auth-center/clients/{id}/regenerate-secret`, or create a new confidential application. The path's `{id}` is the application record ID, not the public Client ID. The API still requires permissions, two-factor verification, and replay protection. Saving successfully does not mean a secret is ready.

## Rotate a secret

1. Confirm affected integrations, select rotation, and complete confirmation and verification. The button appears only when a secret is already configured.
2. Save the new secret from the dialog and update every server configuration immediately. The old secret becomes invalid immediately, without an overlap period.
3. Verify subsequent code exchange, refresh, or machine authorization. Rotate a lost secret; the list and detail responses cannot recover its plaintext.

Rotation does not change review status or revoke issued access or refresh tokens. The full secret is provided only at creation or rotation; subsequent desktop listings show a preview. Never put secrets in browser code, user devices, or version control.

## Delete and retire an integration

Coordinate business retirement and token revocation before deletion. Confirm the app name and Client ID, then delete and complete verification. The application disappears from management and review lists and can no longer authorize, exchange, or refresh tokens. There is no restore option; recreating it issues a new Client ID.

**Deletion does not immediately invalidate JWTs verified locally by an integration.** Existing signatures and expiry claims do not change when the record disappears. Ending existing access also requires the integration's session, authorization, and revocation policies. Pure local signature verification cannot immediately observe server-side token revocation either.

## IAM actions and resources

With IAM enforcement, listing filters your own apps by `quyan:auth_center:ListClients`; individual reads require `quyan:auth_center:GetClient`. Resources use `acs:auth-center:*:<accountId>:client/<userId>/<recordId>`. The final segment is the record ID, not the public Client ID. Account and user come from the current identity; policies cannot make this page read another user's apps.

Creation uses `quyan:auth_center:CreateClient` on the current user's parent resource, `acs:quyan:*:<accountId>:user/<userId>`. Editing, submission, rotation, and deletion check `quyan:auth_center:UpdateClient`, `quyan:auth_center:SubmitClientReview`, `quyan:auth_center:RotateClientSecret`, and `quyan:auth_center:DeleteClient`, respectively, on the application resource. Creation does not automatically grant subsequent reads or maintenance.

Scope changes also check that the current identity can grant the requested scopes. OAuth access tokens calling management APIs require `auth_center_client` or a supported equivalent scope, which still does not replace IAM grants. Explicit denies, role restrictions, or identity and application changes during an operation can cause rejection. Refresh and check again.

## Troubleshooting

| Symptom                                           | What to check                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Form cannot be submitted                          | Check the scope catalog, at least one scope and grant, callbacks, and lifetime relationship                               |
| An approved app stops exchanging tokens           | Check whether saving returned it to draft; resubmit for review                                                            |
| Confidential app has no secret or rotation button | Check whether it was converted from public; saving does not issue a secret. Use the API process above or create a new app |
| An old JWT works after a lifetime change          | Issued tokens retain their expiry claim; apply integration access controls                                                |
| Old rows remain after refreshing or editing       | A load error may leave previous results; resolve it and refresh before relying on them                                    |
| Page opens but one app cannot be maintained       | Check action, resource, scope, role, and two-factor requirements separately                                               |

## Related pages

- [Auth Center integration](/en/auth-center-app-management)
- [Auth Center app review](/en/auth-center-client-review-management)
- [OAuth app management](/en/oauth-app-management)
- [API documentation](/en/api-documentation)
