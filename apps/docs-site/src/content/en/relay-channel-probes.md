# Channel balance probes

Channel balance probes send real model requests to compare upstream balance changes, usage, and channel multipliers for pricing calibration. They can incur upstream charges without creating a user bill. An authorized operator must confirm and apply a suggested multiplier.

## Requirements

| Operation                                                              | Required permission                                                              |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Read channels, profiles, and results                                   | `relay:channel:probe:read`                                                       |
| Save ordinary profiles, run/reset tasks, clear history                 | `relay:channel:probe:execute`                                                    |
| Manage/bind shared accounts or change an account-bound shared workflow | `relay:channel:probe:account:manage`, plus the applicable operation requirements |
| Apply multipliers                                                      | `relay:channel:multiplier:adjust`                                                |

Channels must be accessible to you and configured with supported formats, models, upstream addresses, and API credentials. These operations do not accept OAuth access tokens. Mutations and execution require 2FA step-up and replay protection. IAM enforcement additionally requires platform global group eligibility and the resource actions below.

The server keeps balance-workflow secrets and shared-account tokens; saved values are not displayed or exported. Place secrets under probe credentials and reference them in workflows instead of embedding them in ordinary configuration fields that may be displayed.

## Probe a standalone channel

1. Find the channel, select **Manage probe**, and open **Probe profile**. The default list shows enabled channels only; check the state filter and access if a channel is missing.
2. Enable the profile and select a compatible format, model, and endpoint. Inspect the minimal request body. Model calls use the channel's saved upstream address and API credentials, separately from balance-workflow credentials.
3. Configure the balance workflow with a numeric balance path in exactly one step. Supply required probe credentials and check currencies, balance divisor, settlement ratio, and sampling.
4. Save successfully, then return to the list and run the probe. Queued does not mean measurement succeeded.
5. Inspect the latest status and open **Runs** to review balance changes, usage, calibration status, samples, and errors.
6. Apply a multiplier only after checking the result and application requirements. Probes do not change prices automatically.

## Configure the workflow and measurement

Balance workflows support 1–3 sequential GET or POST steps. Reference credentials or previously extracted variables using `{{variableName}}`. A bound shared account provides the reserved `{{accountToken}}` variable; do not define it as a custom account credential.

Balance and extraction paths address response JSON. For `{"data":{"balance":120}}`, use `data.balance`. Object fields and array indexes are supported, not full JSONPath expressions such as wildcards. The balance must convert to a finite number.

| Setting                                            | Guidance                                                                                                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format, model, endpoint, payload                   | Must be mutually compatible and supported by the target. Review custom JSON after changing formats; arbitrary custom fields are not guaranteed to migrate automatically |
| Raw balance divisor                                | Raw balances are divided by this value before calculation; default 1. For example, use 100 to convert cents to currency units                                           |
| Upstream and local currencies                      | Must match for a comparable suggestion. Currency labels do not perform exchange-rate conversion                                                                         |
| Upstream settlement ratio, distribution multiplier | Both affect target cost; each defaults to 1. Check the actual settlement relationship                                                                                   |
| Measurement input token target                     | Defaults to 1024, range 0–32768. Expands supported text to improve measurement signal; it does not guarantee that exact upstream token count                            |
| Balance stability tolerance and consecutive reads  | Default tolerance 0.000001 and 2 consecutive reads. The workflow is repeated while waiting for charges and a stable balance                                             |
| Samples and strict validation                      | Together determine sample quantity and validation, as explained below                                                                                                   |
| Serial group                                       | Coordinates probes in the group. Probes sharing an account are mutually exclusive even across different groups                                                          |

The balance workflow can run repeatedly before and after each sample, not just once per task. Keeping a login step inside it can repeatedly log in; use shared accounts for shared login sessions.

Omitting new credentials preserves the standalone channel's or member's saved values. When replacing credentials, submit the complete set of keys needed for that target. Blank inputs do not delete existing credentials.

## Sampling, caching, and costs

Samples range from 1 through 10, defaulting to 3 for new profiles, and execute sequentially. Each measurement sends a model request and reads balances repeatedly. Measurement text and warmup can increase upstream usage. Failure, interruption, or reset cannot withdraw issued requests or charges. Other activity spending the same upstream balance can also distort measurements; make sure balance movement can be attributed to this probe.

| Cache mode                          | Behavior and limits                                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Avoid cached responses, the default | Attempts to inject a unique prompt marker to reduce cache interference; it cannot guarantee the upstream never caches                                                |
| Allow upstream cache                | Does not inject a cache-busting marker; measures reported upstream usage                                                                                             |
| Warm up then measure cache hits     | Each sample warms up before measurement. Warmup cost is recorded separately and excluded from suggestions. Measurement usage must report cache reads to verify a hit |

If a custom payload cannot accept a cache marker, execution is rejected by default. Correct its format or use a minimal preset first. Allowing execution without a cache-busting marker only permits the request; it does not prove cache-free measurement.

Strict calibration validation is off by default. One comparable sample can produce `verified`, which does not establish multi-sample stability. When enabled, at least three valid samples are required, with checks for low signal, settlement stability, outliers, and spread. Inspect the validation setting and accepted/discarded sample counts together.

## Find and review results

Name/ID search is case-insensitive and immediately filters loaded channel rows. It does not search member names or historical bodies. Serial group, profile state, enabled state, latest run status, and suggestion filters combine; changing filters clears the current selection.

While known tasks are queued/running, the page polls latest states about every three seconds and stops when they finish. **Refresh** reloads the overview. A failed load can leave old rows visible; resolve the error and retry.

Expand pools for each member's latest task. Member details show history for that member. Current details retrieve the most recent 20 records without history pagination controls; older results require the authorized paginated history API. Retention and current visibility still apply.

Successful execution does not guarantee an applicable suggestion. Check raw usage, samples, balance snapshots, calibration, and cost breakdown. Different currencies, missing local pricing, small balance movements, unverified cache hits, or unstable settlement can prevent a usable suggestion.

The cost relationship is:

```text
Target cost = converted upstream balance decrease × upstream settlement ratio × distribution multiplier
Suggested multiplier = target cost ÷ local base cost
```

Local base cost uses usage and billing configuration at measurement time. Estimated charges on this page are not user bills or promises of future upstream prices.

## Apply a suggested multiplier

1. Open application for a result, or select results and open the batch application dialog.
2. Inspect current, suggested, and target multipliers, relative changes, and affected customer-facing channels. Adjust the target and rounding if needed; rounding cannot make an otherwise invalid result applicable.
3. Select the results to submit, complete confirmation and verification, and inspect successes and rejections. Failed items do not undo successful ones.

A result must have finished within 24 hours, succeeded, be `verified` and unapplied, and contain a valid billing snapshot. Current multipliers and billing settings must still match the measurement. Reprobe after changes to pricing, mappings, target overrides, endpoints, or time/context multipliers.

Changes exceeding 20% of the current multiplier normally require another `verified` result for the same account and billing snapshot within 24 hours, with a sufficiently close suggestion. Explicit large-change confirmation skips only that second-result requirement, not expiry, snapshots, or authorization.

**Applying a pool member's result changes its logical pool's shared customer-facing multiplier and affects the entire pool.** Applying one of several results for the same channel changes the current multiplier; other results may then conflict or become inapplicable. Check actual results before probing again.

## Use pools, shared accounts, and batch configuration

Pools share workflows and calibration settings. Each physical member can override format, model, payload, and serial group, and use its own balance credentials or a shared account. A task stays pinned to its selected member. Disabled members, missing credentials, or incompatible formats/models prevent execution.

Workflow/calibration changes in a member drawer still affect the shared profile. The page saves the shared profile, member overrides, and any account binding sequentially, **not as one transaction**. Later failure can leave earlier steps saved. Refresh and inspect the shared profile, member settings, and binding separately before retrying failed steps.

With account-management permission, create a login configuration in the shared accounts tab:

1. Configure the login request and credentials, token path, and expiry field or fallback lifetime. Defaults are a 1800-second fallback and a 300-second minimum login interval.
2. Bind the saved account to a target and reference `{{accountToken}}` in balance requests. Model calls still use channel API credentials.
3. Remove old login steps from the balance workflow manually. Binding does not edit the workflow; old steps otherwise keep running.
4. Check session state and the next permitted login time. Failed attempts count toward cooldown, and manual refresh does not bypass the interval. Probes sharing the account are mutually exclusive.

Editing does not display the saved login URL, method, headers, query, or body. Re-enter the complete login request; leaving it blank fails validation. Omitted credentials remain unchanged; supplied credentials replace the map. Creation requires credentials. Expiry mode `seconds` means duration from login; `iso` means an absolute time, not a Unix timestamp. Missing expiry data uses the fallback. Bound accounts cannot be deleted directly.

Batch configuration can use an existing profile as a shared template, with compatible per-target format, model, payload, group, and account selections. Targets save independently; inspect each result. Templates do not transfer source credentials or bindings. Format changes require a compatible payload. Queued/running work can block target changes. The legacy standalone profile-copy behavior below differs from batch target configuration.

## Reset tasks, clear history, and remove profiles

| Operation            | Effect                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Reset run state      | Cancels queued/running tasks in scope and attempts queue-slot cleanup; issued upstream requests cannot be recalled               |
| Clear failed history | Deletes terminal records in the failed scope, preserving successes and active tasks                                              |
| Clear all history    | Deletes terminal records in scope, preserving queued/running tasks; no page restore                                              |
| Clear probe profile  | Removes configuration and related target settings, retaining history without its profile association; active tasks block removal |

The service periodically deletes probe run records created more than 90 days ago, not necessarily at the exact expiry instant. Clearing or disabling a profile does not undo upstream usage already incurred.

## IAM authorization reference

The resource rules below apply to IAM enforcement. The actual platform global group must provide the appropriate reading, execution, account-management, or multiplier-adjustment eligibility. Account ownership, added permissions, private groups, and wildcard policies alone do not establish platform eligibility. Channel visibility remains enforced.

Reading and actions are separate. Seeing a channel in the overview does not grant profile, result, credential-state, or multiplier application access. Credential values are not delivered in query results.

### Read overviews, profiles, and results

The overview uses `quyan:relay:ListProbeOverview` on each channel. Denied or invisible channels and members are omitted, including their customer-facing pool labels. Profile content additionally requires `quyan:relay:GetProbeProfile`; latest results require `quyan:relay:ListLatestProbeRuns`, with the same resource checks as their dedicated read endpoints. These components can be omitted independently without hiding an otherwise authorized channel. Target overrides require `quyan:relay:GetProbeTargetConfig` on the parent channel, target channel and profile. If an override binds a shared account, that Action must also allow the account ARN; otherwise neither the override nor its account-derived credential status is shown. Strict pool membership takes precedence even when every strict member is denied or unavailable.

When native IAM enforcement is enabled, latest-result polling checks `quyan:relay:ListLatestProbeRuns` on both channel ARNs (`acs:platform:*:platform:relay-channel/<channelId>`) and run ARNs (`acs:platform:*:platform:relay-probe-run/<channelId>/<runId>`). A pooled target also requires access to its current physical member. Denied channels are omitted; when the latest run is denied, that target has no visible result and an older run is never substituted. Channel visibility and the deployment-managed probe-read qualification still apply.

History uses `quyan:relay:ListProbeRuns` for the parent channel, any selected physical member, and every returned run. Pagination and totals include only authorized records. Results for members that no longer belong to the pool are excluded; an explicitly requested member must still belong to that pool.

Reading a probe profile under native IAM enforcement requires `quyan:relay:GetProbeProfile` on its channel and on `acs:platform:*:platform:relay-probe-profile/<channelId>/<profileId>`. Workflow configuration and credential names are read only after these checks. Responses contain no credential values. For a pooled profile, credential names include only current members allowed by the same Action; denied or former member names are omitted.

### Save and delete profiles

Saving a profile under native IAM enforcement requires `quyan:relay:SaveProbeProfile` on its channel and existing or server-reserved profile ARN. A pooled update also requires access to every current physical member and all configured targets; denial rejects the whole save. Editing a profile bound to shared accounts additionally requires `quyan:relay:ModifyBoundProbeProfile` on every bound account ARN and the deployment-managed account-pool qualification. Authorization is checked after acquiring the channel lock and again at commit; revocation rolls back creation or updates. Omitted standalone credentials remain unchanged; pooled credentials retain only current members, and corrupt existing pooled credentials cause the save to fail rather than silently discarding them.

Deleting a profile requires `quyan:relay:DeleteProbeProfile` on its channel, profile, configured physical targets and linked historical runs. History is retained with its profile link removed. A bound shared account also requires `quyan:relay:UnbindProbeAccount` on that account ARN and the dedicated deployment-managed account-pool qualification. Queued or running tasks block deletion. All configuration removal and history detachment roll back if authorization is revoked at commit.

### Run authorization and queue validity

Under IAM enforcement, creating a single run requires `quyan:relay:CreateProbeRun` on the channel, profile, server-reserved run ARN and queue slot. Pooled runs also require the selected physical member; a bound account requires its account ARN. Executing a bound-account probe does not grant account-management access. The deployment-managed probe-executor qualification remains required.

Batch runs use the same `quyan:relay:CreateProbeRun` Action and repeat authorization and queue checks for each target. Pool expansion discovers only allowed, currently enabled members; existing strict membership never falls back to legacy membership. Explicit and expanded targets are deduplicated, and one target failing does not block others. A request accepts at most 100 channel IDs and schedules at most 200 expanded targets; oversized expansion is refused, not silently truncated. Failures return a safe generic reason without policy contents or internal errors.

Run resources use `acs:platform:*:platform:relay-probe-run/<channelId>/<runId>`. Queue slots use `acs:platform:*:platform:relay-probe-queue-slot/<channelId>/<memberId-or-channel>`: standalone channels use the literal final segment `channel`, while pooled members use their actual member ID. The server generates the run ID, so creation policies commonly use a run wildcard restricted to the intended channel. An explicit deny on any related resource prevents creation.

Before execution, after shared-lock waits, before each balance/model/account-login request and before publishing results, the worker rechecks its lease, identity, role session, current policies and profile/target configuration. A reset, revoked authorization or configuration change stops subsequent probe requests. Requests already sent upstream cannot be recalled and may still incur charges.

AccessKey-initiated runs are also bound to the specific key: disabling, expiring, rotating or reassigning it stops execution, while normal usage-counter updates do not revoke the run. Changes to the user or account-owner record invalidate older queue authorization as well.

Server-side queue authorization context remains valid for at most two hours. Enforcement does not continue when that context expires, its cache is lost or authorization is unavailable; investigate and submit a new run. Handle older queued jobs without this context before enabling enforcement. Browsers never receive the queue authorization context, credentials or tokens.

### Reset and clear history

Resetting queued or running work under native IAM enforcement requires `quyan:relay:ResetProbeRuns` on the channel, selected or affected members, every active run, and each queue slot (`acs:platform:*:platform:relay-probe-queue-slot/<channelId>/<memberId>`; use `channel` for the parent slot). A whole-pool reset includes current member slots and former members with active tasks. The slot grant also controls recovery of an orphan reservation that has no task record. Any denied resource prevents all cancellation. Authorization is rechecked at commit, and queue cleanup only removes values observed before cancellation; a newer reservation is never force-deleted. If queue cleanup becomes unavailable after cancellation commits, the endpoint reports failure and retains the slot for a later authorized retry.

Clearing history under native IAM enforcement requires `quyan:relay:ClearProbeHistory` on the channel, related physical members, and every selected terminal run. If any selected resource is denied, the entire cleanup is refused. Authorization is checked again at commit and revocation rolls back deletion. Running and queued tasks are preserved; the failed-only scope also preserves successful results.

### Manage shared accounts

With IAM enforcement enabled, the account pool list requires `quyan:relay:ListProbeAccounts` on each `acs:platform:*:platform:relay-probe-account/<accountId>` resource. Platform account-pool management qualification remains a prerequisite; attaching an account policy alone cannot grant it. Denied accounts expose no configuration, cooldown or session status. The list shows only whether credentials are configured and does not load or return stored login requests or encrypted credentials.

Deleting an account requires `quyan:relay:DeleteProbeAccount` for its account ARN, as well as platform probe-account management qualification, step-up verification and replay protection. Accounts still bound to channel profiles cannot be deleted. Authorization is checked before deletion and again at commit; a revoked grant preserves the account and its cached session.

Updating an account requires `quyan:relay:UpdateProbeAccount` for its account ARN. Omitted credentials retain their existing values; supplied credentials replace the full credential map. Login requests remain encrypted, and responses include neither credentials nor login workflows. If authorization changes at commit, the configuration update is rolled back and the existing cached session is preserved.

Creating an account requires `quyan:relay:CreateProbeAccount` on both the creation control `acs:platform:*:platform:relay-probe-account-control/default` and the future account ARN, normally granted with `acs:platform:*:platform:relay-probe-account/*`. The server reserves a resource ID and checks both grants before encrypting and saving credentials. Shadow evaluation uses the same ARN as the account that is ultimately created. Credentials are required on creation.

Manual refresh requires `quyan:relay:RefreshProbeAccount` for the account ARN, plus step-up verification and replay protection. Native refresh rechecks authorization after waiting for active probes, before sending the login request and when publishing the session. Failure or revocation does not replace a valid existing session with the new session. Login attempts still count toward cooldown. Shadow mode previews metadata authorization, then executes the original refresh flow once.

### Per-target configuration and templates

Under IAM enforcement, batch target configuration uses `quyan:relay:ConfigureProbeTarget` on the selected channel, profile and physical member. A source template additionally requires its channel/profile resources. When a profile is missing, the server reserves its ARN and commits the new profile with target settings together; failed validation or revocation leaves no partial profile. Templates transfer shared settings, not source credentials or account bindings.

A target-only format/model/payload/group edit protects that target and its bound account. Replacing shared profile defaults from a source additionally checks every affected current member, configured target and bound account. Bound-account edits require the dedicated account-pool qualification and `quyan:relay:ModifyBoundProbeProfile`, preventing ordinary configuration access from rewriting workflows that carry shared tokens.

The target's credentials, account bindings and omitted target settings remain unchanged. Changing format requires a compatible payload. Each target commits independently, and active runs block changes. Configuration responses do not return existing account bindings; read them through an authorized read operation.

### Bind and unbind shared accounts

Under IAM enforcement, binding requires the dedicated deployment-managed account-pool qualification and `quyan:relay:BindProbeAccount` on the channel, profile, selected physical member and new account ARN. Ordinary probe-executor qualification or an account-owned wildcard policy cannot replace platform account-pool qualification.

Replacing an account, or unbinding with `accountId: null`, additionally requires `quyan:relay:UnbindProbeAccount` on the old account. Permission to bind a new account cannot remove an unauthorized old binding. Rebinding the same account does not require an unrelated unbind grant. Checks never load login ciphertext or tokens, and responses return only the selected target and newly bound account ID.

Queued or running work blocks binding changes. Authorization is checked after the channel-lock wait and again at commit; revocation rolls back that target without undoing independently successful targets. Existing target format, model, payload and serialization group survive binding changes.

### Copy standalone profiles

Under IAM enforcement, copying standalone-channel profiles requires `quyan:relay:CopyProbeProfile` on the source channel/profile and each target channel plus its existing or server-reserved profile ARN. Deployment-managed probe-executor qualification, step-up verification and replay protection remain required. Targets commit independently, so a denied target does not block others. Pooled channels do not support this copy entry point; configure members individually instead.

Native copying transfers workflow and calibration settings only. It never reads or copies source ciphertext or transfers account bindings. New profiles do not inherit source credentials; overwrites preserve the target's credentials, account bindings and target configuration. Overwriting a bound profile additionally requires the dedicated account-pool qualification and `quyan:relay:ModifyBoundProbeProfile` on each target account. Queued/running work blocks target overwrites. Verify workflow variables against the target's own credentials before running a probe.

Legacy/shadow modes retain the earlier copy workflow, including its standalone credential copying. Only enforcement uses the non-transferring behavior above. Check target credentials before switching modes rather than relying on legacy copies to supply them.

### Authorize result application

In IAM enforcement mode, applying a probe result uses `quyan:relay:ApplyProbeRun`. It requires platform multiplier-management qualification and grants on the run, channel, profile and physical member ARNs. A logical pool multiplier affects the entire pool, so every affected current member must also be authorized; access to only one member is insufficient. This operation does not read or return profile credentials, upstream keys, balance ledgers or probe samples.

Each result commits independently. The multiplier update and applied marker share a transaction; revocation or a concurrent conflict rolls both back, while other successful results remain applied. Shadow mode previews resource scopes and executes the existing application flow once.

## Troubleshooting

| Symptom                                | Suggested action                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Channel or member is missing           | Clear name/group/state filters, check channel visibility and current membership, and verify separate reading actions              |
| Balance or variable path fails         | Check paths against the actual response, use exactly one balance path, define variables before use, and ensure a numeric balance  |
| Settlement timeout or low signal       | Check upstream posting delays, balance precision, divisor, and measurement input; do not use failed calibration to change prices  |
| Cache marker cannot be injected        | Use a compatible minimal preset or correct the custom text structure before explicitly allowing marker-free execution             |
| Account login fails or is cooling down | Check the complete login request, token/expiry paths, credentials, and next login time; repeated refresh does not bypass cooldown |
| Successful result cannot be applied    | Check calibration, completion time, billing snapshot, current multiplier, large-change confirmation, and resource authorization   |
| Save failed but some settings changed  | Refresh and check the shared profile, overrides, and binding independently; sequential saves do not guarantee overall rollback    |
| Reset request failed                   | Cancellation may have committed before queue cleanup failed. Refresh task state and have an authorized operator retry             |

## Related pages

- [Relay settings]({{DOCS_BASE_URL}}/en/relay-settings)
- [Upstream status]({{DOCS_BASE_URL}}/en/upstream-status)
