# Channel balance probes

Channel balance probes use a minimal model request to compare upstream balance movement, actual usage, and the current channel multiplier. They are for operators with channel-management access. Balance-workflow credentials are never shown or exported to the browser.

## Working with pooled channels

A pool remains one logical channel, but can be expanded to inspect each physical account. Every account has its own credential status, latest probe, and run action. A probe always stays on the selected account and never rotates through other members during the same task.

The pool shares one format, model, balance workflow, and calibration configuration. Initial setup requires balance-workflow credentials for every enabled member. Later edits need only the accounts being changed; saved credentials are not displayed again. Members that are disabled, missing credentials, or incompatible with the configured format or model are marked as unavailable.

Run members one at a time, or confirm a run for all currently available members. Tasks follow the server queue and probe-group rules. Balance reads and minimal model requests can incur real upstream charges.

## Reviewing and applying results

Expanded member rows show the latest task status and suggested multiplier. Open a member to inspect that account's own history, balance delta, usage, and failure reasons. Standalone channels keep the existing single-channel workflow.

A member result never changes pricing automatically. An operator with multiplier-adjustment permission must select and confirm a result before its suggestion is applied to the parent logical pool's public multiplier. Large changes still need another stable result from the same account unless the operator explicitly forces the confirmation.

## Prerequisites and notes

- Reading requires channel-probe read permission. Saving, running, clearing, or resetting requires execute permission and uses the service's current step-up verification and replay protection.
- Applying a multiplier requires the separate channel multiplier-adjustment permission.
- Profiles and runs are removed according to the server retention policy. Historical results do not guarantee future upstream pricing or balance.
- Balance-workflow credentials are server-side only. Importing, exporting, and copying probe rules never includes them.

Related pages: `relay-settings`, `upstream-status`.
