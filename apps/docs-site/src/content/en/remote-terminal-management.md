# Remote terminal management

Use this page to manage remote terminal product plans, user entitlements, and device bindings.

With IAM enforcement enabled, the management template list uses `quyan:remote_terminal:ListTemplates` against each `acs:platform:*:platform:remote-terminal-template/<templateId>`. Page records and totals include only permitted templates; a template with no matching Allow or a matching Deny is withheld. Templates are shared deployment resources, so IAM grants also require the global management group ceiling configured by the deployment administrator. An account policy or account-owned group cannot grant that management eligibility. This read permission does not grant template creation, modification, or publication.

Template selectors in entitlement filters and assignment dialogs use server-side search and pagination. With IAM enforcement enabled, `quyan:remote_terminal:ListTemplateOptions` controls each template ARN independently. It returns only the permitted name, publication state, and status, without granting access to prices or full template details. The selector total counts permitted options; missing grants or explicit Deny hide the corresponding options. Search, page changes, and failed refreshes clear old option data.

With IAM enforcement enabled, template writes have separate `CreateTemplate`, `UpdateTemplate`, `PublishTemplate`, `UnpublishTemplate`, and `DeleteTemplate` actions in the `quyan:remote_terminal` service. Updating a template to deleted status also requires `DeleteTemplate`. Creation requires `CreateTemplate` on both `acs:platform:*:platform:remote-terminal-template-control` and the generated template ARN; a policy may use `acs:platform:*:platform:remote-terminal-template/*` for future templates. These grants still require the global management group ceiling. If authorization or the template changes before the operation finishes, the write is rejected and rolled back.

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
- **Admin device revocation is not subject to unbind rate limits** — administrators can revoke any device at any time without restriction.
- **Limit caps are high (up to 999999)** — administrators can set device and terminal limits well beyond standard bounds to accommodate special requests.
- The entitlements table provides a dedicated **Adjust Limits** action for quickly modifying device/terminal limits without opening the full edit form.
- The Adjust Limits dialog also includes a **Reset Count** button to reset the device unbind rate-limit window for a user, allowing them to unbind devices again immediately.

## Related pages

- `relay-settings`
- `user-management`
