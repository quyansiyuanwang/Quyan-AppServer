# Remote terminal management

Use this page to manage remote terminal product plans, user entitlements, and device bindings.

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
