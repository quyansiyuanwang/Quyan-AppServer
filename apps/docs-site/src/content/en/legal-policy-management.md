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

## Notes

- Only one version per type can be published at a time; publishing a new version automatically archives the previous one.
- All users who have not yet accepted the new version will be prompted at their next login.
- Policy changes usually require coordination with legal or operations before going live.

## Related pages

- `login-register`
- `auth-verification`
