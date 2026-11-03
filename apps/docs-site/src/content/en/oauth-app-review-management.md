# OAuth app review

Platform reviewers use this page to find ordinary OAuth applications, approve or reject pending submissions, and delete applications that should no longer be used. To maintain your own apps, use [OAuth app management](/en/oauth-app-management). System OAuth applications are outside this page's scope.

## Before you begin

- Page access and listing require `oauth:client:review:read`. Approval, rejection, and reviewer deletion require `oauth:client:review:update`.
- In deployments using IAM policies, listing requires membership in an actual platform global management group containing read permission. Review and deletion require update permission in that group. Account-owned groups, additional permissions, or account policies cannot replace platform group eligibility.
- In addition to that eligibility, listing, review, and deletion separately check `quyan:oauth:ListClientReviews`, `quyan:oauth:ReviewClient`, and `quyan:oauth:DeleteReviewedClient`. The resource is `acs:platform:*:platform:oauth-review-client/<application record ID>`; the record ID is not the public Client ID. Explicit denies and role session restrictions still apply.
- List items and totals include only applications you can view. Viewing a record does not grant review or deletion. OAuth access tokens cannot call these review endpoints.

## Find pending applications

1. Select `pending` to locate submissions awaiting a decision. Other status filters also show historical or draft records.
2. Enter an application name, Client ID, or owner username keyword, then select search or press Enter. Typing alone does not run a query.
3. Check the name, owner, Client ID, callback summary, submission time, and review time.

Searching, clearing the keyword, and changing status reset to page one. The default page size is 20; available sizes are 10, 20, 50, and 100. Changing page size also resets to page one. Refresh keeps the current page; there is no automatic polling. Results are ordered by submission time ascending, then creation time descending.

The list shows at most two callback URIs and a count for the rest. The review dialog contains only the decision and comment field; it does not show full application details, scopes, or the complete callback list. Confirm those details with the owner before review, including callback ownership, environment, and requested scopes. The summary is not the complete application.

## Approve or reject a submission

1. Select approve or reject for a `pending` application.
2. Confirm the decision in the dialog and enter a review comment. Comments are optional and limited to 2,000 characters. For rejection, identify specific changes, such as the test callback URI to remove.
3. Submit and check the success notification and refreshed status. The owner can read the comment in app management.

| Status     | Review actions on this page  | Effect on the application                                                            |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `draft`    | Cannot approve or reject     | Not submitted; authorization and token exchange unavailable                          |
| `pending`  | Approve or reject            | Authorization and token exchange unavailable until approved                          |
| `approved` | Cannot review again directly | Authorization, token exchange, and refresh available when other requirements are met |
| `rejected` | Cannot review again directly | Owner must revise and resubmit before another review                                 |

Approval does not replace user consent, scope checks, or resource authorization. Saving the details of an approved or rejected application returns it to draft and clears its previous review comment and review information, even if the owner did not change any fields. Saving a pending application keeps it `pending`; confirm the latest details before deciding.

If the application status has changed, refresh and check it again instead of resubmitting an old decision. Successful review keeps the current page. A record disappears from the results if it no longer matches the filter.

## Delete an application

Deletion removes the application itself, rather than one review-history entry. Delete actions can appear for every review status. Confirm the application name and Client ID and coordinate the impact with the owner before proceeding.

1. Select delete and read the confirmation.
2. After confirmation, the application disappears from owner and review lists and can no longer start authorization or exchange tokens. This page has no restore option.
3. Check the refreshed results. If the last record on the last page was deleted, return to the previous page.

**Deletion does not revoke issued access tokens.** Existing tokens may remain valid until expiry or revocation. If existing tokens must stop working, first coordinate token revocation with the integration, then delete the application. An application disappearing from the list does not prove that every access token has become invalid.

## Troubleshooting

| Symptom                                               | What to check                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Page opens but listing is denied                      | Ask a platform administrator to check global group eligibility, read permission, and resource policies |
| Viewing works but review or deletion fails            | Check update permission and the corresponding action grant; list permission does not replace them      |
| Approve and reject are missing                        | Only `pending` is reviewable; wait for owner submission or resubmission                                |
| Old rows remain after a query error                   | Resolve the error and refresh before using those results to decide                                     |
| Submission reports an error with an uncertain outcome | Refresh and check status and review time before deciding whether to retry                              |
| Full callbacks or scopes need checking                | Confirm them with the owner; the dialog has no complete-details view                                   |

## Related pages

- [OAuth app management](/en/oauth-app-management)
- [Auth Center client review](/en/auth-center-client-review-management)
- [Business logs](/en/business-logs)
- [API documentation](/en/api-documentation)
