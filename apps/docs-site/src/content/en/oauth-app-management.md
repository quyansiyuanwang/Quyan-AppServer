# OAuth app management

Register third-party applications, configure callbacks and scopes, and submit them for review. Approval is required before an application can start authorization or exchange tokens. App owners use this page; platform reviewers use [OAuth app review](/en/oauth-app-review-management).

## Before you begin

- Open OAuth app management with `oauth:client:read`. The list contains your own ordinary applications that you are allowed to view. System OAuth applications have a separate management page.
- Creating, editing, and deleting require `oauth:client:create`, `oauth:client:update`, and `oauth:client:delete`, respectively. Submitting for review and rotating secrets use update permission. Access to the page does not grant every operation.
- Creation, editing, review submission, secret rotation, and owner deletion are subject to two-factor verification and replay protection. Follow the console prompts; API integrations must meet the corresponding security requirements.
- Deployments using IAM policies also require the relevant action and resource grants. Explicit denies and role session restrictions still apply. Listing, reading one application, editing, submitting for review, and rotating secrets are separate actions.

## Create and submit an application

1. Select create and enter a name and purpose that users will recognize during authorization.
2. Choose the client type based on where credentials can be stored. You cannot change the type on this page after creation.
3. Register each complete callback URI and select the scopes you need.
4. Optionally enter homepage, logo, privacy policy, and terms URLs, then save.
5. For a confidential client, copy the full Client Secret from the creation dialog into secure server storage. Public clients have no Client Secret.
6. Submit the draft for review. Wait while its status is `pending`; after approval, verify the integration using the [authorization-code example](/en/oauth-demo).

### Choose a client type

| Type                          | Suitable deployment                                               | Credential requirements                                                                      |
| ----------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Confidential (`confidential`) | Websites or services with a trusted backend that can keep secrets | Token exchange and refresh require a Client Secret stored only on the server                 |
| Public (`public`)             | SPAs, mobile apps, desktop apps, or browser extensions            | No client secret is issued; do not distribute a confidential client's secret to user devices |

Both types created on this page require PKCE. Send the challenge during authorization and its matching verifier when exchanging the code; the example uses S256. A client secret does not replace PKCE.

### Complete the fields

| Field                                          | Requirements and purpose                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Application name                               | Required; 1–100 characters after trimming                                                         |
| Description                                    | Optional; up to 2,000 characters describing the integration                                       |
| Redirect URIs                                  | 1–20 complete URLs, up to 500 characters each; must match the authorization request exactly       |
| Scopes                                         | Select at least one in the console, using the dynamic catalog currently grantable by your account |
| Homepage, logo, privacy policy, and terms URLs | Optional; up to 500 characters each; clearing and saving removes the previous value               |

The callback scheme, host, port, path, and trailing slash must match. Use controlled HTTPS addresses in production and register development, test, and production callbacks separately. The local example uses an explicitly registered loopback address.

If the scope catalog fails to load, retry in the dialog. Submission is disabled until it is ready. Available scopes depend on the owner's current permissions and role session, and are checked again on edit. Do not copy another account's scope list. An application's allowed scopes still require user consent; API access also depends on account permissions, resource grants, and other security conditions.

## View and edit applications

The list shows the name, Client ID, type, review status and comment, callback summary, secret preview, and last-used time. The desktop list displays at most two callback URIs; mobile shows their count. Open the edit dialog to inspect the full list. This page has no keyword search or pagination.

| Status     | Meaning                                      | Authorization and token exchange          |
| ---------- | -------------------------------------------- | ----------------------------------------- |
| `draft`    | Newly created or edited, awaiting submission | Unavailable                               |
| `pending`  | Submitted, awaiting review                   | Unavailable                               |
| `approved` | Review passed                                | Available when other requirements are met |
| `rejected` | Rejected; revise and resubmit                | Unavailable                               |

**Saving an approved or rejected application returns it to `draft`, even when fields are unchanged.** The previous review comment, submission time, and review information are cleared. Authorization-code exchange and token refresh also require approval; plan time for changes, resubmission, and review.

You can still edit a pending application; saving keeps it `pending`. Notify the reviewer when callbacks or scopes change so they review the latest information. A failed list refresh can leave previous content visible. Resolve the error and refresh before relying on its status.

## Save and rotate secrets

The full Client Secret is provided only when a confidential application is created or its secret is rotated. The list and edit dialog show a preview; the previous plaintext cannot be retrieved. Store the value securely before closing the dialog. If copying fails, select and copy it manually.

1. Confirm that integrations can update their server credentials, select secret rotation, and complete verification.
2. Save the new secret from the dialog and update every server configuration using the application.
3. Verify token exchange or refresh with the new secret. The old secret stops working immediately; there is no overlap period.

Rotation does not change review status or revoke tokens already issued. If a secret is lost or may have leaked, rotate it and check token use by integrations. Rotation does not revoke user authorization.

## Delete applications and manage tokens

Before deletion, confirm the Client ID, application name, and affected integrations. After confirmation and verification, the application disappears from management and cannot be used for new authorization or token exchange. This page has no restore option; recreating an application issues a new Client ID.

Editing, rotating a secret, or deleting an application does not replace revocation of issued access tokens. Existing tokens may remain valid until expiry or revocation and remain subject to account and endpoint permissions. To revoke a token, use `POST /v1/oauth/revoke` on the API with the required token and client authentication. Handle tokens that need revoking before deleting the application.

Ordinary applications created on this page enable authorization-code and refresh-token grants. At creation, access tokens have a 3,600-second lifetime and refresh tokens a 30-day lifetime; this page cannot change these values. Actual expiry follows the token response and server records. Successful refresh rotates the refresh token; save the new value and avoid concurrent refreshes or reuse of the old value.

## Troubleshooting

| Symptom                                     | What to check                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A new app cannot authorize                  | Confirm submission and `approved` status, then check the Client ID in use                               |
| An integration fails after saving details   | Check whether the app returned to draft and resubmit; do not repeatedly reuse an old authorization code |
| Redirect URI mismatch                       | Compare scheme, host, port, path, trailing slash, and environment                                       |
| A secret is missing or the old secret fails | Save it immediately after creation or rotation; rotate a lost secret and update server configurations   |
| Listing works but an operation is denied    | Check the operation permission, resource grant, role session, and two-factor requirements separately    |
| Rejection instructions are unclear          | Read the review comment in the list, contact the reviewer if needed, then revise and resubmit           |

## Related pages

- [OAuth authorization-code example](/en/oauth-demo)
- [OAuth app review](/en/oauth-app-review-management)
- [API documentation](/en/api-documentation)
- [Account settings](/en/account-settings)
