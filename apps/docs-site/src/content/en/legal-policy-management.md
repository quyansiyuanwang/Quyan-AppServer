# Legal policy management

Use legal policy management to maintain the terms of service and privacy policy that users read and accept when registering or signing in. Policies apply across the deployment. Creator and updater names identify operators, not accounts that own a separate policy.

## Prerequisites

Open legal policy management in the management site. Viewing, creating, editing, deleting, and publishing require separate permissions. Seeing a list entry does not grant access to its content or allow changes.

| Action                         | Required permission    |
| ------------------------------ | ---------------------- |
| List versions and read content | `LEGAL_POLICY_READ`    |
| Create a draft                 | `LEGAL_POLICY_CREATE`  |
| Edit a draft                   | `LEGAL_POLICY_UPDATE`  |
| Delete a draft                 | `LEGAL_POLICY_DELETE`  |
| Publish or unpublish           | `LEGAL_POLICY_PUBLISH` |

## View types and version states

The page initially shows terms of service. Switch to privacy policy as needed; TOS and PP identify these types on mobile. Switching types filters the loaded list without fetching it again. Entries show title, version, summary, updater, update time, and publication state; desktop also shows publication time.

| State                               | Meaning                          | Available content actions                                                          |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| Draft                               | Never published, or unpublished  | Edit, publish, delete                                                              |
| Published without the current badge | Retained historical publication  | Unpublish before editing or deleting                                               |
| Published with the current badge    | Text currently provided to users | Replace by publishing another draft, or unpublish when a published fallback exists |

**Each type has at most one current version, but may retain multiple published historical versions.** Check the current badge rather than relying on a version number or the Published label alone. The page has no search, pagination, export, or automatic refresh.

## Create and edit drafts

1. Select a policy type and choose Create.
2. Confirm the type, then enter a title, optional summary, and Markdown content. A new form is empty; it does not copy the current version.
3. Preview the content. Desktop defaults to a split editor and preview with a single-pane option; mobile uses editor and preview tabs.
4. Submit the form. A newly created version is a draft and does not replace the current text.

Titles must contain 1–200 characters after trimming. Summaries allow up to 2,000 characters, and content cannot be empty. The system assigns increasing version numbers for each type; numbers cannot be chosen manually or reused after deleting a draft.

You cannot create another draft while an undeleted draft of that type exists. Handle the existing draft first. A version's type cannot be changed when editing. Published versions reject edits and deletion even if those buttons are visible. Normally, create a new version to revise live content.

Clearing an existing summary in the form and saving retains the old summary. To remove it, an authorized integration can explicitly submit an empty string through the update API and read the result again to confirm.

Failed submission retains your input. Closing or canceling clears it. There is no autosave, content comparison, or historical-content recovery feature. If loading details fails after the editor opens, an empty form does not mean the stored content is empty. Close and retry before making changes.

## Publish and verify the current text

1. Check the target draft's type, version, title, and complete content.
2. Choose Publish and confirm.
3. Verify that it shows Published with the current badge.
4. Check both terms of service and privacy policy, ensuring each has current text.

Publishing immediately replaces the current version of the same type. The previous version remains published but loses its current badge. Publishing one type does not replace the other. Finish your content review before confirming; the page has no separate approval workflow.

Registration and combined policy loading require both types to be published. A missing type can prevent registration or policy loading. This does not establish that all existing users are blocked from signing in.

## Unpublish and delete

Choose Unpublish and confirm to return the target version to Draft and clear its publication time.

- Unpublishing a historical version does not change the current text.
- Unpublishing the current version makes the highest-numbered remaining published version current. The fallback retains its original publication time.
- You cannot unpublish a current version if no published fallback exists.
- The system selects the fallback. Check historical content before confirming. Unpublishing can also leave multiple drafts of the same type, preventing another draft from being created.

Deletion requires confirmation and applies only to drafts. The page has no restore action. Unpublish a historical publication before deleting it. Retain historical versions when their publication records are needed.

## When users must accept again

When both current policies are available, login completion checks whether the user has accepted those specific versions. If either has not been accepted, the user must follow the login page prompts to read the policies, select agreement, and continue. Policies appear in a dialog on the login page. Closing it or declining confirmation does not complete that login.

Publishing does not sign out all existing sessions or recheck acceptance on every business operation. Acceptance is tracked for specific versions rather than by a simple version-number comparison. Reverting to a version the user previously accepted may require no further confirmation.

A consent session lasts 10 minutes. Restart login if it expires or becomes invalid, or if a failed confirmation cannot be continued. Integrations use `POST /v1/auth/accept-policy-consent` with a valid `challengeToken` and `agreedToLegalPolicies: true`, following the endpoint's replay-protection requirements.

## IAM authorization scope

With IAM enforcement, management operations require the corresponding management eligibility in a real deployment-wide group as well as the actions below. Version resources use `acs:platform:*:platform:legal-policy/<version-id>`.

| Operation    | IAM action                            | Authorized resources                          |
| ------------ | ------------------------------------- | --------------------------------------------- |
| List         | `quyan:legal_policy:ListVersions`     | Actual versions in the list                   |
| Read content | `quyan:legal_policy:GetVersion`       | Target version                                |
| Create       | `quyan:legal_policy:CreateVersion`    | Type control resource and new version         |
| Edit         | `quyan:legal_policy:UpdateVersion`    | Target draft                                  |
| Delete       | `quyan:legal_policy:DeleteVersion`    | Target draft                                  |
| Publish      | `quyan:legal_policy:PublishVersion`   | Target and the current version being replaced |
| Unpublish    | `quyan:legal_policy:UnpublishVersion` | Target and any version becoming the fallback  |

The create control resource is `acs:platform:*:platform:legal-policy-control/<policy-type>`, where the type is `terms_of_service` or `privacy_policy`.

The list returns authorized version summaries; list visibility does not grant content access. Missing, deleted, or unauthorized details may all return 403 in enforce mode. Management APIs do not accept OAuth access tokens. Role sessions use the role's own grants, and matching Deny takes priority.

Publishing and unpublishing require authorization for every affected version. If the selected fallback is denied, the operation fails rather than skipping to an older version. Revoked grants, changed version states, or concurrent changes can also fail the operation. Refresh and verify before retrying. Management writes require replay protection; public policy reads and user consent follow their own endpoint rules.

## Troubleshooting

| Symptom                                                 | What to do                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Success is followed by a list-loading error             | The operation may have completed. Reopen the page and verify state before resubmitting                                          |
| Old entries remain after list loading fails             | The previous list can remain visible. Reload before deciding to publish, unpublish, or delete                                   |
| Creation reports an existing draft                      | Check drafts of that type. Permission filtering may hide another draft; contact an administrator with the necessary read access |
| A listed version cannot be opened, edited, or published | Check content and mutation grants, including every affected version; list visibility alone is insufficient                      |
| Unpublishing the current version fails                  | Check for a published fallback and permission to perform the unpublish action on it                                             |

## Related pages

- [Login / Register]({{DOCS_BASE_URL}}/en/login-register)
- [Verification]({{DOCS_BASE_URL}}/en/auth-verification)
