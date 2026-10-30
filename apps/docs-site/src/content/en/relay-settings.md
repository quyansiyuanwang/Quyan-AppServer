# Relay settings

This page manages two kinds of relay configuration:

- relay-wide behavior such as queues, monitor mappings, global multipliers, and model pricing
- channel-level behavior such as upstream endpoints, pooled routing, visibility allowlists, model restrictions, and time-based multipliers

If you need to answer questions like “who can see this channel?”, “which upstream handles this model?”, or “how do multiple upstreams fail over?”, this is the page that defines that behavior.

## Page purpose

- Adjust relay-wide defaults and traffic handling behavior.
- Maintain monitor display names used in status views.
- Configure model pricing and supported formats.
- Create standalone channels, logical pools, physical members or automatic proxy pools.
- Set visibility, routing, upstream credentials, and pricing multipliers per channel.

## Before you begin

Open Relay settings and wait for the relevant global configuration and channel list to load. Viewing, creating, updating, toggling, copying, importing and exporting require separate permissions. Page access does not grant every operation. Complete step-up verification when prompted. Providers should use [Channel supply and earnings]({{DOCS_BASE_URL}}/en/channel-provider-revenue) to submit channels.

Global configuration, pricing drafts and channel editors save separately. Channel edits, batch actions and channel imports send requests immediately; they do not require the global Save button afterward.

## Save global settings and model prices

1. Wait for the relevant configuration group to load before changing multipliers, queues or monitor mappings.
2. Add or edit a pricing row and select token-based or per-request pricing. Input and output prices are per million tokens; fixed prices are per request. The model name selects the billing item, while the model ID is sent upstream.
3. To import prices, paste an array or JSON containing a `models` array. Supply the model name, input price and output price; per-request rows also require a fixed price. Import merges into the **current draft** by trimmed model name and does not save to the server.
4. Review the complete price list before saving. A pricing change replaces all active prices, deleting omitted records, including records hidden by read permissions. If you cannot read the full list, obtain full read access or use authorized single-record pricing APIs.
5. Check the result. After partial success, retry only unsaved configuration groups. A normal save does not reload the entire page; refresh when you need to verify current server values.

Pricing export and copy on this page serialize the current draft, including unsaved changes and only the rows currently visible to you. Use the file to inspect or transfer a draft, not as a complete server backup. The `ExportModels` and `ImportPricing` permissions below apply to dedicated pricing APIs; this page's draft import/export does not call those APIs.

Zero input/output token prices can be saved. Although a per-request fixed price of `0` can also be saved, current per-request settlement treats it as missing. Do not promise free requests on that basis; validate a complete request and its settlement using a valid price first.

## Create and maintain channels

1. Choose Create in the channel list. Enter a name, type and visibility. An allowlist must include at least one user, group or role.
2. For standalone channels and physical members, choose protocols and supply each protocol's upstream URL and API key. Physical members also require a logical parent pool. For logical pools, select members and a routing strategy.
3. Review model restrictions, billing multipliers, mappings and provider shares, then save. A successful creation appears in the list. Channel enablement and whether the provider offers service are separate availability controls.
4. Open the editor to update a channel. Existing keys are never filled in. Untouched key fields preserve the saved value; explicitly clearing a field submits removal, which is rejected if an enabled protocol then lacks credentials. The editor saves the complete channel form. Refresh and reopen it before editing a channel maintained by several people.
5. Inspect details after saving to confirm status, capabilities and parent relationships. If saving reports an error, refresh and inspect the result before retrying, especially before creating another channel.

In strict two-tier mode, the pool editor first saves the logical pool, then saves each physical member's parent, priority, weight and enabled state individually. These requests are not one transaction. A later failure may leave the pool and some members saved. Removing a member from the draft does not detach its persisted parent relationship. To move a member, select and save it in the destination pool, then check both pools.

### Request header forwarding

Open **Relay settings (`/relay/settings`) → Channel list → Create or edit a standalone channel/physical member → Request header forwarding**. You need channel-create or update permission. Save in the channel editor to apply changes. Logical and automatic proxy pools use the selected physical member's configuration; edit that member channel.

“Forward all eligible request headers” is off by default. Only the defaults below and your extra allowlist are forwarded. Protocol-specific rows follow the actual upstream protocol, including when requests are converted.

| Scope                                             | Default headers                                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| All protocols                                     | `content-type`, `accept`, `accept-encoding`, `user-agent`, `x-request-id`, `x-client-request-id`, `idempotency-key`, `x-opencode-session` |
| OpenAI (including Chat Completions and Responses) | `openai-organization`, `openai-project`, `openai-beta`                                                                                    |
| Anthropic                                         | `anthropic-version`, `anthropic-beta`                                                                                                     |
| Gemini                                            | `x-goog-api-client`                                                                                                                       |

Enter exact names in “Extra allowlist” and press Enter; do not enter values or wildcards. Up to 64 names are allowed, each at most 128 characters. Saving trims whitespace, lowercases names and removes duplicates.

Enable “Forward all eligible request headers” to forward eligible fields without listing each name. Your extra allowlist is retained; turning the switch off restores the defaults plus the saved extra names. Both modes exclude caller credentials, cookies, Host, message framing, hop-by-hop fields and fields nominated by `Connection`, internal routing and security-verification metadata. Invalid names or values are not forwarded. Upstream authentication always uses credentials from the selected physical channel.

### Batch operations

Filter by name, type, enablement or submission status, then select targets. Select all covers only the current page. Existing selections survive page and filter changes; check the selected count and clear selections when needed before acting.

- Batch editing submits only fields whose checkboxes are enabled, and Apply saves immediately. Review complete values for whole fields such as model restrictions, mappings and rule lists.
- Batch probing only retrieves models; Apply writes the restrictions. Business validation may reject individual items. Review the failure list; successful items are removed from the selection.
- Enable/disable and delete execute after confirmation. Disable temporarily stops routing; deletion cleans necessary routing references and cannot be reversed by enabling the channel again.
- Single and batch copying create copies immediately. Copies exclude providers, earnings history and grants. Physical children of a strict logical pool remain with the original pool.

### Import and export channels

Export or copy JSON uses selected channels by default, or requests all channels if none are selected. Copy all always ignores the selection. Exports include required dependencies and disabled configuration, but exclude upstream URLs, API keys and provider identities.

Import accepts an array or JSON containing a `channels` array; each entry requires a name. Supply destination URLs and credentials for enabled protocols first. Submitting immediately creates channels, remaps references within the batch to new IDs and does not overwrite existing channels with the same name. Protect files containing credentials. IAM enforcement accepts up to 200 entries per atomic batch; see the reference below for permissions and other authorization modes.

### Common problems

- Loading failed: an old list may remain visible and does not prove a successful refresh. Restore read access before editing.
- Save rejected: check operation and reference-resource permissions, step-up verification, model validation and topology, then refresh before retrying.
- Visible but unusable channel: check enablement, provider-service status, protocols, model restrictions and member paths. Visibility does not replace IAM usage authorization.

## Global settings

### Global multiplier

- Purpose: applies a top-level multiplier before channel-specific pricing.
- Effect: final billing commonly reflects `global multiplier × channel multiplier × time-based multiplier`.
- Guidance:
  - Use model pricing or channel multipliers for targeted adjustments.
  - Change the global multiplier only when you need a broad pricing shift across the whole relay system.

### Queue enabled, max concurrency, queue timeout

- Purpose: control whether overload is queued or fails quickly. Text/default requests coordinate concurrency per user; images use a separate shared deployment-wide pool, not one pool per user. Global AI budgets may shorten the wait further. Unavailable coordination storage rejects requests rather than removing the limit.
- Effect:
  - lower `max concurrency` protects upstreams but pushes more traffic into queueing
  - shorter `queue timeout` returns failures faster; longer timeout makes users wait longer
- Guidance:
  - use conservative values when upstream quotas are tight or rate limits are common
  - review error rate and status dashboards after changing production values

### Upstream stream timeout

- Purpose: limits inactivity while waiting for an upstream response or further data, rather than the total answer duration.
- Effect: short values can interrupt answers with long data gaps. `0` disables this timeout, but global resource protection and client timeouts can still terminate requests.

### Monitor name mapping

- Purpose: replace raw monitor IDs with clearer admin-facing labels.
- Effect: changes presentation only, not actual routing logic.

The settings page loads relay configuration and custom-key configuration independently. Fields from a group that could not be loaded are disabled and are not submitted. Saving sends changed relay fields only, so changing queue settings does not replace unchanged prices. Changing pricing still replaces the complete active list, including records not visible under your read permissions. If one configuration group saves and the other fails, the page reports partial success and retry submits only the unsaved changes.

## Channel configuration overview

There are four channel types. Physical members carry requests through their logical parent pool:

- `Standalone channel`: connects directly to a real upstream and stores its URL and key.
- `Pooled channel`: combines multiple existing channels into one logical channel that users see as a single option.
- `Physical member`: an execution channel with upstream configuration, belonging to one logical pool in strict two-tier mode.
- `Automatic proxy pool`: a special shared logical channel whose members are centrally maintained for token automatic-routing mode.

### Channel name

- Purpose: identifies the channel everywhere admins and users inspect it.
- Effect: appears in token binding, logs, details, and orchestration screens.
- Guidance: name channels by purpose rather than provider internals, such as `OpenAI Primary Pool` or `Claude Backup Low-Cost Pool`.

### Channel type

#### Standalone

- Best for: one upstream, one credential set, one direct exit path.
- Effect: requires real upstream URL and API key data for each enabled format.

#### Pooled

- Best for: failover, weighted load distribution, and hiding multiple physical channels behind one logical name.
- Effect:
  - users and tokens typically see only the pooled logical channel
- member channels carry the actual traffic
- the pool itself does not store direct upstream credentials
- In strict two-tier topology, click Add Physical Member to select candidates and save. Member assignments are written individually.
- In legacy topology, select standalone channels; saving updates the pool's own member list, and members can be removed from that editor.
- In strict two-tier topology, saving converts selected channels to physical members, assigns them to this logical pool, and applies priority, weight, and enabled state from the list order. To move a member, select it again from the destination pool editor.

#### Automatic proxy pool

- Best for: centrally managed or automated member updates without requiring every token to be reconfigured.
- Members: logical pooled and standalone channels can be added together; physical pooled members and other automatic proxy pools cannot be added.
- Billing: the resolved member supplies the model pricing and channel/time multipliers; the token owner pays the resulting charge.
- Visibility: token users select the automatic proxy pool, not its underlying members.

## Pool members and routing strategy

### Pool members

- Member channel: a concrete channel the pool may route to.
- Legacy member: legacy topology stores member relationships on the pool editor, where a member can be removed directly.
- Physical member: in strict two-tier topology, belongs to exactly one logical pooled channel. The management list displays its logical parent instead of a member count.
- Member relationships: existing legacy and strict two-tier relationships are both recognized. When the same member exists in both, strict priority, weight, and enabled settings apply.
- Priority: lower numbers are tried earlier in priority-based strategies.
- Weight: mainly used by weighted-random routing; larger values increase selection probability.
- Enabled state: disabled members do not participate in current routing.

Guidance:

- Put primary production channels at higher priority.
- Give higher weights to channels with more capacity or lower cost.
- For troubleshooting, disable a member before deleting it.

### Routing strategy

#### Priority failover

- Behavior: tries the first member first and only moves down when it fails.
- Best for: clear primary/backup routing with predictable cost control.

#### Random

- Behavior: chooses any eligible member at random.
- Best for: upstreams with similar performance where natural distribution is enough.

#### Weighted random

- Behavior: distributes requests according to configured weights.
- Best for: explicit traffic splits such as 80% primary, 20% backup.

#### Round robin

- Behavior: rotates through members in order.
- Best for: evenly spreading traffic across similarly capable channels.

#### Health priority

- Behavior: uses dynamic ranking. Price-first or stability-first configuration also controls order; the strategy name alone does not determine the result.
- Best for: environments with reliable health telemetry where availability matters more than strict ordering.

#### Latency priority

- Behavior: currently uses the same dynamic-ranking entry point as health priority, rather than a separate ascending-latency sort. A latency threshold can filter candidates.
- Best for: latency-sensitive interactive traffic.

## Routing parameters

New forms prefill some recommended values; existing channels use their saved values. Dynamic ranking defaults to price-first; stability-first uses availability and weight. Missing or insufficient automatic telemetry does not exclude channels, while manual health values apply immediately. If thresholds exclude every enabled member, routing falls back to the base order. Thresholds are not an absolute refusal policy.

### Max channel switches

- Recommended default: `2`
- Purpose: limits different members tried after the first in an ordinary pool. Automatic proxy pools try all eligible members without this cap; global request budgets can still stop attempts earlier.
- Effect: values that are too low can prevent later channels from ever being reached; values that are too high can increase end-to-end latency.
- Guidance:
  - `2` is a practical default for pools with up to three main primary/backup paths
  - increase it when your pool has more ordered members that should actually be reachable

### Retries per channel

- Recommended default: `0`
- Current pooled execution attempts each member only once. This form field does not add retries on the same member. Do not rely on increasing it to retry; the similarly named token custom-failover setting has separate semantics.

### Failover match rules

- Recommended default: `4xx`, `5xx`
- Purpose: decides which upstream outcomes should trigger retry or failover.
- Effect:
  - `5xx` covers most upstream internal failures
  - `4xx` also covers rate limits, auth failures, and unsupported request patterns
- Guidance:
  - keep the defaults for broad protection in most environments
  - remove `4xx` and use narrower rules such as `429` and `5xx` if you do not want client-style errors to trigger switching

### Failback cooldown (minutes)

- Recommended default: `5`
- Purpose: after switching to a later member, keep preferring that member for a short period instead of immediately jumping back to earlier ones.
- Effect: reduces oscillation when the primary channel is flapping.
- Guidance: a few minutes is usually a good fit for primary/backup pools.

### Health score threshold

- New-form default: blank, so this filter is disabled.
- During dynamic ranking, members with trusted availability below the threshold are excluded. The range is `0–1`; higher values are stricter.

### Latency threshold (ms)

- New-form default: blank, so this filter is disabled.
- During dynamic ranking, members with a known average latency above this value are excluded. No positive latency sample means no exclusion by this filter. Values are in milliseconds.

### Circuit breaker threshold

- New-form default: blank, so this filter is disabled.
- During dynamic ranking, a trusted health window failure count at or above the threshold excludes a member. This is a cumulative count, not a guarantee of consecutive-failure circuit breaking.

### Sticky by model

- Recommended default: `Disabled`
- Purpose: keeps the same model tending to land on the same member.
- Effect: helps cache locality, consistency, and troubleshooting.
- Guidance: leave it disabled unless you specifically want model-level consistency or cache reuse.

### Sticky by format

- Recommended default: `Disabled`
- Purpose: keeps the same request format, such as OpenAI or Anthropic, tending to land on the same member.
- Effect: useful when protocol compatibility differs across underlying channels.
- Guidance: leave it disabled by default. Enable it when different members have materially different protocol compatibility.

## Visibility settings

### Public

- Purpose: any relevant user can see and use the channel.
- Best for: standard production channels.

### Private

- Purpose: hide the channel from ordinary users.
- Best for: admin testing, migration work, drills, and sensitive upstreams.

### Whitelist

- Purpose: only selected users, groups, or roles can see the channel.
- Best for: targeted pilots, internal beta access, tiered customers, or dedicated vendor routes.

#### User allowlist

- Effect: grants visibility directly to named users.
- Guidance: best for small point-to-point testing.

#### Group allowlist

- Effect: grants visibility to all members of a group.
- Guidance: best for departments, tenants, or long-lived plan segmentation.

#### Role allowlist

- Effect: grants visibility to principals with specific RAM roles.
- Guidance: best when access is already managed through role-based boundaries.

Note: the page tries to load users, groups, and roles for selection, but admins can still enter raw IDs manually if the desired target is not listed.

## Format and model restrictions

### Allowed formats

- Purpose: declares which request protocols the channel can accept.
- Effect:
  - only selected formats are treated as usable on this channel
  - standalone channels must provide complete upstream URL and API key data for the enabled formats

### Model allowlist

- Purpose: restricts a channel to specific models.
- Effect:
  - once enabled, any model not in the list will not route through this channel
  - in pooled setups, this directly changes which members are eligible
- Guidance: enable this when an upstream supports only certain models or when you need cost control.

### Batch probe and apply models

The channel management batch actions include **Batch probe models**. After selecting channels, you can probe the OpenAI, Anthropic, and Gemini upstream `/v1/models` endpoints separately:

- Only models with global pricing can be selected or applied. Unmatched models remain visible but cannot be selected.
- Applying merges by channel: only selected models actually discovered on that channel are added to its existing restriction. Existing models are not removed, and unsupported models are not written.
- Channels without the upstream URL or credential for a format are skipped. A failure on one channel does not stop the others.
- Probe results are kept only in the current dialog and are not persisted.

The automatic proxy pool member picker can filter candidates by each channel's currently effective model restrictions:

- Choose either **Any match** or **All match**; the default is any match.
- After selecting channels and confirming, the filter models are merged into the pool-level manual restriction. Member channel restrictions are not modified.
- Channels configured as all models or inferred from pool members match every configured pricing model and may not reflect actual upstream support. To filter accurately, first use batch probing to apply the models each channel actually supports.

## Upstream configuration

### OpenAI / Anthropic / Gemini upstream URL

- Purpose: defines the real endpoint receiving the traffic.
- Effect: the URL decides whether traffic reaches the original vendor, a proxy, or a private gateway.

### API key

- Purpose: stores the credential used when the channel talks to that upstream.
- Effect: missing or invalid credentials will make requests for that format fail.

Guidance:

- Only enable the formats the standalone channel truly serves.
- Do not place test credentials on channels that are visible to production users.

## Billing and mapping

### Channel multiplier

- Purpose: adds a per-channel pricing adjustment on top of the global multiplier.
- Effect: useful when one upstream is more expensive or when a premium route needs markup.

### Input tokens include cache read

- Purpose: handles upstreams that already include cache read tokens inside `input_tokens`.
- Effect: when enabled, subtracts cache-read tokens already included in the input count. Cache creation and reads still have separate multiplier-based charges; disabling this option does not remove cache charges.
- Guidance: enable only when you know the upstream reports cache read usage that way.

### Model mapping

- Purpose: maps a requested model to another billing or routing target model.
- Effect:
  - helps normalize vendor aliases
  - can bill several near-equivalent models against one pricing target
- Risk: incorrect mappings can create a mismatch between the requested model and the billed model.

## Time-based multipliers

- Purpose: applies an extra multiplier to a channel during selected weekdays and time ranges.
- Best for: peak pricing, night discounts, and weekday/weekend differentiation.
- Effect: matching rules further adjust the final effective channel price.

Guidance:

- Name rules after their business meaning, such as `Weekday Peak Hours`.
- Confirm timezone assumptions before rolling them into production.

### Chinese holiday conditions and all-day multipliers

Time-period rules offer three holiday conditions:

- **Ignore holidays** preserves existing weekday filters and the server local timezone.
- **Exclude holidays** requires the selected weekday and time range to match, and the date must not be a Chinese holiday.
- **Holidays only** ignores weekday selection but still applies the configured time range.
- **All day** bypasses the time range, covering the entire date including 23:59.

Holiday-dependent rules use Asia/Shanghai for dates, weekdays and time ranges. Holidays include extended breaks in the published annual calendar. Makeup working days never turn Saturday or Sunday into a weekday. Overnight ranges use the request's current calendar date.

**DeepSeek peak/off-peak example:** set the base channel multiplier to the off-peak multiplier. Add a peak rule for Monday–Friday, the applicable peak hours, and **Exclude holidays**, with a rule multiplier equal to peak price divided by off-peak price. Weekends, including makeup-working weekends, and holidays then retain the base multiplier all day. Enter applicable prices and hours yourself; existing channels are not changed automatically.

A non-all-day time range must have different start and end times. Existing zero-length rules remain inactive; select **All day** or set a real time range when editing.

Matching rules multiply together rather than override each other. Avoid overlapping holiday discounts. Management, provider channel editing and batch editing support these fields.

The backend obtains annual calendars from an external service, normally refreshes daily, caches validated data in Redis and memory, and prefetches the next year. Billing never waits for an external request. Refresh failures retain the last valid calendar. If no valid calendar exists for a year, holiday-dependent rules are skipped and a warning is logged; ordinary rules and base channel pricing remain active. This also applies during initial startup before the cache is ready. Unpublished years are not guessed. Operators should monitor backend holiday-calendar warnings.

## Operating guidance

1. For external production traffic, start with pooled channels plus priority failover and a small number of clear primary/backup members.
2. Default testing channels to `private` or `whitelist` visibility so users do not consume them accidentally.
3. When upstream compatibility differs, reduce risk with format restrictions and model allowlists.
4. Before publishing pricing changes, check global multiplier, channel multiplier, and time-based multipliers together to avoid unintended stacking.
5. After changing pooled routing, review switch logs and status views to confirm failover behaves as intended.

## Channel supply and revenue sharing

Administrators can review channel status, add multiple providers in the channel editor, and configure each provider's 0% to 100% share and settlement mode. The total may exceed 100%; the editor shows the resulting platform subsidy. Earnings use the actual execution channel and an immutable percentage snapshot from the time of consumption. Users can submit standalone channels and inspect earnings on the [Channel supply and earnings]({{DOCS_BASE_URL}}/en/channel-provider-revenue) page.

## Permission and API reference

### Global configuration save permission

In IAM enforcement mode, saving global settings uses `quyan:relay:UpdateConfiguration`. It requires `MODEL_PRICING_UPDATE` eligibility from a real global group and an Allow for `acs:platform:*:platform:relay-configuration/default`.

If configuration has not been saved yet, an authorized save creates it using the same defaults returned by the read API. A read alone never creates configuration. A concurrent first save is rechecked before commit; a rejected or failed save leaves no partial configuration.

`modelRates` replaces the active pricing list: omitting the field preserves prices; an empty array deletes every active price; a supplied list updates existing models, restores deleted models with their original IDs, creates new models, and deletes active models omitted from the list. Every affected record, including omitted deletion targets, requires an Allow for `acs:platform:*:platform:model-pricing/<record ID>`. Creation also requires `acs:platform:*:platform:model-pricing-control/default` and the actual generated record ARN.

A denied resource, stale configuration or pricing snapshot, or changed permissions or role session fails the entire save without partial updates. Switching to strict channel topology still requires a topology check. Duplicate model names, invalid pricing types, and unsupported formats are rejected; the fixed price for per-request billing may be zero. 2FA verification and replay protection remain applicable.

Prices in a successful save response are individually checked with `quyan:relay:GetConfiguration`. Without price read permission, the response may contain an empty list; this does not mean existing prices were deleted. Save permission does not automatically grant price read permission.

### Global configuration read permission

In IAM enforcement mode, reading global settings uses `quyan:relay:GetConfiguration`. It requires `MODEL_PRICING_UPDATE` eligibility from a real global group and an Allow for `acs:platform:*:platform:relay-configuration/default`. Configuration and model prices are authorized separately: prices use `acs:platform:*:platform:model-pricing/<record ID>`, and the response includes only allowed records. Configuration-only access can return an empty price list; pricing-only access cannot read the configuration. A matching Deny takes precedence.

If no configuration has been saved, an authorized read returns defaults without creating a configuration. Changes to eligibility, policies, role sessions, or authorized content during the read cause the request to fail. Unavailable storage does not produce a successful defaults response. Read permission does not grant permission to save settings.

### Model pricing export permissions

In IAM enforcement mode, pricing exports require eligibility from a real global group with `MODEL_PRICING_READ`, using `quyan:model_pricing:ExportModels` on `acs:platform:*:platform:model-pricing/<record ID>`. Exports include only authorized actual records, and a matching Deny takes priority. If prices, eligibility, policies, or role sessions change while reading, the export is withheld. AssumeRole uses the role's own grants. The public model pricing list retains its existing access behavior.

### Model pricing write permissions

Single-record creation, updates, and deletion require eligibility from a real global group with `MODEL_PRICING_UPDATE`, using `quyan:model_pricing:CreatePricing`, `quyan:model_pricing:UpdatePricing`, and `quyan:model_pricing:DeletePricing`. Creation checks both `acs:platform:*:platform:model-pricing-control/default` and the actual record ARN. Updates and deletions use the actual record ID. Restoring a deleted model keeps its original ID, so resource Deny statements remain effective.

If the target price, identity, eligibility, or authorization changes before saving, the operation fails without partially saving changes. Pricing modes and supported formats must be valid. Switching to per-request pricing requires a fixed price, which may be zero. Missing or unauthorized mutation targets return 403 in IAM enforcement mode. Two-factor verification and replay protection continue to apply.

### Model pricing bulk import permissions

Bulk imports use `quyan:model_pricing:ImportPricing` and require eligibility from a real global group with `MODEL_PRICING_UPDATE`, covering both the fixed creation scope and every affected record ARN. New models are checked against their actual generated ARN before saving. Deleted models retain their original ID when restored, so existing Deny statements continue to apply. If any record is denied, a pricing snapshot is stale, or authorization changes, the entire batch rolls back without skipping failed items.

Each import accepts up to 499 distinct models. Names duplicated after trimming, unknown fields, and invalid pricing modes or formats are rejected. New models default to token-based pricing when the mode is omitted. Existing models retain an omitted pricing mode. Explicit fixed prices and supported formats are saved during import. Two-factor verification and replay protection continue to apply.

### IAM global channel topology audit

Before enabling strict two-tier topology, the audit requires `quyan:relay:AuditChannelTopology` on both `acs:platform:*:platform:relay-configuration/default` and `acs:platform:*:platform:relay-channel/<channelId>` for every non-deleted channel. The caller also needs `RELAY_CHANNEL_READ` eligibility from a deployment-managed global group, and existing channel visibility rules continue to apply. If any participating channel or configuration is inaccessible, the entire request returns 403; a partially visible graph never produces a global `canEnableStrict` conclusion.

The audit includes disabled, non-deleted channels and checks legacy pool membership, missing or invalid pooled parents, a non-member incorrectly assigned to a pooled parent, and automatic pools referencing physical channels. Readiness is reported only for a complete, valid graph. Authority, configuration, or topology changes during the read cause rejection. The operation reads only topology fields, not upstream credentials or model prices, and does not create default configuration. Switching modes still requires separate global-configuration write permission.

### IAM channel change request lists

In IAM enforce mode, “My change requests” uses `quyan:relay:ListMyChannelChangeRequests` on `acs:relay:*:<accountId>:channel-change-request/<submitterId>/<requestId>`. Only the current submitter's requests are included. Wildcard grants do not expose another user's personal requests, whether in the same account or a different account.

The review list uses `quyan:relay:ListChannelChangeRequests` on `acs:platform:*:platform:relay-channel-change-request/<channelId>/<requestId>`. Reviewers still require `RELAY_CHANNEL_REVIEW` eligibility from a deployment-managed global group; an account-owned group or policy cannot create that eligibility. Qualified reviewers may review different submitters' requests, but each request must be individually allowed.

Both lists authorize each request before computing pagination and totals, excluding deleted requests or channels. Configuration includes only documented public fields and credential-presence flags, never plaintext or encrypted credentials. Role sessions use only role policies. Refresh and retry if identity, eligibility, policy, or session authority changes during the read.

### IAM channel management list

With IAM enforcement enabled, the management table uses `quyan:relay:ListManagementChannels` against each `acs:platform:*:platform:relay-channel/<channelId>`. Records, pagination and totals include only allowed channels within the existing visibility and filter rules. Denied parent names and member references are hidden. Model filters use only admitted paths through the channel pool, preserving strict child settings over duplicate legacy membership; a denied leaf cannot contribute models. This Action grants list access, while channel changes and delivery require their own Actions. Deployment management qualification is still required. Refresh and retry if authority changes while loading.

### IAM channel health access

In IAM enforce mode, the standalone overview uses `quyan:relay:ListChannelHealth`, detail uses `quyan:relay:GetChannelHealth`, and the automatic-pool list uses `quyan:relay:ListAutomaticPoolHealth`. All target `acs:platform:*:platform:relay-channel/<channelId>`. Detail and automatic-pool reads additionally require `quyan:relay:ReadChannelPoolHealthMetadata` on each returned channel and participating member. Health access does not grant channel configuration or upstream credential access.

The overview requires deployment-managed `RELAY_CHANNEL_HEALTH_READ` eligibility. Detail and automatic-pool reads also require `RELAY_CHANNEL_POOL_METADATA_READ` eligibility. Account-owned groups, user-added permissions and wildcard policies cannot create those platform qualifications. Existing visibility rules still apply; a policy grant cannot make a hidden member visible.

Lists and automatic-pool members contain only individually allowed, visible resources. Member health, names, scores and displayed ranks are based on this authorized subset, not proof of the pool's complete global topology. Disabled and provider-paused non-deleted channels remain visible for diagnosis, with their existing disabled/eligibility indicators. Manual health overrides and ranking thresholds retain their configured behavior. Missing and denied detail both return 403; authority or relevant configuration changes during loading reject the result. These unscoped endpoints do not accept OAuth tokens. Legacy/shadow retain the existing business read, without a second health/configuration read during shadow observation.

#### Updating health tracking settings

In IAM enforce mode, both `PATCH /v1/relay-channels/{id}/health-config` and `PATCH /v1/relay-channels/health/batch-config` require `quyan:relay:UpdateChannelHealthConfig` on **every** target channel ARN. Deployment-managed `RELAY_CHANNEL_UPDATE` eligibility and existing visibility rules still apply. These endpoints accept standalone channels only, including disabled channels; they do not accept OAuth tokens. Two-factor verification and replay protection remain required.

A denied, missing, deleted or invalid target rejects the entire batch without partial writes. Existing non-health routing settings and credentials are preserved. Manual mode requires availability and latency; automatic/disabled modes clear those manual overrides. The single-channel response contains health statistics, not channel configuration or credentials; it does not additionally require a health-read Action. Changes to authority or relevant configuration detected before commit roll back the write. Legacy/shadow keep the existing write behavior; shadow observation does not perform a second write.

#### Clearing collected health statistics

In IAM enforce mode, single and batch clearing require `quyan:relay:ClearChannelHealth` on **every** target `acs:platform:*:platform:relay-channel/<channelId>`, plus deployment-managed `RELAY_CHANNEL_UPDATE` eligibility. Clear authority is distinct from changing health settings or reading health. Existing visibility rules, two-factor verification and replay protection still apply. Only non-deleted standalone channels are accepted, including disabled channels; these unscoped endpoints reject OAuth tokens. A missing, deleted, denied or pool target prevents the entire batch from reaching Redis.

Authorization is checked immediately before the irreversible operation and again before accepting the response. A final authorization failure can reject the response **after** statistics have been cleared. The audit distinguishes confirmed clearing from an uncertain storage outcome, and records whether the request was ultimately accepted; it does not claim the old data was restored. Legacy/shadow retain the existing business clear, with no extra clearing during shadow observation.

Clearing statistics does not change the configured tracking mode or manual overrides. A batch clears retained time buckets for all selected channels with one Redis operation, rather than independent per-channel deletions. Unrelated channels and request-sample deduplication records are not cleared; later traffic can immediately create new statistics.

Redis clearing is irreversible and is not rolled back by a database transaction. If the storage connection fails before confirmation, the request reports an error but the operation may already have completed. Refresh the health view to verify the current state; do not assume an error restored the previous statistics.

### IAM channel configuration access

In IAM enforce mode, `GET /v1/relay-channels` uses `quyan:relay:ListChannels`; `GET /v1/relay-channels/{id}` uses the separate `quyan:relay:GetChannel` Action. Both target `acs:platform:*:platform:relay-channel/<channelId>` and require READ or REVIEW eligibility from a deployment-managed global group. An account policy alone cannot grant that eligibility. Listing a channel does not grant detail access, mutation, export, or credential access.

Only individually allowed, business-visible channels appear. Denied parents and members are omitted, and denied or invisible leaves cannot contribute model capabilities to a pool. Disabled or provider-paused channels are excluded from the default list; `includeDisabled=true` includes their configuration. A detail read may show disabled metadata without advertising active capabilities. Credential fields are presence booleans only, never secret values. Nested routing, visibility and multiplier configuration includes only registered fields. Unknown legacy JSON fields are omitted without changing the saved configuration; invalid registered values cause the read or mutation response to be rejected instead of returning malformed private data. Administrator configuration retains valid retry expressions and model mappings.

OAuth retains the channel-read scope for the list; the unscoped detail endpoint does not accept OAuth tokens. AccessKeys and role sessions use their existing authority, rechecked before return. A missing or denied detail returns the same 403. Refresh and retry if identity, policy, visibility, membership, or session authority changes during loading. Legacy/shadow retain the original business read; shadow does not fetch a second configuration payload.

### Batch channel enable/disable

In IAM enforce mode, single channel toggles and batch enable/disable use `quyan:relay:SetChannelStatus` on every selected `acs:platform:*:platform:relay-channel/<channelId>`. It requires `RELAY_CHANNEL_UPDATE` eligibility from an active deployment-managed global group; an account-owned group, extra user permission, or wildcard policy cannot create that eligibility. A role session uses only its role grants, within the same management ceiling.

Submit 1–200 distinct, existing, undeleted channel IDs and a JSON boolean `enabled` (`true` or `false`, not the string `"false"`). Every selected resource must be allowed. A denied or missing channel, or a change to resource, identity, policy, AccessKey, OAuth, or role-session authority before commit, prevents the whole batch from taking effect. OAuth clients and access tokens must retain the channel-update scope. The endpoint returns only counts: it does not read credentials, require channel-read permission, detach tokens, change pool membership, or change provider-service eligibility. Replay protection and step-up verification remain required. Legacy/shadow keep their original authorization behavior; shadow does not issue a second status write.

### Resource-scoped channel availability

Single toggles and batch enable/disable share `quyan:relay:SetChannelStatus` on the platform channel ARN. A single toggle reads the current status and flips it in one authorized transaction; it does not accept a client-supplied status or Action. The resulting safe configuration is checked within the same transaction. It never returns upstream credential values, and pooled capabilities only include separately authorized related channels. Counts-only batches do not need permission to disclose channel configurations.

Identity, policy, role session, AccessKey, authorization-mode or final target changes cancel the entire mutation. Single toggles retain step-up verification and replay protection, and do not accept OAuth tokens. Existing `RELAY_CHANNEL_UPDATE` permissions map to the Action automatically. JSON policies using the old account-owned `quyan:relay:channel:Update` alias must explicitly grant the platform Action and ARN. Legacy/shadow modes invoke the existing write once; shadow does not generate a second native configuration response.

### Resource-scoped channel deletion

With IAM enforcement enabled, both single and batch channel deletion require `quyan:relay:DeleteChannel` for each target, using `acs:platform:*:platform:relay-channel/<channelId>`. These channels are shared deployment resources, not resources under the caller's account ARN. The caller must also retain deployment-managed channel-deletion eligibility; an account policy cannot create that eligibility. Step-up verification and replay protection still apply.

Policies using the older `quyan:relay:channel:Delete` alias with an account-owned channel ARN must be updated to the Action and platform ARN above before using the native operation. Legacy `RELAY_CHANNEL_DELETE` permissions are mapped automatically; a JSON policy does not gain new platform authority merely because its resource ID matches.

All requested channels must be authorized and still exist. A denied, missing, already deleted or changed target cancels the entire request. Deletion and its mandatory routing-reference cleanup commit together: direct and automatic-pool token references are cleared, selected-channel and pool memberships are removed, and active change requests for the deleted channels are retired. Unrelated channels and historical provider/earnings records are not deleted. Deletion does not grant access to token values, upstream keys or other channel configurations. During migration, legacy/shadow modes retain the existing business deletion; shadow evaluation does not delete a second time.

### Resource-scoped batch model restrictions

With IAM enforcement enabled, applying batch model restrictions requires `quyan:relay:ApplyChannelModelRestrictions` on every target channel, `acs:platform:*:platform:relay-channel/<channelId>`, including a target that ultimately fails model business validation. The operator must retain deployment-managed channel-update eligibility; account policies cannot create that eligibility. Step-up verification and replay protection remain required.

The server admits the complete batch before merging locally priced model names per channel. Manual restrictions retain existing names; automatic pools switch to the selected manual scope while retaining other routing settings. Unknown pricing names, distinct pricing names sharing a request-model identity, or malformed historical restrictions produce safe per-channel rejections while valid peers may still update. Per-item reasons do not echo arbitrary user input or internal exceptions.

A denied target, identity or permission change, model-catalog change, or response-data change cancels the entire batch instead of merely skipping one target. The operation does not change channel enablement, provider pauses, visibility, credentials, revenue configuration or token assignments. Responses never contain key values; related pool capabilities appear only when their resources are separately authorized. Existing `RELAY_CHANNEL_UPDATE` permissions map to the new Action; legacy/shadow modes perform the original business write only once.

### Resource-scoped batch upstream model discovery

With IAM enforcement enabled, querying upstream models in bulk requires `quyan:relay:BatchListUpstreamModels` on **every** requested `acs:platform:*:platform:relay-channel/<channelId>` resource. Deployment-managed channel-update eligibility is also required; an account policy alone cannot grant platform administration. The operation does not grant permission to read or export upstream credentials or other channel configuration.

- All targets must be admitted before any saved credential is read or any upstream request is sent. Missing, deleted, denied or non-canonical targets reject the entire batch.
- Only the selected OpenAI, Anthropic or Gemini configuration is used. An incomplete configuration is reported as skipped, never replaced with another protocol's key. Upstream failures are reported per channel without exposing private response bodies or credential values. Results retain the requested channel order.
- Identity, role-session and AccessKey validity, policies, request conditions, channel configuration and model catalog are checked again immediately before each send and before returning the batch. A revocation or relevant change cancels all results rather than turning into a per-channel network error. Already-sent requests cannot be recalled; queued sends stop when the change is detected. No database transaction remains open while awaiting an upstream response.
- Legacy/shadow migration modes retain the original operation. Shadow authorization does not read a second set of saved keys or issue duplicate upstream requests.

### Resource-scoped single upstream model discovery

With IAM enforcement enabled, a single query uses `quyan:relay:ListUpstreamModels`. The server chooses exactly one resource scope:

- **Your own standalone submission:** `acs:relay:*:<accountId>:channel-submission/<yourUserId>/<channelId>`. This branch also applies if you are a platform administrator. A Deny on it cannot be bypassed by retrying against the platform ARN.
- **Another saved channel, or a non-standalone channel:** `acs:platform:*:platform:relay-channel/<channelId>`. Deployment-managed review or update eligibility is required in addition to the policy Allow; submission eligibility alone does not qualify.
- **Preview with a supplied URL and credential, without a channel ID:** `acs:quyan:*:<accountId>:account`, using the authenticated account. This branch reads no saved channel credentials, does not save the supplied credential, and does not permit reading any saved channel. An explicit account-scoped grant can permit preview without platform administration.

When a channel ID is supplied, saved credentials always take precedence; extra URL/key fields cannot override the target, and a missing or denied channel never falls back to preview. Missing configuration for the selected protocol fails instead of borrowing another protocol's key.

Before reading saved keys, before sending and before disclosing results, the server checks current authority and the original resource branch. Revoking a role session or AccessKey, changing ownership, policy, selected configuration or model catalog cancels the result. Already-sent upstream requests cannot be recalled. Responses never include keys, private upstream error bodies or other channel configuration. Legacy/shadow modes run the original operation once; shadow does not send a second probe.

### Server resource protection and audit bodies

Server Configuration includes an advanced AI Resource Protection panel for live admission, queues, RSS, uploads, responses, audit and connection-pool budgets. Saving applies locally at once; other processes normally attempt refresh every five seconds and keep previous values if refresh fails. Running requests retain their starting content budgets. Per-user and image-scope concurrency protections still apply.

Legacy resource environment values are used only before management settings are saved. Audit bodies remain sanitized and available; backlog may omit bodies or drop records with warnings. Audit logs do not replace billing records.

#### Consumer channel catalog permissions

In IAM enforce mode, `GET /v1/relay-channels/catalog` uses `quyan:relay:ListChannelCatalog` on each `acs:relay:*:<yourAccountId>:channel-selection/<channelId>` resource. This is a consumer view of a deployment channel, not permission to administer that channel or read its upstream configuration. An account-level resource does not replace the concrete channel-view grant. The server derives your account from authenticated identity; client Action headers do not change the operation.

For a pool, grant access to the root and to each contributing member whose capabilities and price range should appear. A denied, hidden, disabled, provider-disabled, or otherwise invisible member contributes neither models nor prices. An allowed pool never bypasses a member Deny. Model identity, protocol support, and price remain correlated with the same authorized path. The catalog does not return member identities, routing settings, credentials, upstream URLs, or provider identities. Existing catalog display settings still apply.

Reading the catalog does not grant token-channel selection or platform management. Those operations require their own Actions. OAuth callers still need the channel-read scope in addition to IAM authorization. Revoked policies, role sessions, AccessKeys or OAuth scopes invalidate the result; authorization or data-read failures do not fall back to unrestricted reads. Legacy/shadow modes retain the existing catalog permission gate, and shadow does not perform a second full catalog read.

#### Routing directory and user preview

With IAM enforcement enabled, `GET /v1/relay-channels/routing-catalog` requires `quyan:relay:ListChannelRoutingCatalog` for each `acs:relay:*:<yourAccountId>:channel-selection/<channelId>` shown or used to calculate model capabilities. This consumer Action does not grant platform channel administration, credentials, or permission to select a channel for a token. Roots, logical members and execution leaves are independently checked. An allowed root never bypasses a denied member.

The routing directory retains the limited member controls needed to block automatic-pool routes. Member names, effective multipliers and eligible models refer only to authorized, visible nodes. Each member's models and protocols are resolved through that member's complete path under the selected root, even when two members share an execution leaf. Only supported consumer routing fields are returned; internal settings, unknown fields, credentials and upstream URLs are excluded.

Omitting `targetUserId`, leaving it blank, or setting it to your own ID uses your normal view. Previewing another active user in your account additionally requires `quyan:relay:PreviewChannelRoutingCatalog` on `acs:quyan:*:<yourAccountId>:user/<targetUserId>`. Previewing a user in a different account uses `quyan:relay:PreviewManagedChannelRoutingCatalog` on `acs:platform:*:platform:user/<targetUserId>` and also requires deployment-managed eligibility for reading other users' Relay tokens. A personal policy or account-created group cannot create that platform eligibility. The server selects exactly one preview boundary from persisted account ownership; a denied local preview does not fall back to platform preview.

In every preview, the requesting operator still needs their own channel-view grants. Channels must be visible to **both** the operator and the selected user, and hidden/disabled/provider-disabled nodes stay unavailable. The selected user's policies are not used as the operator's authority. Previewing does not create a token or delegate permissions. Target identity, account ownership, visibility groups/roles, actor policies and authentication are rechecked before release; changed or revoked authority fails safely. OAuth still requires the existing channel-read scope. Legacy/shadow modes retain the original permission gate and perform only one business read.

#### Channel options and optional pool details

Under IAM enforcement, `GET /v1/relay-channels/options` uses `quyan:relay:ListChannelOptions` on each account-local `acs:relay:*:<yourAccountId>:channel-selection/<channelId>`. Both displayed channels and nodes contributing capabilities need their own grant and must remain visible. This options endpoint may include physical members; use the routing directory for end-user selectors that must exclude physical members. `excludePooled=true` removes logical pooled entries, not the authorized contributing branches of an automatic pool.

Basic options do not disclose channel type, member identities, routing settings or per-member prices. To see those optional fields, additionally grant `quyan:relay:ReadChannelOptionPoolMetadata` on each relevant channel-selection resource. This is a limited consumer capability, separate from platform topology/diagnostic privileges. An optional Deny on a member removes its topology and price contribution without granting or removing the independently authorized basic capabilities. A denied intermediate node cannot be bypassed to reveal a shared execution leaf. Public routing settings use supported fields only; regex retry rules are shown as equivalent HTTP status codes, not their raw source text. Credentials and upstream URLs are never returned.

Other-user previews additionally require `quyan:relay:PreviewChannelOptions` on the selected account-local user, or `quyan:relay:PreviewManagedChannelOptions` on the platform user for a different account. Cross-account preview also requires deployment-managed other-user token-read eligibility. The operator's grants and the visibility of both users still apply; routing-directory preview grants do not imply options preview grants. Preview does not authorize token changes or platform administration. OAuth retains the channel-read scope requirement.

When a monthly-pass template specifies channels, creating, editing or publishing it validates those channels through the authenticated operator's allowed channel options. The template-write Action does not replace the channel-options grants. An unavailable, denied or unusable channel cannot be saved as a valid scope. Legacy/shadow modes retain their original permission checks and compatibility reads; enforce never uses a requestless or unrestricted fallback.

#### Portable channel exports

Channel exports no longer contain upstream URLs, API keys, provider identities or credentials, in **any** authorization mode. The JSON is a portable configuration template, not a backup of secrets. Before importing standalone or physical-member channels, supply the destination's upstream URL and credentials for each enabled protocol; the existing import validation still rejects missing upstream configuration. Keep that completed import input private. Export never retrieves credentials on your behalf. Destination provider/revenue-sharing settings are configured separately.

With IAM enforcement enabled, exporting requires deployment-maintained `RELAY_CHANNEL_EXPORT` eligibility plus `quyan:relay:ExportChannels` on every `acs:platform:*:platform:relay-channel/<channelId>` in the export. Explicitly selected roots must all be allowed. Export-all omits unrelated denied roots, but an allowed pool must have a complete authorized dependency closure: legacy members, strict physical children and required logical parents are checked individually, including disabled dependencies. A missing, invisible or denied dependency rejects the entire export instead of producing an incomplete file. Strict child settings override a duplicate legacy edge. The operation does not grant channel reads, mutation, creation or credential access.

Only documented portable fields are included; unknown nested fields are removed. Regex retry rules are converted to equivalent HTTP-code rules without publishing their source; large sets use a canonical code-only pattern that stays within the rule-count limit. Invalid persisted configuration, changed policies/eligibility, expired role sessions, revoked AccessKeys or changed request Conditions withhold the result. Two-factor verification and replay protection remain required; this unscoped endpoint does not accept OAuth. Shadow evaluates metadata admission only and performs one compatibility export. Imported legacy files can still include explicitly supplied upstream settings, but exports will never emit them.

### Resource-scoped administrator channel creation

With IAM enforcement enabled, creating a channel requires `quyan:relay:CreateChannel`. The server reserves the channel ID, producing `acs:platform:*:platform:relay-channel/<channelId>`; a matching destination ARN pattern is normally used for new targets. Operators must also retain deployment-managed channel-create eligibility, which account policies cannot establish. Step-up verification and replay protection remain required. OAuth tokens are not accepted.

New destinations and existing references are authorized separately. A selected parent, member, or necessary indirect reference requires `quyan:relay:UseChannelCreationReference` on each existing channel. Permission to create arbitrary new channels does not grant access to arbitrary existing channels, and reference permission alone cannot create a channel. The catalog, JSON Schema, and policy editor expose this cross-resource dependency as guidance, not as an implicit grant.

All four channel types are supported, subject to strict two-tier mode, parent ownership, automatic-pool member types, cycle checks, and depth limits. A parent used only to prove a physical member's ownership does not require unrelated sibling grants. Explicit providers additionally require `quyan:relay:CreateChannel` on `acs:platform:*:platform:relay-channel-provider/<channelId>/<userId>`. No provider is implicitly added, and this grants no identity-management authority over a recipient.

Administrator-created channels start enabled, approved, and with provider service enabled. No personal submission or review identity is assigned, and no settlement history is copied. Credentials come from the validated creation input; responses indicate whether credentials are configured without returning their values. Name conflicts, denied references, invalid configuration, changed security context, or audit failure cancel the entire creation. The success log commits with the channel. Legacy/shadow modes run the original creation write once; shadow does not persist another channel.

### Resource-scoped single-channel configuration updates

With IAM enforcement enabled, editing a channel requires `quyan:relay:UpdateChannel` on `acs:platform:*:platform:relay-channel/<channelId>`. The operator must also retain deployment-managed channel-update eligibility; account policies or additional permissions cannot establish that deployment eligibility. JSON policies using the old account-scoped `quyan:relay:channel:Update` alias must explicitly grant the new platform Action and ARN. Step-up verification and replay protection remain required. OAuth tokens are not accepted.

Standalone channels, logical pools, physical members, and automatic proxy pools are supported. Topology changes require the necessary old references, new references, and parents under the same Action. Changing a physical member's weight does not require unrelated sibling grants. A logical pool with physical children cannot change to another type. Automatic-pool member types, cycle checks, and strict two-tier restrictions still apply. Channels directly assigned to relay tokens, OJ API keys, or monthly passes cannot be hidden.

Replacing provider configuration also requires `quyan:relay:UpdateChannel` on removed, retained, and new recipient relations: `acs:platform:*:platform:relay-channel-provider/<channelId>/<userId>`. Disabling and reactivating a provider preserves its relation ID and settlement history. This does not grant IAM identity management for the recipient user.

Credentials and relations omitted from the request remain unchanged. Responses never include credential values, and related capabilities include only separately authorized channels. Unknown update fields are rejected. Client Action or account hints cannot change the authorization scope. Changes to authorization, identity, sessions, AccessKeys, conditions, security configuration, or final validation cancel the entire update without partial configuration or relation changes. In legacy/shadow mode the original business write runs once; shadow evaluation does not persist changes from the new path.

### Resource-scoped batch configuration updates

With IAM enforcement enabled, batch updates require `quyan:relay:BatchUpdateChannels` on every requested `acs:platform:*:platform:relay-channel/<channelId>`, including channels that will fail business validation. The operator must retain deployment-managed channel-update eligibility. Client-provided Action or account hints cannot change the authorization boundary; step-up verification and replay protection still apply.

The existing bulk fields and pricing-model migration remain available. A migration target must have the same upstream request-model identity as the selected source; it changes the channel's mapping while retaining unrelated mappings. Hiding a channel remains blocked by direct token, OJ API key or monthly-pass assignments. Ordinary validation failures are returned per channel without changing that channel. Authorization failures, changed security context, unavailable validation dependencies or unsafe final response projection cancel and roll back the entire batch, including earlier successful items.

Responses contain no upstream credential values. Pool capability output requires permission on the related channels under the same Action. Only requested batch fields are changed; credentials, providers, topology assignments and submission ownership are preserved. JSON policies using the old account-local update alias must grant this platform Action explicitly. Legacy/shadow modes continue to use the existing write path once.

Batch configuration and model-restriction rejections use localized business messages. Unexpected storage or validation failures return a generic error rather than raw exception text, SQL or credentials, including in legacy/shadow modes. Authentication and authorization failures reject the request rather than being reported as successful partial processing.

### Resource-scoped channel copying

Single and batch copying require `quyan:relay:DuplicateChannels` on each source and the existing channel references needed by its copied configuration, plus the separate `quyan:relay:CreateChannelCopy` capability on each server-generated destination. Resources use `acs:platform:*:platform:relay-channel/<channelId>`. A destination ARN pattern can cover new IDs without granting wildcard source access. Neither a source-only grant nor destination creation alone is sufficient; the destination capability does not grant general channel creation or arbitrary source copying. The operator must also retain deployment-managed channel-create eligibility. Account policies cannot create this deployment eligibility, and step-up verification and replay protection still apply.

The Action catalog and JSON Schema expose these cross-resource checks as `resourceDependencies`, so policy tools and AI drafts can keep source access separate from destination creation; this metadata does not grant either permission.

Only registered configuration fields are copied; unknown legacy JSON fields are omitted. A copy retains upstream settings and credentials on the server, but no credential value is returned to the browser or included in an export. It starts enabled as an approved administrator-created channel. Providers, settlement history, submitter identity, review history and IAM authorizations are not copied. Copying a pool retains its configured member references; it does not recursively clone or move those channels. A physical member remains under its original logical parent. Strict logical-pool children remain attached to the original pool, so a copied strict pool starts without those children. Batch copying follows the same rules for each selected source rather than remapping references between the copies; use import when you need to remap an exported graph.

Single-channel updates and copies validate their related graph: cycles or any indirect path beyond the safe depth reject the operation, including paths through shared members. A parent used only to prove a physical member's ownership does not expand unrelated members.

Names are generated uniquely unless a single-copy name is provided. A denied or invalid source/reference, name conflict, changed security context, or unsafe final response cancels the entire copy operation without leaving partial channels. Responses contain only authorized related capabilities. JSON policies using the old account-local create alias must explicitly grant both platform copy Actions; legacy/shadow modes retain the existing copy write path once per source.

Success audit records for single-channel configuration updates, batch configuration updates, and channel copies commit with the business changes. A final authorization failure rolls back both the changes and the success record. If that success record cannot be written, the request fails rather than committing an unaudited business change.

#### Resource-scoped atomic channel import

In IAM enforcement mode, importing up to 200 configurations requires `quyan:relay:ImportChannels` on **every server-generated destination channel**. Included provider relations additionally require that same Action on each destination/provider ARN. This does not grant access to existing channels: existing parents, members and indirect dependencies require `quyan:relay:UseChannelCreationReference` separately. References between channels in the same import use the new destination grants instead.

All source IDs must be present and unique, or all must be omitted. Source IDs are used only to remap references; destination IDs are always generated by the server. Parents are created before physical children, forward pool references are supported, and the response preserves input order. Existing-name collisions receive a copy suffix; disabled entries remain disabled. Recognized export timestamps are ignored for destination creation, and unknown fields are rejected.

The batch is all-or-nothing: invalid references, unsupported topology, missing resource permissions, concurrent authorization changes, or failed audit persistence roll back **every** destination and relation. Returned configuration summaries never contain upstream API keys. Import and its audit share a transaction; importing does not transfer submission ownership or settlement history. Legacy and shadow modes retain the existing compatibility path and are not a claim of atomic IAM enforcement.

## Related pages

- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
- [Upstream status]({{DOCS_BASE_URL}}/en/upstream-status)
- [Server configuration]({{DOCS_BASE_URL}}/en/server-configuration)
