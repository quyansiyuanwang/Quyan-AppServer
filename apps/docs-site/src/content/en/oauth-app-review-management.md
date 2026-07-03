# OAuth app review management

Use this page to review OAuth app records submitted by other users. This is a reviewer-facing page, not the normal owner page for maintaining your own app.

## Page purpose

- Review submitted or previously reviewed OAuth apps.
- Filter by keyword and review status.
- Inspect key fields such as app name, owner, `clientId`, and redirect URIs.
- Approve or reject apps in `pending`.
- Delete an app from the review perspective when needed.

## What you will see

### Filter area

Common filters include:

- keyword
- review status

The keyword search is generally used to find:

- app name
- owner username
- other searchable app-related fields

### Review list

The table usually shows:

- app name
- review status
- owner username
- `clientId`
- redirect URI summary
- submitted time
- reviewed time

If an app has multiple redirect URIs, the list usually shows only a short summary first.

### Action area

Based on the current implementation, the main actions are:

- Delete
- Approve
- Reject

Approve and reject only appear when the app is currently `pending`.

## Review status flow

OAuth apps move through these states:

- `draft`
- `pending`
- `approved`
- `rejected`

The important meaning here is:

- `pending`: the owner has submitted the app and it is waiting for review
- `approved`: the app can be used in formal OAuth flows
- `rejected`: the app must be revised and submitted again

On this page:

- `pending` can be reviewed
- `draft`, `approved`, and `rejected` can only be viewed or deleted

## What reviewers should focus on

### Is the app identity clear

First confirm:

- whether the app name is clear
- whether the owner is correct
- whether the described business purpose matches the record

If identity is vague, later incident tracing becomes harder.

### Are the redirect URIs trustworthy

Redirect URIs are one of the highest-risk parts of OAuth review.

Check for:

- controlled domains
- clear environment separation
- test URLs mixed into formal records
- values that are too broad or inconsistent with the use case

### Is the state actually reviewable

Only `pending` should receive approve or reject actions.

If the app is no longer `pending`, then it has either:

- not been submitted yet
- or already been reviewed

The review actions should not be used as a second confirmation step.

## What the review dialog does

When you click approve or reject, the dialog is mainly for:

- confirming the decision as `approved` or `rejected`
- writing a review comment

Comments should be actionable, for example:

- missing production redirect URI
- redirect URI does not match the stated business flow
- privacy policy or terms link needs to be added

That makes remediation much easier for the owner.

## How to think about deletion

The review page can also delete apps. This is usually appropriate for:

- obviously incorrect test data
- duplicate records
- invalid apps that should not remain in the system

Before deleting, confirm whether the app still has remediation value.

## Common actions

1. Filter to the target app by keyword or status.
2. Check the name, owner, `clientId`, and redirect URI summary.
3. If the app is `pending`, open the review dialog and write a review comment.
4. Approve or reject based on the record quality.
5. Use delete only when the record should no longer be kept.

## Permission requirements

This page usually involves:

- `oauth:client:review:read`
- `oauth:client:review:update`

Without read permission, the review list is typically unavailable. Without update permission, approve and reject cannot be completed.

## Notes

- This is a reviewer page and does not replace `oauth-app-management` for app owners.
- The review goal is not only “can this app be created,” but “is this record safe and traceable enough for OAuth integration.”
- Review comments should be useful for remediation, not just a short verdict.

## Related pages

- [`oauth-app-management`](/en/oauth-app-management)
- [`auth-center-client-review-management`](/en/auth-center-client-review-management)
- [`business-logs`](/en/business-logs)
- [`api-documentation`](/en/api-documentation)
