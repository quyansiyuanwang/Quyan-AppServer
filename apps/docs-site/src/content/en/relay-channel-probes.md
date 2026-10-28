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

With IAM enforcement enabled, the account pool list requires `quyan:relay:ListProbeAccounts` on each `acs:platform:*:platform:relay-probe-account/<accountId>` resource. Platform account-pool management qualification remains a prerequisite; attaching an account policy alone cannot grant it. Denied accounts expose no configuration, cooldown or session status. The list shows only whether credentials are configured and does not load or return stored login requests or encrypted credentials.

Deleting an account requires `quyan:relay:DeleteProbeAccount` for its account ARN, as well as platform probe-account management qualification, step-up verification and replay protection. Accounts still bound to channel profiles cannot be deleted. Authorization is checked before deletion and again at commit; a revoked grant preserves the account and its cached session.

Updating an account requires `quyan:relay:UpdateProbeAccount` for its account ARN. Omitted credentials retain their existing values; supplied credentials replace the full credential map. Login requests remain encrypted, and responses include neither credentials nor login workflows. If authorization changes at commit, the configuration update is rolled back and the existing cached session is preserved.

Creating an account requires `quyan:relay:CreateProbeAccount` on both the creation control `acs:platform:*:platform:relay-probe-account-control/default` and the future account ARN, normally granted with `acs:platform:*:platform:relay-probe-account/*`. The server reserves a resource ID and checks both grants before encrypting and saving credentials. Shadow evaluation uses the same ARN as the account that is ultimately created. Credentials are required on creation.

Manual refresh requires `quyan:relay:RefreshProbeAccount` for the account ARN, plus step-up verification and replay protection. Native refresh rechecks authorization after waiting for active probes, before sending the login request and when publishing the session. Failure or revocation does not replace a valid existing session with the new session. Login attempts still count toward cooldown. Shadow mode previews metadata authorization, then executes the original refresh flow once.

## Applying suggested multipliers

In IAM enforcement mode, applying a probe result uses `quyan:relay:ApplyProbeRun`. It requires platform multiplier-management qualification and grants on the run, channel, profile and physical member ARNs. A logical pool multiplier affects the entire pool, so every affected current member must also be authorized; access to only one member is insufficient. This operation does not read or return profile credentials, upstream keys, balance ledgers or probe samples.

Only successful, stability-verified, unapplied results from the past 24 hours are eligible. The current channel multiplier and pricing snapshot must still match the measurement. Changes to model pricing, mappings, target overrides, endpoints or time/context multipliers require a new probe. Large changes normally need another stable result with the same current pricing snapshot, and that confirmation run must also be authorized. Explicit large-change confirmation bypasses only the second-result requirement, never resource authorization, expiry or pricing validation.

Each result commits independently. The multiplier update and applied marker share a transaction; revocation or a concurrent conflict rolls both back, while other successful results remain applied. Shadow mode previews resource scopes and executes the existing application flow once.

## Per-target configuration and shared templates

Under IAM enforcement, batch target configuration uses `quyan:relay:ConfigureProbeTarget` on the selected channel, profile and physical member. A source template additionally requires its channel/profile resources. When a profile is missing, the server reserves its ARN and commits the new profile with target settings together; failed validation or revocation leaves no partial profile. Templates transfer shared settings, not source credentials or account bindings.

A target-only format/model/payload/group edit protects that target and its bound account. Replacing shared profile defaults from a source additionally checks every affected current member, configured target and bound account. Bound-account edits require the dedicated account-pool qualification and `quyan:relay:ModifyBoundProbeProfile`, preventing ordinary configuration access from rewriting workflows that carry shared tokens.

The target's credentials, account bindings and omitted target settings remain unchanged. Changing format requires a compatible payload. Each target commits independently, and active runs block changes. Configuration responses do not return existing account bindings; read them through an authorized read operation.

## Binding and unbinding shared accounts

Under IAM enforcement, binding requires the dedicated deployment-managed account-pool qualification and `quyan:relay:BindProbeAccount` on the channel, profile, selected physical member and new account ARN. Ordinary probe-executor qualification or an account-owned wildcard policy cannot replace platform account-pool qualification.

Replacing an account, or unbinding with `accountId: null`, additionally requires `quyan:relay:UnbindProbeAccount` on the old account. Permission to bind a new account cannot remove an unauthorized old binding. Rebinding the same account does not require an unrelated unbind grant. Checks never load login ciphertext or tokens, and responses return only the selected target and newly bound account ID.

Queued or running work blocks binding changes. Authorization is checked after the channel-lock wait and again at commit; revocation rolls back that target without undoing independently successful targets. Existing target format, model, payload and serialization group survive binding changes.

## Reviewing and applying results

Expanded member rows show the latest task status and suggested multiplier. Open a member to inspect that account's own history, balance delta, usage, and failure reasons. Standalone channels keep the existing single-channel workflow.

A member result never changes pricing automatically. An operator with multiplier-adjustment permission must select and confirm a result before its suggestion is applied to the parent logical pool's public multiplier. Large changes still need another stable result from the same account unless the operator explicitly forces the confirmation.

The overview uses `quyan:relay:ListProbeOverview` on each channel. Denied or invisible channels and members are omitted, including their customer-facing pool labels. Profile content additionally requires `quyan:relay:GetProbeProfile`; latest results require `quyan:relay:ListLatestProbeRuns`, with the same resource checks as their dedicated read endpoints. These components can be omitted independently without hiding an otherwise authorized channel. Target overrides require `quyan:relay:GetProbeTargetConfig` on the parent channel, target channel and profile. If an override binds a shared account, that Action must also allow the account ARN; otherwise neither the override nor its account-derived credential status is shown. Strict pool membership takes precedence even when every strict member is denied or unavailable.

When native IAM enforcement is enabled, latest-result polling checks `quyan:relay:ListLatestProbeRuns` on both channel ARNs (`acs:platform:*:platform:relay-channel/<channelId>`) and run ARNs (`acs:platform:*:platform:relay-probe-run/<channelId>/<runId>`). A pooled target also requires access to its current physical member. Denied channels are omitted; when the latest run is denied, that target has no visible result and an older run is never substituted. Channel visibility and the deployment-managed probe-read qualification still apply.

History uses `quyan:relay:ListProbeRuns` for the parent channel, any selected physical member, and every returned run. Pagination and totals include only authorized records. Results for members that no longer belong to the pool are excluded; an explicitly requested member must still belong to that pool.

Resetting queued or running work under native IAM enforcement requires `quyan:relay:ResetProbeRuns` on the channel, selected or affected members, every active run, and each queue slot (`acs:platform:*:platform:relay-probe-queue-slot/<channelId>/<memberId>`; use `channel` for the parent slot). A whole-pool reset includes current member slots and former members with active tasks. The slot grant also controls recovery of an orphan reservation that has no task record. Any denied resource prevents all cancellation. Authorization is rechecked at commit, and queue cleanup only removes values observed before cancellation; a newer reservation is never force-deleted. If queue cleanup becomes unavailable after cancellation commits, the endpoint reports failure and retains the slot for a later authorized retry.

Clearing history under native IAM enforcement requires `quyan:relay:ClearProbeHistory` on the channel, related physical members, and every selected terminal run. If any selected resource is denied, the entire cleanup is refused. Authorization is checked again at commit and revocation rolls back deletion. Running and queued tasks are preserved; the failed-only scope also preserves successful results.

Reading a probe profile under native IAM enforcement requires `quyan:relay:GetProbeProfile` on its channel and on `acs:platform:*:platform:relay-probe-profile/<channelId>/<profileId>`. Workflow configuration and credential names are read only after these checks. Responses contain no credential values. For a pooled profile, credential names include only current members allowed by the same Action; denied or former member names are omitted.

Saving a profile under native IAM enforcement requires `quyan:relay:SaveProbeProfile` on its channel and existing or server-reserved profile ARN. A pooled update also requires access to every current physical member and all configured targets; denial rejects the whole save. Editing a profile bound to shared accounts additionally requires `quyan:relay:ModifyBoundProbeProfile` on every bound account ARN and the deployment-managed account-pool qualification. Authorization is checked after acquiring the channel lock and again at commit; revocation rolls back creation or updates. Omitted standalone credentials remain unchanged; pooled credentials retain only current members, and corrupt existing pooled credentials cause the save to fail rather than silently discarding them.

Deleting a profile requires `quyan:relay:DeleteProbeProfile` on its channel, profile, configured physical targets and linked historical runs. History is retained with its profile link removed. A bound shared account also requires `quyan:relay:UnbindProbeAccount` on that account ARN and the dedicated deployment-managed account-pool qualification. Queued or running tasks block deletion. All configuration removal and history detachment roll back if authorization is revoked at commit.

## Run authorization and queue validity

Under IAM enforcement, creating a single run requires `quyan:relay:CreateProbeRun` on the channel, profile, server-reserved run ARN and queue slot. Pooled runs also require the selected physical member; a bound account requires its account ARN. Executing a bound-account probe does not grant account-management access. The deployment-managed probe-executor qualification remains required.

Batch runs use the same `quyan:relay:CreateProbeRun` Action and repeat authorization and queue checks for each target. Pool expansion discovers only allowed, currently enabled members; existing strict membership never falls back to legacy membership. Explicit and expanded targets are deduplicated, and one target failing does not block others. A request accepts at most 100 channel IDs and schedules at most 200 expanded targets; oversized expansion is refused, not silently truncated. Failures return a safe generic reason without policy contents or internal errors.

Run resources use `acs:platform:*:platform:relay-probe-run/<channelId>/<runId>`. Queue slots use `acs:platform:*:platform:relay-probe-queue-slot/<channelId>/<memberId-or-channel>`: standalone channels use the literal final segment `channel`, while pooled members use their actual member ID. The server generates the run ID, so creation policies commonly use a run wildcard restricted to the intended channel. An explicit deny on any related resource prevents creation.

Before execution, after shared-lock waits, before each balance/model/account-login request and before publishing results, the worker rechecks its lease, identity, role session, current policies and profile/target configuration. A reset, revoked authorization or configuration change stops subsequent probe requests. Requests already sent upstream cannot be recalled and may still incur charges.

AccessKey-initiated runs are also bound to the specific key: disabling, expiring, rotating or reassigning it stops execution, while normal usage-counter updates do not revoke the run. Changes to the user or account-owner record invalidate older queue authorization as well.

Server-side queue authorization context remains valid for at most two hours. Enforcement does not continue when that context expires, its cache is lost or authorization is unavailable; investigate and submit a new run. Handle older queued jobs without this context before enabling enforcement. Browsers never receive the queue authorization context, credentials or tokens.

## Copying profile templates

Under IAM enforcement, copying standalone-channel profiles requires `quyan:relay:CopyProbeProfile` on the source channel/profile and each target channel plus its existing or server-reserved profile ARN. Deployment-managed probe-executor qualification, step-up verification and replay protection remain required. Targets commit independently, so a denied target does not block others. Pooled channels do not support this copy entry point; configure members individually instead.

Native copying transfers workflow and calibration settings only. It never reads or copies source ciphertext or transfers account bindings. New profiles do not inherit source credentials; overwrites preserve the target's credentials, account bindings and target configuration. Overwriting a bound profile additionally requires the dedicated account-pool qualification and `quyan:relay:ModifyBoundProbeProfile` on each target account. Queued/running work blocks target overwrites. Verify workflow variables against the target's own credentials before running a probe.

Legacy/shadow modes retain the earlier copy workflow, including its standalone credential copying. Only enforcement uses the non-transferring behavior above. Check target credentials before switching modes rather than relying on legacy copies to supply them.

## Prerequisites and notes

- Reading requires channel-probe read permission. Saving an ordinary profile, running, clearing or resetting requires execute permission, step-up verification and replay protection. Editing or deleting a profile bound to a shared account additionally requires the dedicated account-pool management permission, preventing unauthorized changes to requests carrying shared tokens.
- Applying a multiplier requires the separate channel multiplier-adjustment permission.
- Profiles and runs are removed according to the server retention policy. Historical results do not guarantee future upstream pricing or balance.
- Balance-workflow credentials stay server-side. Batch configuration never copies source credentials or account bindings; legacy standalone-channel copy remains subject to its existing permission.

Related pages: [Relay settings]({{DOCS_BASE_URL}}/en/relay-settings), [Upstream status]({{DOCS_BASE_URL}}/en/upstream-status).
