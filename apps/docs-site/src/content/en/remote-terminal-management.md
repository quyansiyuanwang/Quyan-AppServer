# Remote terminal management

Use this page to manage remote terminal product plans, user entitlements, and device bindings.

With IAM enforcement enabled, the management template list uses `quyan:remote_terminal:ListTemplates` against each `acs:platform:*:platform:remote-terminal-template/<templateId>`. Page records and totals include only permitted templates; a template with no matching Allow or a matching Deny is withheld. Templates are shared deployment resources, so IAM grants also require the global management group ceiling configured by the deployment administrator. An account policy or account-owned group cannot grant that management eligibility. This read permission does not grant template creation, modification, or publication.

Template selectors in entitlement filters and assignment dialogs use server-side search and pagination. With IAM enforcement enabled, `quyan:remote_terminal:ListTemplateOptions` controls each template ARN independently. It returns only the permitted name, publication state, and status, without granting access to prices or full template details. The selector total counts permitted options; missing grants or explicit Deny hide the corresponding options. Search, page changes, and failed refreshes clear old option data.

With IAM enforcement enabled, template writes have separate `CreateTemplate`, `UpdateTemplate`, `PublishTemplate`, `UnpublishTemplate`, and `DeleteTemplate` actions in the `quyan:remote_terminal` service. Updating a template to deleted status also requires `DeleteTemplate`. Creation requires `CreateTemplate` on both `acs:platform:*:platform:remote-terminal-template-control` and the generated template ARN; a policy may use `acs:platform:*:platform:remote-terminal-template/*` for future templates. These grants still require the global management group ceiling. If authorization or the template changes before the operation finishes, the write is rejected and rolled back.

Management entitlement lists show registration-token metadata and a masked value, and omit the complete token. Personal entitlement views retain the token needed for installation; administrators manage token renewal through the separately protected rotation action.

With IAM enforcement enabled, the management entitlement list uses `quyan:remote_terminal:ListEntitlements` against `acs:platform:*:platform:remote-terminal-entitlement/<userId>/<entitlementId>`. Totals count permitted entitlements only. The same action separately controls related platform resources: `user/<userId>`, `remote-terminal-template/<templateId>`, `remote-terminal-registration-token/<userId>/<entitlementId>/<tokenId>`, and `remote-terminal-device-binding/<userId>/<bindingId>`. Unreadable usernames, template names, and token metadata are omitted. If any device binding is unreadable, the complete device count is omitted rather than shown as zero or a partial count. Management tokens are always fully masked and never returned as plaintext. Personal installation and token rotation keep their own authorization flows. The deployment administrator's global entitlement-read ceiling is still required.

Template, entitlement, and device management tables use server-side pagination, with adjustable page sizes and totals for the current query. Under IAM enforcement, lists already migrated to resource authorization count permitted records only. Filter changes return to page one; writes refresh the current page. If deletion or a smaller grant removes that page, the last available page is fetched again. The device filter's entitlement selector has independent pagination and narrows candidates to the selected user. Loading and failures clear old records; Refresh retries a failed request. Identity or permission changes clear lists, selectors, and open management dialogs.

With IAM enforcement enabled, the device management list uses `quyan:remote_terminal:ListDeviceBindings` against each `acs:platform:*:platform:remote-terminal-device-binding/<userId>/<bindingId>`. The same action separately controls related `acs:platform:*:platform:user/<userId>` and `acs:platform:*:platform:remote-terminal-entitlement/<userId>/<entitlementId>` resources; unreadable usernames or entitlement names are omitted. Pages and totals include permitted devices only. Responses expose public device fields and available shell names, without heartbeat credentials or complete device snapshots. Eligibility still requires the deployment administrator's global device management read ceiling. This action does not grant terminal sessions, directory access, or device revocation; personal terminal `ListDevices` grants remain separate.

User selectors in entitlement and device filters and entitlement assignment dialogs support server-side search and independent pagination. Candidate users and totals follow the user-list endpoint's authorization; device or entitlement management does not automatically grant user-directory access. Browse search results by page and retry failures with Refresh. Identity or permission changes clear candidates. When editing an existing entitlement, the selected user's label may be retained from the currently permitted record. Device tables show hostname, client device ID, and the actual binding status; denied related usernames or entitlement names are not filled from old candidate caches.

In IAM enforcement mode, management writes also require permission on the target resource: `quyan:remote_terminal:RevokeDeviceBinding` controls `acs:platform:*:platform:remote-terminal-device-binding/<userId>/<bindingId>`; `quyan:remote_terminal:DeleteEntitlement` and `quyan:remote_terminal:ResetUnbindCount` control `acs:platform:*:platform:remote-terminal-entitlement/<userId>/<entitlementId>`. The server determines the resource owner. Operators must still belong to a global group with the corresponding management capability and complete step-up verification. A denied resource or an authorization change during the operation causes the operation to fail. Administrator revocation bypasses the personal unbind allowance check; resetting the allowance affects only the selected entitlement.

Registration rotation uses `quyan:remote_terminal:RotateRegistrationToken`. This Action controls both `acs:platform:*:platform:remote-terminal-entitlement/<userId>/<entitlementId>` and `acs:platform:*:platform:remote-terminal-registration-token/<userId>/<entitlementId>/<tokenId>`; a token wildcard under the selected entitlement can cover first-time creation. Entitlement management permission alone does not authorize token rotation: the operator also needs the global group's registration-token management capability. A successful rotation returns the new token. A failed authorization check preserves the previous token and does not return a new credential.

## Page purpose

- Create, publish, and maintain product plan templates.
- Assign or modify entitlements for users.
- View and revoke bound devices.
- Review entitlements and devices across all users.

## What you will see

### Templates tab

- Plan name and description.
- Supported billing units: **device unit** (billed by bound device count) and **terminal unit** (billed by concurrent terminal count).
- Unit price, currency, and minimum purchase quantity per unit.
- Status (draft / published) with publish / unpublish actions.
- Create, edit, and delete controls.

### Entitlements tab

- Filter by user, template, or status.
- Device limit and terminal limit per entitlement.
- Expiry date and purchase history.
- Assign / edit / delete / view registration token actions.

### Devices tab

- All bound devices across all users.
- Device info: hostname, platform, arch, online status, last-seen time.
- Filter by user, entitlement, or status.
- Revoke (force-unbind) a device.

## Permission requirements

| Action                                | Required permission                        |
| ------------------------------------- | ------------------------------------------ |
| View templates                        | `REMOTE_TERMINAL_PRODUCT_READ`             |
| Create / edit / delete templates      | `REMOTE_TERMINAL_PRODUCT_WRITE`            |
| View entitlements                     | `REMOTE_TERMINAL_ASSIGNMENT_READ`          |
| Assign / update / delete entitlements | `REMOTE_TERMINAL_ASSIGNMENT_WRITE`         |
| View registration tokens              | `REMOTE_TERMINAL_REGISTRATION_TOKEN_WRITE` |
| View device list (admin)              | `REMOTE_TERMINAL_DEVICE_MANAGE_READ`       |
| Revoke devices                        | `REMOTE_TERMINAL_DEVICE_WRITE`             |

## Common actions

1. Create a template, set billing units and prices, save, then publish.
2. In the entitlements tab, assign the plan to a user with device and terminal limits.
3. Share the registration token with the user — they install the agent on their device to complete binding.
4. To reclaim a device, find it in the devices tab and revoke it.

## Notes

- All write operations (create, edit, publish, delete, assign) require a **step-up 2FA challenge**.
- Once published, a plan is visible to all users and can be self-claimed via `POST /remote-terminal/products/me/entitlements/claim`.
- Entitlements support renewal and upgrade (adjusting device or terminal limits).
- **Admin device revocation is not subject to unbind rate limits** — administrators can forcibly unbind devices within their authorized management scope.
- **Limit caps are high (up to 999999)** — administrators can set device and terminal limits well beyond standard bounds to accommodate special requests.
- The entitlements table provides a dedicated **Adjust Limits** action for quickly modifying device/terminal limits without opening the full edit form.
- The Adjust Limits dialog also includes a **Reset Count** button to reset the device unbind rate-limit window for a user, allowing them to unbind devices again immediately.

## Related pages

- `relay-settings`
- `user-management`
