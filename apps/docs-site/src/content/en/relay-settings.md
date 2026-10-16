# Relay settings

This page manages two kinds of relay configuration:

- relay-wide behavior such as queues, monitor mappings, global multipliers, and model pricing
- channel-level behavior such as upstream endpoints, pooled routing, visibility allowlists, model restrictions, and time-based multipliers

If you need to answer questions like “who can see this channel?”, “which upstream handles this model?”, or “how do multiple upstreams fail over?”, this is the page that defines that behavior.

## Page purpose

- Adjust relay-wide defaults and traffic handling behavior.
- Maintain monitor display names used in status views.
- Configure model pricing and supported formats.
- Create standalone channels, pooled channels, or automatic proxy pools.
- Set visibility, routing, upstream credentials, and pricing multipliers per channel.

## IAM global channel topology audit

Before enabling strict two-tier topology, the audit requires `quyan:relay:AuditChannelTopology` on both `acs:platform:*:platform:relay-configuration/default` and `acs:platform:*:platform:relay-channel/<channelId>` for every non-deleted channel. The caller also needs `RELAY_CHANNEL_READ` eligibility from a deployment-managed global group, and existing channel visibility rules continue to apply. If any participating channel or configuration is inaccessible, the entire request returns 403; a partially visible graph never produces a global `canEnableStrict` conclusion.

The audit includes disabled, non-deleted channels and checks legacy pool membership, missing or invalid pooled parents, a non-member incorrectly assigned to a pooled parent, and automatic pools referencing physical channels. Readiness is reported only for a complete, valid graph. Authority, configuration, or topology changes during the read cause rejection. The operation reads only topology fields, not upstream credentials or model prices, and does not create default configuration. Switching modes still requires separate global-configuration write permission.

## IAM channel change request lists

In IAM enforce mode, “My change requests” uses `quyan:relay:ListMyChannelChangeRequests` on `acs:relay:*:<accountId>:channel-change-request/<submitterId>/<requestId>`. Only the current submitter's requests are included. Wildcard grants do not expose another user's personal requests, whether in the same account or a different account.

The review list uses `quyan:relay:ListChannelChangeRequests` on `acs:platform:*:platform:relay-channel-change-request/<channelId>/<requestId>`. Reviewers still require `RELAY_CHANNEL_REVIEW` eligibility from a deployment-managed global group; an account-owned group or policy cannot create that eligibility. Qualified reviewers may review different submitters' requests, but each request must be individually allowed.

Both lists authorize each request before computing pagination and totals, excluding deleted requests or channels. Configuration includes only documented public fields and credential-presence flags, never plaintext or encrypted credentials. Role sessions use only role policies. Refresh and retry if identity, eligibility, policy, or session authority changes during the read.

## IAM channel management list

With IAM enforcement enabled, the management table uses `quyan:relay:ListManagementChannels` against each `acs:platform:*:platform:relay-channel/<channelId>`. Records, pagination and totals include only allowed channels within the existing visibility and filter rules. Denied parent names and member references are hidden. Model filters use only admitted paths through the channel pool, preserving strict child settings over duplicate legacy membership; a denied leaf cannot contribute models. This Action grants list access, while channel changes and delivery require their own Actions. Deployment management qualification is still required. Refresh and retry if authority changes while loading.

## IAM channel health access

In IAM enforce mode, the standalone overview uses `quyan:relay:ListChannelHealth`, detail uses `quyan:relay:GetChannelHealth`, and the automatic-pool list uses `quyan:relay:ListAutomaticPoolHealth`. All target `acs:platform:*:platform:relay-channel/<channelId>`. Detail and automatic-pool reads additionally require `quyan:relay:ReadChannelPoolHealthMetadata` on each returned channel and participating member. Health access does not grant channel configuration or upstream credential access.

The overview requires deployment-managed `RELAY_CHANNEL_HEALTH_READ` eligibility. Detail and automatic-pool reads also require `RELAY_CHANNEL_POOL_METADATA_READ` eligibility. Account-owned groups, user-added permissions and wildcard policies cannot create those platform qualifications. Existing visibility rules still apply; a policy grant cannot make a hidden member visible.

Lists and automatic-pool members contain only individually allowed, visible resources. Member health, names, scores and displayed ranks are based on this authorized subset, not proof of the pool's complete global topology. Disabled and provider-paused non-deleted channels remain visible for diagnosis, with their existing disabled/eligibility indicators. Manual health overrides and ranking thresholds retain their configured behavior. Missing and denied detail both return 403; authority or relevant configuration changes during loading reject the result. These unscoped endpoints do not accept OAuth tokens. Legacy/shadow retain the existing business read, without a second health/configuration read during shadow observation.

## IAM channel configuration access

In IAM enforce mode, `GET /v1/relay-channels` uses `quyan:relay:ListChannels`; `GET /v1/relay-channels/{id}` uses the separate `quyan:relay:GetChannel` Action. Both target `acs:platform:*:platform:relay-channel/<channelId>` and require READ or REVIEW eligibility from a deployment-managed global group. An account policy alone cannot grant that eligibility. Listing a channel does not grant detail access, mutation, export, or credential access.

Only individually allowed, business-visible channels appear. Denied parents and members are omitted, and denied or invisible leaves cannot contribute model capabilities to a pool. Disabled or provider-paused channels are excluded from the default list; `includeDisabled=true` includes their configuration. A detail read may show disabled metadata without advertising active capabilities. Credential fields are presence booleans only, never secret values.

OAuth retains the channel-read scope for the list; the unscoped detail endpoint does not accept OAuth tokens. AccessKeys and role sessions use their existing authority, rechecked before return. A missing or denied detail returns the same 403. Refresh and retry if identity, policy, visibility, membership, or session authority changes during loading. Legacy/shadow retain the original business read; shadow does not fetch a second configuration payload.

## Batch channel enable/disable

In IAM enforce mode, batch enable/disable uses `quyan:relay:SetChannelStatus` on every selected `acs:platform:*:platform:relay-channel/<channelId>`. It requires `RELAY_CHANNEL_UPDATE` eligibility from an active deployment-managed global group; an account-owned group, extra user permission, or wildcard policy cannot create that eligibility. A role session uses only its role grants, within the same management ceiling.

Submit 1–200 distinct, existing, undeleted channel IDs and a JSON boolean `enabled` (`true` or `false`, not the string `"false"`). Every selected resource must be allowed. A denied or missing channel, or a change to resource, identity, policy, AccessKey, OAuth, or role-session authority before commit, prevents the whole batch from taking effect. OAuth clients and access tokens must retain the channel-update scope. The endpoint returns only counts: it does not read credentials, require channel-read permission, detach tokens, change pool membership, or change provider-service eligibility. Replay protection and step-up verification remain required. Legacy/shadow keep their original authorization behavior; shadow does not issue a second status write.

## Global settings

### Global multiplier

- Purpose: applies a top-level multiplier before channel-specific pricing.
- Effect: final billing commonly reflects `global multiplier × channel multiplier × time-based multiplier`.
- Guidance:
  - Use model pricing or channel multipliers for targeted adjustments.
  - Change the global multiplier only when you need a broad pricing shift across the whole relay system.

### Queue enabled, max concurrency, queue timeout

- Purpose: control whether overload is queued or fails quickly.
- Effect:
  - lower `max concurrency` protects upstreams but pushes more traffic into queueing
  - shorter `queue timeout` returns failures faster; longer timeout makes users wait longer
- Guidance:
  - use conservative values when upstream quotas are tight or rate limits are common
  - review error rate and status dashboards after changing production values

### Upstream stream timeout

- Purpose: caps how long one streaming request may occupy an upstream connection.
- Effect: values that are too low can cut off long answers; values that are too high keep slow requests alive longer.

### Monitor name mapping

- Purpose: replace raw monitor IDs with clearer admin-facing labels.
- Effect: changes presentation only, not actual routing logic.

The settings page loads relay configuration and custom-key configuration independently. Fields from a group that could not be loaded are disabled and are not submitted. Saving sends changed relay fields only, so changing queue settings does not replace unchanged prices. Zero-cost prices are valid. Changing pricing still replaces the complete active list, including records not visible under your read permissions. If one configuration group saves and the other fails, the page reports partial success and retry submits only the unsaved changes.

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

## Channel configuration overview

Each channel is a logical route that tokens or system workflows can use. Channels come in three forms:

- `Standalone channel`: connects directly to a real upstream and stores its URL and key.
- `Pooled channel`: combines multiple existing channels into one logical channel that users see as a single option.
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
- In strict two-tier topology, click Add Physical Member to select physical members directly and save them in one operation.
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

- Behavior: prefers members with better health scores.
- Best for: environments with reliable health telemetry where availability matters more than strict ordering.

#### Latency priority

- Behavior: prefers members that have been responding faster.
- Best for: latency-sensitive interactive traffic.

## Routing parameters

The form starts with recommended values that fit most pooled-channel setups. Administrators can still override them when needed.

### Max channel switches

- Recommended default: `2`
- Purpose: limits how many different member channels may be tried after the first one.
- Effect: values that are too low can prevent later channels from ever being reached; values that are too high can increase end-to-end latency.
- Guidance:
  - `2` is a practical default for pools with up to three main primary/backup paths
  - increase it when your pool has more ordered members that should actually be reachable

### Retries per channel

- Recommended default: `0`
- Purpose: controls whether the same member should be retried before switching away.
- Effect:
  - `0` means switch quickly after a failed attempt
  - higher values mean more trust in short-lived issues on the same upstream
- Guidance: keep `0` for most API relay traffic so time is not wasted on a channel that is already failing.

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

- Recommended default: `0`
- Purpose: only lets members above a health threshold participate in health-based routing.
- Effect: higher thresholds exclude unstable members more aggressively.
- Guidance: `0` means do not filter by health score yet, which is a conservative default. Raise it only when you understand how the score is produced.

### Latency threshold (ms)

- Recommended default: `30000`
- Purpose: caps which members are considered acceptable for latency-priority selection.
- Effect: values that are too low can exclude most channels; values that are too high remove most of the benefit.
- Guidance: `30000ms` is a loose starting point that avoids excluding normal channels too early. Tighten it after you observe real upstream latency.

### Circuit breaker threshold

- Recommended default: `5`
- Purpose: after enough failures, treat a member as temporarily unsuitable.
- Effect: reduces repeated traffic to a clearly unhealthy upstream.
- Guidance: `5` is a practical starting point for common API upstreams. It avoids overreacting to one-off failures while still cutting away sustained problems.

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
- Effect: prevents double charging when enabled; uses raw upstream counts when disabled.
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

## Channel supply and revenue sharing

Administrators can review channel status, add multiple providers in the channel editor, and configure each provider's 0% to 100% share and settlement mode. The total may exceed 100%; the editor shows the resulting platform subsidy. Earnings use the actual execution channel and an immutable percentage snapshot from the time of consumption. Users submit standalone channels and inspect earnings from the Channel supply and earnings page.

1. For external production traffic, start with pooled channels plus priority failover and a small number of clear primary/backup members.
2. Default testing channels to `private` or `whitelist` visibility so users do not consume them accidentally.
3. When upstream compatibility differs, reduce risk with format restrictions and model allowlists.
4. Before publishing pricing changes, check global multiplier, channel multiplier, and time-based multipliers together to avoid unintended stacking.
5. After changing pooled routing, review switch logs and status views to confirm failover behaves as intended.

## Related pages

- `relay-token-management`
- `upstream-status`
- `server-configuration`

## Server resource protection and audit bodies

Server Configuration includes an advanced AI Resource Protection panel for live admission, queues, RSS, uploads, responses, audit and connection-pool budgets. Saving applies locally at once; other processes refresh within five seconds. Running requests retain their starting content budgets. Per-user and image-scope concurrency protections still apply.

Legacy resource environment values are used only before management settings are saved. Audit bodies remain sanitized and available; backlog may omit bodies or drop records with warnings. Audit logs do not replace billing records.
