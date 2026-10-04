# Relay token management

Use this page to manage relay tokens, channel routing, quotas, and failover behavior.

## Page purpose

- Create and maintain relay tokens.
- Review token usage, expiry, and quota windows.
- Control channel ordering and failover strategy.
- Enable or disable tokens without deleting them immediately.
- Bulk import and export token and channel configurations.

## What you will see

### Token list

- Token name and searchable token details.
- Request count and total token usage.
- Expiry, status, and quota usage.
- Paged or show-all display modes.

### Quota windows

Each token can have one or more rolling time-window rate limits (e.g. per-minute, per-hour, per-day):

- Master toggle to enable or disable quota windows for a token.
- Each window shows used / limit and the next reset time.
- Requests are rejected once the limit is reached until the window resets.

### IP whitelist

- Bind a token to a set of allowed IPs or CIDR ranges.
- Leaving it empty allows any source IP; adding entries restricts access to those addresses only.

### Request format conversion

Each token can have up to three conversion rules, with one rule per source format. Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses can be converted between each other; an empty rule list disables conversion.

- Callers still receive their source format's normal response, errors, and stream events; channel selection, upstream paths, authentication, and billing use the target format.
- The target channel and model must enable the target format. Conversion has a modest CPU and memory cost, and semantics and billing can differ between protocols.
- Provider-specific fields that cannot be represented safely are rejected instead of silently removed, including async/session requests, hosted tools, file or audio/video inputs, and cache controls.
- Chat Completions or Responses requests converted to Anthropic must provide a mappable maximum output token limit; no default is injected.

### Anthropic request normalizer

Each token can independently enable Anthropic request normalization. It applies only to Anthropic Messages requests sent with that token and does not change other tokens, channel settings, or the model catalog.

- When its master switch is off, requests are neither rewritten nor retried.
- Thinking signature, Thinking Budget, and unsupported-image handling can be enabled independently. Signature handling removes incompatible thinking blocks or signatures. Budget handling enables thinking, uses a budget of 32000, and raises the maximum output token value when required.
- Image fallback replaces image blocks with `[Unsupported Image]` and retries with the same token only when the upstream explicitly rejects images. For preflight handling, maintain explicit text-only upstream model IDs on the token. The relay does not guess image support from model names, so unconfigured new models are forwarded unchanged by default.
- Each request has at most one normalization retry, always with the original token and current channel. A stream is never retried after output has begun, and a failed normalization retry does not enter normal failover.

### Upstream `/v1` path mode

Each token can control the `/v1` prefix forwarded upstream. This setting is independent of the Anthropic request-normalizer master switch and defaults to **Auto**.

- `Off`: preserves the caller's path without adding or removing `/v1`.
- `Auto`: sends exactly one `/v1` prefix upstream. For example, `/responses` becomes `/v1/responses`, while `/v1/v1/responses` is normalized to `/v1/responses`.
- `Always add`: prepends another `/v1` regardless of the existing path. Use it only for special upstreams that require a repeated version prefix.

### Channel and failover data

- Ordered channel list.
- Failover summary (automatic fallback when the primary channel is unavailable).
- Quota-window detail panel.
- When failover is enabled and the max channel switches value is below the recommendation, saving asks whether to adopt the recommended value. You can also keep the current value and continue saving; closing the dialog cancels the save.

### Routing mode

Each token uses exactly one routing mode:

- `Ordered channels`: maintains a channel order and its failover configuration.
- `Automatic proxy pool`: selects one shared automatic proxy pool and does not retain an ordered channel list. Administrators or automation maintain the pool members centrally. A token may exclude individual pool members without changing the pool's global membership.

The resolved member determines the upstream, model capabilities, and billing multiplier. Token users can view members to exclude them for their own token, but cannot edit the pool's global membership.

### Management actions

- Create token.
- Edit token (including quota windows and IP whitelist).
- Clone token (duplicates all settings into a new token).
- Refresh token value (rotates the secret; the old value is immediately invalidated).
- Enable or disable token.
- Delete token.
- **Batch operations**: import / export token list (JSON format).
- **Channel batch operations**: import / export channel configurations, or select multiple channels and append them to the ordered list in selection order.

## Common actions

1. Create a token with a recognizable name.
2. Configure channel order and failover behavior. When an Anthropic upstream needs compatibility handling, enable request normalization for that token in the edit drawer.
3. Enable quota windows and set per-window limits if rate limiting is required.
4. Fill in the IP whitelist if you want to restrict which sources can use the token.
5. Review quota usage regularly to avoid unexpected throttling.
6. Disable a token first if you want to stop traffic without losing the record.
7. Use import / export when migrating or backing up token configurations in bulk.

## Call AI after creating a token

After creation, copy the **Relay Base URL** shown at the top of the token drawer and store the new token in the caller's server-side environment. Do not commit it to source control, expose it in browser code, or use it as an admin-site login credential.

Call `Relay Base URL + /v1/models` first to confirm which models are available. For OpenAI Chat Completions, use `Relay Base URL + /v1/chat/completions` and send:

```text
Authorization: Bearer <relay_token>
Content-Type: application/json
```

The request format must be enabled for the token's channels, or have a matching token conversion rule. See `api-documentation` for complete curl examples, the Responses format, and image requests; see `relay-settings` to change channels, models, or formats.

## Blocking automatic-pool members

When a token uses an automatic proxy pool, you can block members that should not receive traffic for now. The UI saves and displays member IDs; the setting works for both direct and nested members without changing token billing rules. The server rejects members outside the selected pool, disabled members, and configurations that leave no usable member.

## Notes

- Refreshing a token value immediately invalidates the old string; callers must update their configuration.
- **Quota windows vs. the overall cap**: a token has one overall lifetime `quotaLimit` that never resets (tracked against total usage since creation), separate from the rolling quota windows described above, which each reset on their own cycle (per-minute, per-hour, per-day). Both can be active on the same token at once — the overall cap stops the token permanently once reached, while a quota window only throttles until its next reset.
- Bulk import appends new entries and does not overwrite existing tokens.
- Show-all mode is useful for audits but can be heavier to scan.

## Composite tokens: ordered members from your own tokens

Choose **Composite Token** in the create or edit drawer, search your own Relay Tokens, then order and enable or disable members. Members can use ordered channels, automatic pools, or another composite token. The composition references member IDs instead of copying secrets or channel settings. Administrators managing another account cannot combine tokens across owners.

- Saving confirms the members and order. Switching modes clears the previous bindings while retaining the token value and historical usage; source tokens are not modified.
- A path supports **four composite levels**, excluding its ordinary leaf token. Each composition supports **20 direct members** and an entry supports **100 leaf paths**. Self-reference and cycles are rejected, including through disabled bindings.
- Use **Load available models** for a member's Chat Completions, Responses, Anthropic and Gemini catalogs and **Preview models and routes** for the aggregate catalog and ordered candidate paths. The global pricing table is not advertised as a channel catalog. Explicit aliases are advertised only after checking their corresponding paths.
- Requests select compatible paths depth-first in member order. Disabled, expired, deleted, IP-restricted or quota-exhausted branches are unavailable. Failure of the entry token's own restrictions terminates the request.
- Cross-member failover defaults to `408, 429, 500, 502, 503, 504`. Each level controls only switching between its direct members; ordinary tokens retain their internal channel policies. One client request can make at most **100 actual upstream attempts**, including internal retries. No replay or switching is allowed after committing the response.

### Advanced settings and safety

Request model mappings, protocol conversions and applicable normalization run outside-in before the ordinary leaf selects a physical channel. Response protocol conversion runs inside-out. Every level independently enforces its model allow-list, expiry, IP and quota rules, and descendants cannot disable ancestor safety requirements. Safety rejection cannot be bypassed with a fallback. Conversion supports only the existing converters' supported fields and explicitly rejects unsafe conversions. Streaming preflight uses the smallest buffer limit along the executed path.

Preview describes capabilities and configured order, not guaranteed availability: IP, quota, safety and upstream health are checked at request time. Member changes and disabling affect subsequent requests. Secret rotation does not require reconfiguring the composition because references use IDs. In-flight requests retain their routing snapshot.

### Usage and charges

The entry composition, executed intermediate compositions and leaf token each record attributed usage and enforce their own lifetime and rolling-window limits. **Balance, monthly passes and channel revenue settle only once per call.** Unattempted branches have no usage; failed attempts retain existing failure-accounting behavior.

Each level shows attribution of the same call, so **do not add composition and member usage together as total spending**. Financial totals come from consumption transactions. Historical ordinary-token records remain queryable without backfilling.

### Using the Quyan CLI local Router

A composite token works directly as a Router Profile: create it, then run `quyan router profile add --token-id <composite-token-id> --yes` and refresh the catalog. Changing server-side members or their order does not require restarting an Agent already connected to the local Router. Refresh local catalog caches with `quyan router models --refresh` after changing models.

Copying preserves valid same-owner references. Import accepts only existing, verifiable member IDs belonging to the target owner; it never guesses by name or creates missing members.

## Related pages

- `api-documentation`
- `relay-settings`
- `upstream-status`
