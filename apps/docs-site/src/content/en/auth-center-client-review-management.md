# Auth Center app review

Platform reviewers use this page to find Auth Center applications, approve or reject submissions, and delete applications that should no longer be used. To maintain your own apps, use [Auth Center app management](/en/auth-center-client-management).

## Before you begin

- Page access and listing require `auth_center:client:review:read`. Approval, rejection, and reviewer deletion require `auth_center:client:review:update`.
- With IAM enforcement, listing requires membership in an actual platform global management group containing review-read permission. Review or deletion requires review-update permission in that group. Account ownership, additional permissions, and account-created groups cannot independently provide platform reviewer eligibility.
- The review resource also requires separate grants for `quyan:auth_center:ListClientReviews`, `quyan:auth_center:ReviewClient`, and `quyan:auth_center:DeleteReviewedClient`. Its ARN is `acs:platform:*:platform:auth-center-review-client/<recordId>`. The last segment is the application record ID, not its public Client ID.
- Explicit denies and role session restrictions still apply. List items and totals include only authorized applications. Listing or maintaining your own apps does not grant review or reviewer deletion. OAuth access tokens cannot call review endpoints.

## Find submissions

1. Select `pending` for submissions awaiting review, or another status for drafts and historical records.
2. Enter an application name, owner username, or Client ID keyword, then press Enter or select search. Typing alone does not run a query.
3. Check the listed name, owner, Client ID, client type, grant types, callback summary, and submission and review times.

Searching, clearing the keyword, and changing status reset to page one. The default size is 20; available sizes are 10, 20, 50, and 100. Changing size also resets to page one. Refresh keeps the current page; there is no automatic polling. Results are ordered by submission time ascending and creation time descending.

## Check integration details

The list displays at most two callbacks and a count for the rest. The review dialog contains only the decision and comment; it does not show full callbacks, scopes, token lifetimes, or PKCE. Confirm missing information with the owner before deciding.

| Check                                 | What to confirm                                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Client type                           | Confidential clients have a trusted backend for secrets; public clients do not depend on embedded secrets                                 |
| Grant types                           | User flows use authorization code, with refresh enabled if needed; machine grants are confidential only                                   |
| Callbacks and authorization interface | Controlled ownership, separate environments, exact request matching, and an authorization interface supplied by the deployment            |
| Scopes                                | Necessary and minimal; allowed scopes do not mean the user already consented                                                              |
| PKCE                                  | Mandatory for public authorization-code clients; integration uses the S256 challenge and verifier from the same attempt                   |
| Lifetime and revocation               | Refresh lifetime is not shorter than access lifetime; integrator understands local JWT verification cannot immediately observe revocation |

The form and server validate grant combinations and lifetime relationships. Review must still determine whether the configuration fits the business use case. Saving successfully is not sufficient grounds for approval.

## Approve or reject

1. Select approve or reject on a `pending` record and check the decision shown in the dialog.
2. Enter an optional review comment of up to 2,000 characters. Rejections should identify specific corrections instead of only saying that details are wrong.
3. Submit and check the success notification and refreshed status. The owner reads comments in app management and revises and resubmits if needed.

| Status     | Can approve or reject        | Meaning                                                                    |
| ---------- | ---------------------------- | -------------------------------------------------------------------------- |
| `draft`    | No                           | Owner has not submitted                                                    |
| `pending`  | Yes                          | Authorization and token exchange are unavailable before approval           |
| `approved` | Cannot review directly again | User or machine authorization is available when other requirements are met |
| `rejected` | Cannot review directly again | Awaiting owner revision and resubmission                                   |

Saving an approved or rejected application returns it to draft and clears the previous comment and review information, even if fields were unchanged. Saving a pending application keeps it `pending`; review the latest details. Approval does not replace user consent, scope checks, or integration business authorization.

Successful submission keeps the current page. Records disappear if they no longer match the filter. If the application, identity, or authorization has changed, refresh and check again instead of resubmitting an old decision.

## Delete an application

Deletion removes the application itself, rather than a review-history entry. The button can appear for every status. Coordinate retirement and token handling with the owner, check the name and Client ID, then confirm deletion.

The app disappears from owner and review lists and can no longer authorize, exchange, or refresh tokens. This page has no restore option. If the last page becomes empty, return to the previous page.

**Application deletion and token revocation cannot be observed immediately by pure local JWT verification.** An integration may still accept an issued JWT until its original expiry. Ending existing access also requires the integration's session and authorization policies. A record disappearing does not prove that all access has stopped.

## Troubleshooting

| Symptom                                      | What to check                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Page opens but listing fails                 | Ask a platform administrator to check global group eligibility, read permission, and review resource grants |
| Listing works but decisions or deletion fail | Check update permission and the separate review or deletion action; own-app permissions cannot replace them |
| Complete details are missing                 | Confirm them with the owner; the dialog has no complete-application view                                    |
| Approve and reject are missing               | Only `pending` is reviewable; wait for owner submission or resubmission                                     |
| Old records remain after a query error       | Resolve the error and refresh before deciding                                                               |
| Submission fails with an uncertain outcome   | Refresh and check status and review time before deciding whether to retry                                   |

## Related pages

- [Auth Center app management](/en/auth-center-client-management)
- [Auth Center integration](/en/auth-center-app-management)
- [OAuth app review](/en/oauth-app-review-management)
- [Business logs](/en/business-logs)
