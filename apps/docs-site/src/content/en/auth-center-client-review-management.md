# Auth Center app review management

Use this page to review submitted Auth Center apps. It is a reviewer-facing page that helps determine whether a record is safe and complete enough for third-party systems to use this platform as an authentication center.

## Page purpose

- Review pending or historical Auth Center app submissions.
- Filter by keyword and review status.
- Inspect key fields such as `clientType`, `grantTypes`, redirect URIs, and token lifetimes.
- Approve or reject apps in `pending`.
- Delete invalid or unnecessary records when needed.

## What you will see

### Filter area

Common filters include:

- keyword
- review status

This helps reviewers quickly locate a target app by name, owner, or other searchable metadata.

### Review list

The table usually shows:

- app name
- review status
- owner username
- `clientId`
- `clientType`
- `grantTypes`
- redirect URI summary
- submitted time
- reviewed time

Compared with standard OAuth review, this page puts more emphasis on whether the client type, grant types, PKCE rules, and token model make sense together.

### Action area

Common actions include:

- Delete
- Approve
- Reject

Only `pending` can be approved or rejected.

## Review status flow

Auth Center apps usually move through:

- `draft`
- `pending`
- `approved`
- `rejected`

On this page:

- `pending` means ready for review
- `approved` means accepted for Auth Center integration use
- `rejected` means the owner must revise the record

`draft`, `approved`, and `rejected` should not be directly reviewed again here.

## What reviewers should focus on

### Whether `clientType` matches the real architecture

First determine whether the app is really:

- `confidential`, with a trusted backend that can protect secrets
- or `public`, running on user-controlled devices

If this is wrong, the secret model, PKCE rules, and flow expectations are likely wrong too.

### Whether `grantTypes` are reasonable

Check carefully:

- whether `authorization_code` is actually needed
- whether `refresh_token` was selected without `authorization_code`
- whether `client_credentials` was incorrectly enabled on a `public` client

Too many grant types expand risk; too few may fail the business use case.

### Whether `redirectUris` are trustworthy

For apps using `authorization_code`, redirect URIs remain a primary review concern:

- are they controlled endpoints
- are environments clearly separated
- do they include temporary or inappropriate external URLs

### Whether token lifetimes are reasonable

Review both:

- whether the access token is too long-lived
- whether the refresh token is shorter than the access token
- whether the values match the use case and risk level

If tokens are too long-lived, exposure windows become much larger.

### Whether PKCE requirements fit the client

For `public + authorization_code`, PKCE should be enforced strictly.

If the app cannot safely protect secrets and PKCE is still loosened, review with extra caution.

## What the review dialog does

Approve and reject open a review dialog used to:

- confirm the review decision
- write a review comment

Comments should be specific, for example:

- production redirect URI is missing
- `public` client should not enable `client_credentials`
- access-token lifetime is too long

That makes revision much faster for the owner.

## How to think about deletion

Deletion from the review side is usually for:

- obviously incorrect records
- duplicate or test data
- invalid apps that should not remain

If the record still has remediation value, rejecting with a clear comment is usually better than deleting it.

## Common actions

1. Filter to the target app by keyword or status.
2. Inspect `clientType`, `grantTypes`, redirect URIs, and token lifetimes.
3. Open the review dialog for `pending` apps.
4. Write a clear comment and approve or reject.
5. Use delete only for clearly invalid records.

## Permission requirements

This page usually involves:

- `auth_center:client:review:read`
- `auth_center:client:review:update`

Read permission allows access to the page and list. Update permission is needed to complete approve or reject actions.

## Notes

- This is the reviewer side for Auth Center apps and does not replace `auth-center-client-management` for owners.
- Review is not only about completeness, but also about whether token model, client type, PKCE, and grant types align.
- Review comments should be concrete enough to support revision and re-review.

## Related pages

- [`auth-center-client-management`](/en/auth-center-client-management)
- [`auth-center-app-management`](/en/auth-center-app-management)
- [`oauth-app-review-management`](/en/oauth-app-review-management)
- [`business-logs`](/en/business-logs)
