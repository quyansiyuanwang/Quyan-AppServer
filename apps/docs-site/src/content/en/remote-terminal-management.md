# Remote terminal management

Administrators use three separate pages for plan templates, user entitlements and device bindings to offer terminal plans, assign or adjust quotas, and revoke bindings. For self-service purchases and installation, see [My remote terminal products]({{DOCS_BASE_URL}}/en/my-remote-terminal-products).

## Before you start

Permissions control management pages and buttons; reading a record does not grant modification rights. IAM enforcement also requires the deployment's global management-group eligibility and authorization on the target resources. Account-owned policies or groups cannot independently grant platform management eligibility.

| Task                                                        | Compatibility permission and page capability |
| ----------------------------------------------------------- | -------------------------------------------- |
| Read plans                                                  | `REMOTE_TERMINAL_PRODUCT_READ`               |
| Create, edit, publish, unpublish and delete plans           | `REMOTE_TERMINAL_PRODUCT_WRITE`              |
| Read user entitlements                                      | `REMOTE_TERMINAL_ASSIGNMENT_READ`            |
| Assign, edit or delete entitlements and reset unbind counts | `REMOTE_TERMINAL_ASSIGNMENT_WRITE`           |
| Rotate registration tokens                                  | `REMOTE_TERMINAL_REGISTRATION_TOKEN_WRITE`   |
| Read management device bindings                             | `REMOTE_TERMINAL_DEVICE_MANAGE_READ`         |
| Revoke a binding                                            | `REMOTE_TERMINAL_DEVICE_WRITE`               |

Operators with 2FA enabled may need step-up verification for management writes. Whether an existing trusted window suffices follows current security rules. Visible buttons do not replace server-side checks.

## Find records

- Filter plans by name keyword and management status, entitlements by user, template and status, and devices by user, entitlement and binding status. Publication and enablement are separate conditions; binding status is not online status.
- All three lists use server-side pagination, defaulting to 20 records with 20, 50 or 100 available. Filter changes return to page one. Writes refresh the current page; an invalid page is replaced with the last valid page.
- User, template and entitlement selectors search or paginate independently. Device-page entitlement choices narrow to the selected user. A missing user need not be nonexistent: user selectors require separate user-directory access.
- Loading or failure clears old records; refresh after failure. Identity or permission changes clear lists, choices and open dialogs. IAM enforcement totals include authorized records only. Missing fields can indicate denied related resources, so do not infer them from older cached choices.

## Create and publish a plan

1. Open plan management, select create, and enter the name, description, billing unit and prices.
2. Device prices buy device slots; terminal prices buy concurrent terminal quotas. Charges are not metered by currently online devices or actual uses. Offer at least one item: blank means unavailable, while zero means free.
3. Set minimum and maximum purchase units and device/terminal counts. Minimum purchase units must be positive; the maximum cannot be lower. Check that quota ranges match your intended offer.
4. To limit purchases, fill both the per-user count and window in days, or clear both. The limit counts newly created same-template entitlements in the window and applies to new purchases and template-based administrator assignments.
5. Save and verify, then publish. Only enabled plans can be published. Self-service users see only enabled, published offers they are authorized to view.

A week is 7 days and a month is 30 days. Prices support four decimal places. Later purchases, renewals and upgrades use the plan prices at submission; see the personal purchase guide for estimate differences.

Publish and unpublish submit immediately; deletion requires confirmation. Unpublishing prevents new self-service purchases and renewals; deletion also removes the purchase entry. Neither automatically deletes existing entitlements. Manage their validity and quotas separately. Editing a plan does not directly update existing entitlements in bulk.

The current plan editor has no enable/disable switch. Publishing a disabled record fails; an authorized administrator must use a supported management API to change that state. Clearing the description in this editor retains the old text. Clearing optional prices, purchase limits or count caps instead removes them as submitted; verify after saving.

## Assign an entitlement

1. Open entitlement management, select assign and choose the recipient. A template is optional.
2. Enter start and expiration times, with expiration later than start. Device and terminal quotas are integers from 0 to 999999, with at least one positive. A zero device allowance cannot register devices.
3. Without a template, enter a name. With a template and blank name, its name is used. Description and notes are optional.
4. Submit, refresh and check the recipient, template, validity and quotas. Administrator assignment does not debit the user's balance and is not a paid purchase transaction.
5. Have the user follow the token and installation flow on **My remote terminal products**. In IAM enforcement mode, assignment does not create a registration token; an authorized user or administrator must rotate separately to create one.

A template associates the plan and supplies some information. **Selecting it does not fill quotas or validity for you.** Assignment does not require publication; check the values you enter. Template purchase limits still apply.

**Current form limitation:** maximum device/terminal count fields shown during new assignment are not saved with the assignment request. If needed, save them afterward through editing or quota adjustment, then read back to confirm.

## Edit, adjust or delete an entitlement

Edit a row to change its name, description, validity, quotas, maximum counts and note. **Adjust limits** provides a shorter quota and maximum-count editor.

- **Editing does not transfer the recipient or replace the template.** These selectors remain visible, but saving omits them. Assign separately to another user, then decide whether to remove the old entitlement according to your business needs.
- Device allowance cannot be lower than the number of bindings not yet revoked, including disabled bindings. Check and remove unnecessary bindings first. At least one quota must stay positive; setting both to zero is not a way to revoke all capacity.
- Administrator adjustments are not paid self-service renewals or upgrades: they do not debit the user's balance, and the editor does not change cumulative actual payment. Agree on validity and quota changes with the user first.
- Blank names, descriptions and notes retain their existing values in this page. Clearing optional maximum counts submits their removal. Blank dates in the full editor preserve the existing dates.
- Deletion requires confirmation and removes the entitlement's usable capacity and device access. It does not refund payment or uninstall the agent. Check the recipient and entitlement before deleting, then refresh to verify saves or deletion.

Increasing device allowance does not deliver installation credentials. IAM enforcement does not create a registration token automatically; use the separate token operation.

## Rotate a registration token

The entitlement list shows only authorized metadata such as token label and expiration. It does not retrieve old secrets. Rows with device allowance offer rotation when you have token-write permission.

1. Check the recipient and entitlement, then set the label and expiration. Empty values clear the existing label and expiration restriction respectively. Denied metadata can also leave these fields blank, so confirm your intended values before submitting.
2. Confirm to generate a new token; the old token immediately stops authorizing new registrations. Coordinate with the user because scripts or configuration may still store it.
3. **The current management page neither displays nor copies the new secret returned by rotation.** Refreshing the list does not deliver the credential. An authorized user who needs the secret should rotate again on the personal products page, securely save the latest token, then obtain installation commands.

A definitive server rejection preserves the old token. A timeout or interrupted connection does not establish failure. Coordinate retrieval of the latest credential before continuing with an uncertain older one. Do not send tokens through public messages.

## Revoke a binding or reset unbind counts

Locate the device by user or entitlement, verify its hostname, client device ID and binding status, then revoke and confirm. Binding status means enabled, disabled or revoked, not online/offline. Last-seen time does not prove current connectivity.

Administrator revocation bypasses the personal unbind-window allowance. Management eligibility, resource grants, step-up verification and server request rules still apply; this is not unrestricted access to every user's devices. Revocation removes the platform binding without uninstalling the agent. Rebinding still requires cooldown, entitlement and credential checks.

In an entitlement's **Adjust limits** dialog, **Reset unbind count** with confirmation runs a separate operation. **It does not require saving quotas, and closing the dialog does not undo a completed reset.** Unsaved quota edits are not saved by resetting.

Reset changes only that entitlement's unbind-count starting point. It does not change the global unbind switch, allowance or device rebind cooldown, and it retains old unbind records and revoked bindings. If the global maximum is zero, users still cannot unbind devices afterward.

## Troubleshooting

| Symptom                                     | Action                                                                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty management list or selector           | Check loading errors, filters, page, global management eligibility, resource policies and user-directory permission. Refresh successfully before drawing conclusions. |
| Save succeeds but the new result is missing | A subsequent read may fail or the resource may be invisible. Refresh successfully and verify before retrying, especially to avoid duplicate assignments.              |
| Assignment or edit times out                | Refresh by recipient and entitlement, then check validity, quotas and records. A timeout does not establish that the transaction never committed.                     |
| Cannot reduce device allowance              | Check unrevoked bindings, including disabled ones, and resolve them before reducing capacity.                                                                         |
| Rotation succeeds but no secret appears     | This management page does not display the new secret. Follow the personal rotation flow above to obtain the latest credential.                                        |
| Rebinding still fails after a reset         | Resetting unbind counts does not remove device cooldown or restore expired entitlements, missing credentials or device capacity.                                      |

## IAM permissions and resource scope

With IAM enforcement enabled, the management template list uses `quyan:remote_terminal:ListTemplates` against each `acs:platform:*:platform:remote-terminal-template/<templateId>`. Page records and totals include only permitted templates; a template with no matching Allow or a matching Deny is withheld. Templates are shared deployment resources, so IAM grants also require the global management group ceiling configured by the deployment administrator. An account policy or account-owned group cannot grant that management eligibility. This read permission does not grant template creation, modification, or publication.

Template selectors in entitlement filters and assignment dialogs use server-side search and pagination. With IAM enforcement enabled, `quyan:remote_terminal:ListTemplateOptions` controls each template ARN independently. It returns only the permitted name, publication state, and status, without granting access to prices or full template details. The selector total counts permitted options; missing grants or explicit Deny hide the corresponding options. Search, page changes, and failed refreshes clear old option data.

With IAM enforcement enabled, template writes have separate `CreateTemplate`, `UpdateTemplate`, `PublishTemplate`, `UnpublishTemplate`, and `DeleteTemplate` actions in the `quyan:remote_terminal` service. Updating a template to deleted status also requires `DeleteTemplate`. Creation requires `CreateTemplate` on both `acs:platform:*:platform:remote-terminal-template-control` and the generated template ARN; a policy may use `acs:platform:*:platform:remote-terminal-template/*` for future templates. These grants still require the global management group ceiling. If authorization or the template changes before the operation finishes, the write is rejected and rolled back.

Management entitlement lists show registration-token metadata, never the complete token. Personal install-token issuance and long-term token rotation have independent authorization flows.

With IAM enforcement enabled, the management entitlement list uses `quyan:remote_terminal:ListEntitlements` against `acs:platform:*:platform:remote-terminal-entitlement/<userId>/<entitlementId>`. Totals count permitted entitlements only. The same action separately controls related platform resources: `user/<userId>`, `remote-terminal-template/<templateId>`, `remote-terminal-registration-token/<userId>/<entitlementId>/<tokenId>`, and `remote-terminal-device-binding/<userId>/<bindingId>`. Unreadable usernames, template names, and token metadata are omitted. If any device binding is unreadable, the complete device count is omitted rather than shown as zero or a partial count. Management tokens are always fully masked and never returned as plaintext. Personal installation and token rotation keep their own authorization flows. The deployment administrator's global entitlement-read ceiling is still required.

Template, entitlement, and device management tables use server-side pagination, with adjustable page sizes and totals for the current query. Under IAM enforcement, lists already migrated to resource authorization count permitted records only. Filter changes return to page one; writes refresh the current page. If deletion or a smaller grant removes that page, the last available page is fetched again. The device filter's entitlement selector has independent pagination and narrows candidates to the selected user. Loading and failures clear old records; Refresh retries a failed request. Identity or permission changes clear lists, selectors, and open management dialogs.

With IAM enforcement enabled, the device management list uses `quyan:remote_terminal:ListDeviceBindings` against each `acs:platform:*:platform:remote-terminal-device-binding/<userId>/<bindingId>`. The same action separately controls related `acs:platform:*:platform:user/<userId>` and `acs:platform:*:platform:remote-terminal-entitlement/<userId>/<entitlementId>` resources; unreadable usernames or entitlement names are omitted. Pages and totals include permitted devices only. Responses expose public device fields and available shell names, without heartbeat credentials or complete device snapshots. Eligibility still requires the deployment administrator's global device management read ceiling. This action does not grant terminal sessions, directory access, or device revocation; personal terminal `ListDevices` grants remain separate.

User selectors in entitlement and device filters and entitlement assignment dialogs support server-side search and independent pagination. Candidate users and totals follow the user-list endpoint's authorization; device or entitlement management does not automatically grant user-directory access. Browse search results by page and retry failures with Refresh. Identity or permission changes clear candidates. When editing an existing entitlement, the selected user's label may be retained from the currently permitted record. Device tables show hostname, client device ID, and the actual binding status; denied related usernames or entitlement names are not filled from old candidate caches.

In IAM enforcement mode, management writes also require permission on the target resource: `quyan:remote_terminal:RevokeDeviceBinding` controls `acs:platform:*:platform:remote-terminal-device-binding/<userId>/<bindingId>`; `quyan:remote_terminal:DeleteEntitlement` and `quyan:remote_terminal:ResetUnbindCount` control `acs:platform:*:platform:remote-terminal-entitlement/<userId>/<entitlementId>`. The server determines the resource owner. Operators must still belong to a global group with the corresponding management capability; those with 2FA enabled may need step-up verification. A denied resource or an authorization change during the operation causes the operation to fail. Administrator revocation bypasses the personal unbind allowance check; resetting the allowance affects only the selected entitlement.

Registration rotation uses `quyan:remote_terminal:RotateRegistrationToken`. This Action controls both `acs:platform:*:platform:remote-terminal-entitlement/<userId>/<entitlementId>` and `acs:platform:*:platform:remote-terminal-registration-token/<userId>/<entitlementId>/<tokenId>`; a token wildcard under the selected entitlement can cover first-time creation. Entitlement management permission alone does not authorize token rotation: the operator also needs the global group's registration-token management capability. A successful rotation returns the new token. A failed authorization check preserves the previous token and does not return a new credential.

In IAM enforcement mode, editing an entitlement uses `quyan:remote_terminal:UpdateEntitlement` on `acs:platform:*:platform:remote-terminal-entitlement/<userId>/<entitlementId>`. Setting its status to deleted also requires `quyan:remote_terminal:DeleteEntitlement`. Edits return entitlement fields without registration credentials or related-resource details. Increasing device allowance does not issue a registration token; use the dedicated registration-token rotation operation with its own authorization. Concurrent changes to the entitlement, its owner, registered devices or authorization prevent the edit from committing.

Assigning an entitlement uses `quyan:remote_terminal:AssignEntitlement` and requires authorization for the target platform user, any selected remote terminal template, and the newly created entitlement. User and entitlement patterns must both cover the recipient; a template pattern is also required when assigning from a template. Template purchase limits are enforced within the assignment transaction. A matching Deny on the generated entitlement rolls back the assignment. Assignment does not charge the recipient or issue a registration token; use the dedicated token rotation operation to obtain a credential.

## Related pages

- [My remote terminal products]({{DOCS_BASE_URL}}/en/my-remote-terminal-products)
- [Remote terminal]({{DOCS_BASE_URL}}/en/remote-terminal)
- [Relay settings]({{DOCS_BASE_URL}}/en/relay-settings)
- [User management]({{DOCS_BASE_URL}}/en/user-management)
