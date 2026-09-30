# Channel balance probes

Channel balance probes use a minimal model request to compare upstream balance movement, actual usage, and the current channel multiplier. They are for operators with channel-management access. Balance-workflow credentials are never shown or exported to the browser.

## Working with pooled channels

A pool remains one logical channel, but can be expanded to inspect each physical account. Every account has its own credential status, latest probe, and run action. A probe always stays on the selected account and never rotates through other members during the same task.

The pool shares a balance workflow and calibration settings, while each physical member may select its own supported probe format, model, payload and serial group. Members can use their own balance-workflow credentials or bind a shared account-pool entry. Disabled members, members without usable credentials, and members incompatible with the selected format or model cannot run. Saved credentials are never displayed again.

Run members one at a time, or confirm a run for all currently available members. Tasks follow the server queue and probe-group rules. Balance reads and minimal model requests can incur real upstream charges.

## Shared account pool and batch configuration

Administrators with the separate account-pool management permission can configure upstream login requests, credentials, token extraction paths, optional upstream expiry, fallback session lifetime and a minimum login interval per account in the **Account pool** tab. Login requests and credentials are encrypted on the server. The balance workflow may use `{{accountToken}}`; the model request still uses the channel's existing upstream API credential. Channels and physical members may bind the same account. Probes sharing an account are serialized to prevent competing balance measurements. If login fails, the session expires during cooldown, or session storage is unavailable, the probe does not bypass the login limit.

Binding an account **does not remove existing login steps**. Remove old login steps from the balance workflow manually and use the account token in the remaining requests; otherwise each balance read still logs in through the old workflow. Existing profiles continue to work unchanged until edited. Modifying or refreshing accounts requires the management permission, step-up verification and replay protection. Saved login requests, credentials and tokens cannot be read from the page.

Batch configuration copies a shared template while letting each standalone channel or physical member choose a supported format, model, payload and serial group, and optionally bind an account. Each target is validated independently; failures do not prevent other targets from saving. Neither source credentials nor account bindings are copied. The page can filter by serial group; probes bound to the same account serialize even without matching manual groups.

## Reviewing and applying results

Expanded member rows show the latest task status and suggested multiplier. Open a member to inspect that account's own history, balance delta, usage, and failure reasons. Standalone channels keep the existing single-channel workflow.

A member result never changes pricing automatically. An operator with multiplier-adjustment permission must select and confirm a result before its suggestion is applied to the parent logical pool's public multiplier. Large changes still need another stable result from the same account unless the operator explicitly forces the confirmation.

## Prerequisites and notes

- Reading requires channel-probe read permission. Saving an ordinary profile, running, clearing or resetting requires execute permission, step-up verification and replay protection. Editing or deleting a profile bound to a shared account additionally requires the dedicated account-pool management permission, preventing unauthorized changes to requests carrying shared tokens.
- Applying a multiplier requires the separate channel multiplier-adjustment permission.
- Profiles and runs are removed according to the server retention policy. Historical results do not guarantee future upstream pricing or balance.
- Balance-workflow credentials stay server-side. Batch configuration never copies source credentials or account bindings; legacy standalone-channel copy remains subject to its existing permission.

Related pages: `relay-settings`, `upstream-status`.
