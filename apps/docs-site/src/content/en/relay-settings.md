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
- When editing a pooled channel, click Add Physical Member to select physical members directly and save them in one operation.
- Saving assigns the selected physical members to this logical pool and applies their priority, weight, and enabled state from the list order; members do not need to be edited one by one.

#### Automatic proxy pool

- Best for: centrally managed or automated member updates without requiring every token to be reconfigured.
- Members: logical pooled channels are added as members; standalone channels and other automatic proxy pools cannot be added directly.
- Billing: the resolved member supplies the model pricing and channel/time multipliers; the token owner pays the resulting charge.
- Visibility: token users select the automatic proxy pool, not its underlying members.

## Pool members and routing strategy

### Pool members

- Member channel: a concrete channel the pool may route to.
- Physical member: belongs to exactly one logical pooled channel. Prefer adding it from the logical pool editor instead of opening each physical member and setting its parent individually.
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

## Operating guidance

1. For external production traffic, start with pooled channels plus priority failover and a small number of clear primary/backup members.
2. Default testing channels to `private` or `whitelist` visibility so users do not consume them accidentally.
3. When upstream compatibility differs, reduce risk with format restrictions and model allowlists.
4. Before publishing pricing changes, check global multiplier, channel multiplier, and time-based multipliers together to avoid unintended stacking.
5. After changing pooled routing, review switch logs and status views to confirm failover behaves as intended.

## Related pages

- `relay-token-management`
- `upstream-status`
- `server-configuration`
