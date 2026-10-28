# Legal policy management

Use this page to maintain legal-policy versions such as terms and privacy notices.

## Page purpose

- Maintain terms of service and privacy policy separately.
- Create, edit, publish, and unpublish versions.
- Control what legal text users see during registration or use.

## What you will see

### Type switch

- Terms of service.
- Privacy policy.

### Version list

- Version records with published status.
- Current active-version marker.
- Retained historical versions.

### Management actions

- Create version (Markdown editor).
- Edit version content.
- Publish or unpublish (only one version per type can be active at a time).
- Delete version.

## Policy consent flow

Publishing a new version triggers a **forced re-consent** check:

- On the next login or action, the system compares the user's last accepted policy version against the current published version.
- If the user is behind, they are redirected to a consent page after login and must explicitly agree to the new version before continuing.
- Refusing blocks login completion.
- Consent endpoint: `POST /auth/accept-policy-consent` — the final access token is only issued after the policy token is submitted.

> Because of this, **confirm all content with legal or operations before publishing**. Once published, all existing users will be required to re-read and accept the new version on their next login.

## Common actions

1. Switch to the policy type you need to maintain.
2. Create or edit the target version with the Markdown editor.
3. Preview the formatted output to confirm layout and content are correct.
4. Publish the new version when it is ready — it immediately becomes the active text.
5. Delete old versions that no longer need to be retained.

## Permission requirements

| Action                      | Required permission    |
| --------------------------- | ---------------------- |
| View policy versions        | `LEGAL_POLICY_READ`    |
| Create version              | `LEGAL_POLICY_CREATE`  |
| Edit version                | `LEGAL_POLICY_UPDATE`  |
| Delete version              | `LEGAL_POLICY_DELETE`  |
| Publish / unpublish version | `LEGAL_POLICY_PUBLISH` |

## IAM version read access

With IAM enforcement, the management list and detail APIs require `LEGAL_POLICY_READ` eligibility in an actual deployment-wide group. Listing uses `quyan:legal_policy:ListVersions`; details use `quyan:legal_policy:GetVersion`. Both authorize the actual version resource `acs:platform:*:platform:legal-policy/<version-id>`. The creator is an audit actor, not an account owner for the policy.

The version list includes only authorized versions and loads summaries without draft content. Details require a separate Allow before loading content. A matching Deny takes priority. Missing, deleted or unauthorized detail resources return 403 in enforce mode. Results are withheld if a version, qualification, policy or role session changes during the read. AssumeRole uses role grants. Public published-policy and consent flows retain their existing access rules.

## IAM draft changes

In enforce mode, creating a draft uses `quyan:legal_policy:CreateVersion` on `acs:platform:*:platform:legal-policy-control/<policy-type>` and on the generated version's actual ARN before commit. The supported types are `terms_of_service` and `privacy_policy`. Updating and deleting use `quyan:legal_policy:UpdateVersion` and `quyan:legal_policy:DeleteVersion` on `acs:platform:*:platform:legal-policy/<version-id>`. Each operation also requires its existing management permission in a real deployment-wide group.

A matching Deny or invalid identity, group, role session or version rolls back the change. Published versions remain immutable. Deleting a draft retains its version number; later drafts receive a new number. An active unpublished draft must be edited, published or deleted before another draft of that type can be created. Replay protection remains required.

## IAM publication changes

Publishing uses `quyan:legal_policy:PublishVersion`; unpublishing uses `quyan:legal_policy:UnpublishVersion`. The operation requires the existing `LEGAL_POLICY_PUBLISH` eligibility in a real deployment-wide group, plus authorization for every affected version ARN.

Publishing checks the target and the current version it replaces. Unpublishing a current version checks the target and the latest remaining published fallback. If that fallback is denied, the operation fails; it does not choose an older version to bypass Deny. Missing fallback protection remains in place. The affected set and grants are rechecked inside one transaction; Deny, revocation, or concurrent changes roll back all publication changes. Public active-policy reads continue to return the committed current version.

## Notes

- Only one version per type can be published at a time; publishing a new version automatically archives the previous one.
- All users who have not yet accepted the new version will be prompted at their next login.
- Policy changes usually require coordination with legal or operations before going live.

## Related pages

- `login-register`
- `auth-verification`
