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

### Resource-scoped access and credential disclosure

When IAM enforcement is enabled, the list uses `quyan:relay:ListTokens` and a single-token read uses `quyan:relay:GetToken`. The server evaluates each token resource, `acs:relay:*:<accountId>:token/<userId>/<tokenId>`. Unauthorized rows are excluded from both the page and its total; knowing a token ID does not grant access. Disabled tokens remain visible if authorized, while deleted tokens do not.

Reading token metadata does not automatically disclose its credential. These two read APIs only include `token` when `quyan:relay:RevealToken` also allows the same resource; an explicit Deny overrides an Allow. Without disclosure permission, the page can still show authorized usage and configuration, but shows a credential-unavailable notice. Copying the credential, opening a balance script, and importing it into a supported client require an actual returned credential. Bulk credential copy stops if any selected row lacks one; it never substitutes a token ID or silently copies a partial selection.

Reading another user's tokens, including another user in the same account, additionally requires the platform management qualification and `ListManagedTokens` / `GetManagedToken` on the target user and token resources. Disclosure then uses `RevealManagedToken`. An account policy containing `"*"` cannot create that platform qualification. OAuth access also remains limited by the current application's and access token's scopes, validity, and revocation state.

Export requires `quyan:relay:ExportTokens` and `RevealToken` on every selected token. Managed exports additionally require platform management qualification, personal endpoint admission, and `ExportManagedTokens` / `RevealManagedToken` on the target platform resources. Selected IDs preserve their request order. Without a selection, export includes enabled tokens; `includeDisabled: true` also includes disabled tokens, never deleted ones. If any requested token is missing or unauthorized, or a referenced composite member cannot be exported, the entire export fails; it does not silently produce a partial backup. Exported composite configuration preserves authorized member references but does not disclose member credentials unless those members are themselves selected and authorized for disclosure.

These disclosure rules cover creation, list, single-token read, export, and the single-token status, refresh, primary-channel, and complete-update operations described below. Duplication and other modifications remain separate operations with their own authorization requirements; do not treat metadata-only access as a guarantee that other granted operations cannot return credentials. In legacy or shadow mode, the existing permission checks remain authoritative; shadow comparison does not enable IAM enforcement.

### Creating a resource-scoped token

With IAM enforcement enabled, creating a token requires `quyan:relay:CreateToken` on both your user creation scope (`acs:quyan:*:<accountId>:user/<userId>`) and the new token resource (`acs:relay:*:<accountId>:token/<userId>/<tokenId>`). The server assigns the token ID; a client cannot choose it. A policy can grant future tokens using the `token/<userId>/*` pattern without granting creation for other users. Creation also requires `GetToken` for its response. The returned credential is present only when `RevealToken` allows that new resource; otherwise creation succeeds with metadata and no credential to copy.

Every ordered channel, including fallbacks, requires `SelectTokenChannel` on its `acs:relay:*:<accountId>:channel-selection/<channelId>` resource and must remain enabled and visible to you. Automatic mode requires the same permission on the selected automatic-pool root, a valid effective topology, and at least one usable path after blocks. Composite creation requires `ReferenceToken` and `GetToken` throughout its complete referenced subtree, including disabled member bindings; it cannot reference another user's tokens.

A caller-provided credential additionally requires `SetTokenCredential` and `RevealToken` on the new token; ordinary creation does not grant either capability. The current server-side custom-credential switch, per-user limit, and rate limit apply unless the independently granted `BypassTokenCredentialLimits` permits bypass. Creating for another user requires persisted platform management qualification, `CreateManagedToken` and `GetManagedToken` on that target's user and token resources, plus the personal endpoint permissions. Managed credentials, references and limit bypass use their corresponding `Managed` actions; a managed target alone never makes custom credentials unlimited. OAuth creation and response scopes must both still be valid in the application and access token.

Creation, related configuration, response permissions and final authority checks share one rollback boundary: a late denial leaves no newly created token. Legacy and shadow modes retain the legacy creation result; shadow preview neither inserts another token nor consumes another custom-credential attempt.

### Importing resource-scoped tokens

With IAM enforcement enabled, `POST /v1/relay/tokens/import` accepts 1–200 items. Both your user creation scope and every new token require `quyan:relay:ImportTokens` and `CreateToken`; each new resource also requires `GetToken`. Creation permission alone does not grant import. The server assigns every ID. Item-level IDs, action names and target users cannot override authorization; the top-level `targetUserId` sets the batch target. Only items allowed `RevealToken` return credentials; other items return metadata.

Import preserves stream and content-safety settings and all channel, composite-reference and custom-credential requirements described for creation. Custom-credential count limits include planned additions from this batch, rather than evaluating each item as if other additions did not exist. Ordinary and independently limit-exempt credentials may be mixed, but each item must qualify separately. Importing for another user additionally requires platform qualification and `ImportManagedTokens`, `CreateManagedToken` and `GetManagedToken` on that target user and every new token; sensitive operations use the corresponding managed capabilities.

Existing tokens are never overwritten. Names are trimmed. Collisions with that owner's enabled or disabled tokens or preceding items receive the “（副本）”, “（副本2）”, and subsequent suffixes; differently cased names remain distinct. `enabled: false` creates a disabled token; omission enables it. Legacy-format credentials are canonicalized. If a credential or legacy alias is occupied, including by an earlier batch item, the server generates a different credential without adopting the occupied alias. Use the successful response rather than assuming an imported credential was retained.

In enforce mode, all items' configuration, quotas, references and response permissions share one rollback boundary. Any validation failure, denial or mid-operation revocation leaves no newly created token from the batch. Failed custom-credential setting attempts may still count toward rate limits. Legacy and shadow modes still execute the original import once; shadow preview neither inserts extra items nor consumes additional setting attempts.

### Updating a complete token configuration

In IAM enforce mode, editing a token requires `quyan:relay:UpdateToken` and independent `GetToken` permission on that token. The response includes its credential only when `RevealToken` is also allowed. Name, expiry, overall quota, quota windows, model rules, protocol conversion, normalization, content safety and streaming settings are updated together: a failed resource, identity, or authorization check rolls back the complete change.

- The complete resulting ordered channel list, including unchanged fallbacks, requires `quyan:relay:SelectTokenChannel` on each `acs:relay:*:<accountId>:channel-selection/<channelId>`. Automatic mode checks this permission and business visibility on the selected pool. Blocking supports reachable direct and nested members, respects the effective pool relationships, and must leave at least one usable route. Denied, hidden, disabled or provider-disabled selections do not become available through a token update.
- Converting an ordinary token into a composition requires `quyan:relay:ReferenceToken` and `GetToken` on every referenced descendant, including disabled references, within the same owner. Reading or previewing a candidate alone does not authorize saving that reference. Graph depth, size and cycle constraints still apply. This edit endpoint does not modify an already-composite token.
- Replacing the credential additionally requires `SetTokenCredential` **and** `RevealToken`; a known replacement value cannot bypass an explicit disclosure denial. Unless independently allowed `BypassTokenCredentialLimits`, custom-key availability, per-user count and attempt limits still apply. OAuth must delegate the corresponding ordinary or free custom-key scope in both the live token and application. A management target is not an implicit limit bypass. A failed attempt may count against the attempt limit even when the database change is rolled back.
- A legacy-format credential is converted to the canonical prefix while preserving its secret suffix. If the preferred credential or its alias is already in use, the server generates a different credential and does not adopt the occupied alias; use the credential returned by the successful response.

Managing another user's token also requires platform write and read qualification, personal endpoint admission, and `UpdateManagedToken` / `GetManagedToken` on the target platform user and token. Credential replacement and composition use the corresponding `SetManagedTokenCredential`, `RevealManagedToken` and `ReferenceManagedToken` capabilities; limit bypass uses `BypassManagedTokenCredentialLimits`. Managed credential setters also need the deployment-managed group’s custom-key eligibility; managed limit bypass additionally needs its free custom-key eligibility. Account policies cannot create either qualification. Token settings, quota rules and reference changes commit together with the authorized response. Replay protection and step-up verification remain required. These resource-level guarantees apply to enforce mode; legacy and shadow still execute the original business mutation once, and shadow comparison does not additionally consume custom-key attempts.

### Resource boundaries for composition candidates

In IAM enforce mode, the composition candidate list checks `quyan:relay:ListTokenCompositionCandidates` on each token ARN without additionally requiring `GetToken` or `RevealToken`. A candidate's entire referenced subtree must be authorized, including disabled member references. If any descendant is denied, deleted, outside the selected user, cyclic, or beyond graph limits, its parent candidate is omitted from both results and totals. The service does not disclose reduced member counts or incomplete references that could reveal hidden tokens.

Name searches, pagination, and pinned selections operate only within completely visible candidates. Any unauthorized or incomplete candidate explicitly named in `selectedIds` causes the entire query to fail; an unauthorized editing target also fails. Nonempty `selectedIds` must contain at most 200 distinct comma-separated IDs without empty segments. Self and fully authorized ancestors that would introduce a cycle are marked unselectable. Disabled or expired but undeleted tokens remain inspectable for configuration purposes, without regaining invocation eligibility.

Inspecting another user's candidates still requires platform management-read qualification, personal endpoint admission, and `ListManagedTokenCompositionCandidates` on the target platform user and each token. Same-account peers do not bypass this boundary. The reference graph, tokens, identity, and authorization are rechecked before release. The query reads no token credentials, upstream configuration, or physical channels. These rules cover candidate selection only, not the independent authorization of composition previews, writes, or invocation. Legacy / shadow retain the original behavior, and shadow does not additionally load candidate topology.

### Model catalog discovery permission

In IAM enforce mode, model-name discovery uses `quyan:relay:ListAvailableModels` on each `acs:relay:*:<accountId>:model-catalog-entry/<modelRecordId>`. The optional response map `modelResourceArns` provides exact ARNs keyed by visible model name. Denied entries are absent from names, model IDs, alias maps, and resource maps. Unique and one-to-many mappings for a shared upstream ID are computed only from authorized entries. No authorized entries means an empty catalog.

This permission controls the current account's discovery of public model entries, not platform pricing administration. It requires no global pricing-management qualification and exposes no costs, pricing rules, or channel configuration. It does not change token model allow-lists, grant model invocation, or replace a single token's available-model query. OAuth retains this endpoint's original `relay:channel:read` scope rather than substituting token READ. Identity, policies, publication state, and aliases are rechecked before release; changes cause stale results to be rejected. Legacy / shadow retain the original catalog behavior, and shadow does not additionally read model names.

### Single-token status changes and credential refresh

With IAM enforcement enabled, single-token status toggles use `quyan:relay:SetTokenStatus` and credential refresh uses `quyan:relay:RefreshToken`, both on the target token ARN. Because both endpoints return token configuration, they also require `GetToken` metadata access on the same resource. Missing read access rejects the request before any write; the server does not modify a token and then return a read error. Use batch status changes when only write access is needed without reading configuration.

A toggle response includes credentials only with an additional `RevealToken` grant; otherwise it returns metadata only. Refresh requires `RevealToken` before rotation, so a caller cannot generate a credential they are not allowed to retrieve. After a successful refresh, the previous credential and its legacy-format alias are invalid. The token ID, configuration, status, expiry, usage and composite references remain unchanged. Refreshing a disabled or expired token does not make it usable again.

Managing another user additionally requires platform-management read and write eligibility, the current user's endpoint admission, and `SetManagedTokenStatus` / `RefreshManagedToken` plus `GetManagedToken` on the target platform user and token. Disclosure uses `RevealManagedToken`. Management-write eligibility does not automatically grant read or disclosure access. The OAuth application and access token must also retain both read and update scopes.

The write, response configuration read and final authorization checks share one transaction boundary. Identity, policy, resource or disclosure changes, or a response-construction failure, roll back the operation instead of committing a rotation after response construction or authorization failed. This does not guarantee network delivery: if the connection fails after commit, an authorized caller can refresh again. Both endpoints retain replay protection and step-up verification. Legacy and shadow continue to execute their existing business logic and do not provide these enforce-mode guarantees.

### Changing the primary ordered channel

In IAM enforce mode, the primary-channel endpoint requires `quyan:relay:UpdateTokenChannel` and `quyan:relay:GetToken` on the target token. It also requires `quyan:relay:SelectTokenChannel` for **every channel in the resulting ordered list**, including retained fallback channels. Channel selection uses `acs:relay:*:<actorAccountId>:channel-selection/<channelId>`; this is not platform channel-management authority and does not permit reading upstream credentials.

Channels must remain active, provider-enabled, and selectable under their business visibility rules. Hidden channels cannot be selected. A policy Allow does not override business visibility. Selecting an existing channel moves it to the front; selecting a new one preserves the previous channels as fallbacks, up to the ordered-list limit. This endpoint cannot convert a composite or automatic-pool token to ordered routing.

The returned configuration requires metadata read access; the token string is included only with separate Reveal permission. Updating another user's token additionally requires the corresponding `UpdateManagedTokenChannel` and `GetManagedToken` grants and platform-management eligibility. Channel selection still uses the acting account's selection ARNs. The write, response read, and final authority checks share a transaction: a denial or response-construction failure rolls back both the primary channel and fallback-list changes. Existing OAuth scopes, replay protection, and step-up verification remain required. Legacy and shadow modes keep their existing authorization behavior.

### Single-token usage and details

With IAM enforcement enabled, single-token usage statistics and usage details use the independent `quyan:relay:GetTokenUsage` action on the same token ARN. They do not additionally require `GetToken` or `RevealToken`, and neither endpoint returns token credentials or upstream secrets. Disabled or expired tokens remain inspectable when authorized, as long as they have not been deleted.

Inspecting another user's usage, including a same-account peer's, also requires platform-management read eligibility, the current user's endpoint admission, and `GetManagedTokenUsage` on the target platform user and token. Management-write eligibility alone does not grant usage access. Identity, authorization and the target resource are checked again after aggregation; revoking access during the query prevents the computed result from being returned.

Usage attributed to a composite call remains visible under the selected token without granting access to other member tokens; detail rows identify the authorized queried token. These rules cover single-token usage and details; batch usage and switch logs are described below and platform diagnostics and route traces have the separate requirements below.

### Batch usage summaries and switch logs

With IAM enforcement enabled, batch summaries also check `quyan:relay:GetTokenUsage` on each token. Managing another user uses `GetManagedTokenUsage` and additionally requires platform-management read eligibility and target-user authorization. Omitting `tokenIds` summarizes only authorized tokens and omits denied records. An explicit selection accepts at most 200 distinct, nonempty IDs and preserves request order. Any missing, deleted, wrong-owner or denied target fails the whole request rather than silently producing a partial summary. Authorized disabled or expired tokens remain queryable if they have not been deleted.

Without a date range, summaries retain lifetime-usage semantics. With a range, only authorized resources enter the dated aggregation. Identity, targets and every contributing authorization decision are checked again afterward; revoking access prevents release of the computed data. Explicit empty selections, duplicates and empty comma-separated entries are rejected rather than accidentally becoming an all-token query.

Switch logs use the independent `quyan:relay:GetTokenSwitchLogs` action, or `GetManagedTokenSwitchLogs` for other users, without additionally requiring `GetToken` or `RevealToken`. Native responses contain necessary display-channel identifiers, status codes and attempt information, but do not read or return physical channel IDs, secrets or unreviewed raw upstream error text. Each query accepts at most 100 rows, and authorization is rechecked after the data query. These resource-level, filtering and log-disclosure rules apply to enforce mode; legacy and shadow continue their existing queries.

### Single and batch deletion

With IAM enforcement enabled, single and batch deletion check `quyan:relay:DeleteToken` on every target resource. Deletion does not additionally require read or credential-disclosure permission, and its response does not return credentials. Deleting another user's tokens, including a same-account peer's, also requires platform-management eligibility, the current user's delete endpoint admission, and `quyan:relay:DeleteManagedToken` on the target platform user and every token. Management-read eligibility alone is insufficient.

A batch accepts at most 200 distinct token IDs. If any target is missing, already deleted, outside the selected user, denied, or affected by an identity, authorization or resource change during execution, the entire request fails without partially deleting tokens. Disabled or expired tokens may still be deleted when authorized. Single deletion follows the same checks.

Deletion makes a token unavailable without removing existing composite-member references or historical usage. A composite branch referencing it becomes unavailable; edit the composition separately to remove that reference. The endpoints retain replay protection and step-up verification. Legacy and shadow modes continue to execute the existing deletion behavior; the resource-level and all-or-nothing guarantees above apply to enforce mode.

### Batch status and content-safety configuration

With IAM enforcement enabled, batch status changes check `quyan:relay:SetTokenStatus` on each token, and batch content-safety changes check `quyan:relay:SetTokenContentSafety`. Neither operation additionally requires read or disclosure permission, and neither returns token credentials. Managing other users still requires platform-management write eligibility, the current user's endpoint admission, and the corresponding `SetManagedTokenStatus` / `SetManagedTokenContentSafety` on the target platform user and every token. Management-read eligibility cannot replace write eligibility.

Each batch accepts at most 200 distinct IDs, all belonging to the selected user and not deleted. A missing or denied resource, or a relevant authorization or resource change during execution, prevents the entire batch from taking effect. Status changes only enable or disable tokens: they do not rotate credentials, reset quotas or restore deleted tokens. The API's `enabled` must be a JSON boolean, `true` or `false`, not the string `"false"`.

Content-safety **Snapshot** saves the target user's effective settings at that time as the selected tokens' override; managing another user does not copy the operator's settings. **Clear** removes token overrides so subsequent requests inherit user and system settings again. Neither operation changes user or system policies, and runtime system safety constraints still apply. The endpoints retain replay protection and step-up verification. These resource-level and all-or-nothing guarantees apply to enforce mode; legacy and shadow continue to execute the existing business behavior.

### Platform request diagnostics and route traces

In IAM enforce mode, request diagnostics are a platform operations capability, not personal token usage inspection. The operator must retain diagnostic qualification in a deployment-managed global group; wildcard policies in an ordinary account or account-owned group cannot establish that qualification. OAuth retains the original `relay:usage:read` admission scope, with current application and access-token scope, status, expiry, and revocation checks.

The diagnostic list checks `quyan:relay:ListRequestDiagnostics` for each `acs:platform:*:platform:relay-request/<logicalRequestId>`. The optional response field `resourceArn` provides the exact identity; do not substitute the external request label or token ID for the logical request ID. Unauthorized records are excluded before detail loading, pagination, and totals. Date, outcome, request-label, and keyword filters remain available. Historical diagnostics can include disabled or deleted tokens; visibility does not grant permission to restore or use them.

Route traces additionally require:

- Global-group qualification for route tracing and pool metadata reads, in addition to diagnostics; all three qualifications are mandatory.
- Both `ListRequestDiagnostics` and `quyan:relay:GetRequestRouteTrace` on the same logical request resource.
- `quyan:relay:ReadChannelPoolMetadata` on every actual execution channel, identified by `acs:platform:*:platform:relay-channel/<channelId>`, before its physical ID and name are disclosed.

Diagnostic lists contain no physical execution channels, client IP addresses, upstream configuration, or credentials. Traces add only authorized execution-channel IDs and names, not keys or upstream connection configuration. When an authoritative root exists for a request label, selecting a child cannot bypass a denial on that root. Ambiguous records, any unauthorized channel, or an authorization, identity, or source-data change before release cause the entire request to fail without a partial trace. These resource-level guarantees apply to enforce; legacy / shadow retain the existing operations checks, and shadow does not additionally read trace details.

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

### Resource-scoped model discovery

In IAM enforcement mode, **Load available models** requires `quyan:relay:GetTokenAvailableModels` on `acs:relay:*:<accountId>:token/<userId>/<tokenId>`. A composite token additionally requires that Action on every referenced descendant, including disabled references. A denied, deleted or foreign-owner reference rejects discovery rather than returning a partial catalog. Inactive or expired paths contribute no models.

This grant is separate from reading Token metadata, revealing its credential, browsing the public model directory, or invoking a model. Aliases, protocol conversions, model restrictions, blocked pool members and ancestor multiplier limits remain tied to the same actual path. Responses never expose physical channel IDs, upstream configuration or prices. Discovery describes configured capabilities, not current health, quota or request-time availability.

Viewing another user's models also requires the managed Action `quyan:relay:GetManagedTokenAvailableModels` on that user's platform user and Token resources, personal discovery admission, and existing global-group management eligibility. A same-account peer is still another user. OAuth clients retain the endpoint's channel-read scope; a Token-read scope alone is insufficient. If identity, policies, credentials or capability sources change during discovery, refresh and retry after reviewing the current grants.

### Resource-scoped composition preview

In IAM enforcement mode, **Preview models and routes** uses `quyan:relay:PreviewTokenComposition`, not the separate model-discovery Action. It requires admission on the acting user's `acs:quyan:*:<accountId>:user/<userId>` resource and authorization on every selected Token and all referenced descendants, including disabled references. Editing also requires this Action on the edited Token. References removed by the draft are not included in the preview's access requirements. The draft must remain within one owner and pass the same depth, member-count and cycle checks.

The returned real Token path IDs are all authorized. An unsaved root uses a fixed display placeholder, cannot replace an existing Token, and creates no stored resource. Model restrictions, protocol conversions and ancestor multiplier limits are computed on the proposed path. Preview does not grant creation, updates, invocation or credential disclosure. Other-user preview additionally requires `quyan:relay:PreviewManagedTokenComposition` on the selected platform user and Token resources plus global-group read-management eligibility. The original Token-read OAuth scope remains required. Revoked authorization or changed capability sources reject the result rather than returning partial paths.

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
