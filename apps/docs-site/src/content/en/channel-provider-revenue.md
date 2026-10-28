# Channel supply and earnings

This page is for users who provide standalone relay channels. Submit a channel, follow its review status, and inspect earnings created by actual consumption.

## Submit a channel

Only standalone channels can be submitted. Enter the upstream URL and API key for each enabled protocol format. Keys are sent to the server only for review and relay use; they are never shown in submission lists, earnings lists, or error messages.

Submitted channels remain pending until an administrator lists, rejects, or offboards them. After listing, an administrator can change the sale multiplier, add providers, and configure each provider's commission and settlement mode. Review status and effective service status are shown separately: an approved channel serves traffic only when it is enabled by an administrator and not paused by its provider.

The form also covers format and model restrictions, model mappings, cache-read accounting, time-period multipliers, and context-length multipliers. After a channel is listed, the original submitter cannot edit the live configuration directly. They can submit a complete configuration from My change requests; it stays pending, approved, or rejected with the operator's reason, and is applied atomically only after approval. A new submission can replace an existing pending request; the older request is marked superseded and only the newest request remains reviewable. While a configuration change is pending, the current live configuration and service status remain unchanged.

The original submitter can pause or resume an approved standalone channel without another review. Pausing takes the channel out of service immediately. An administrator disable always takes precedence, so a provider cannot resume a channel until an administrator enables it again. Pausing or resuming does not alter the review result or a pending configuration change.

A rejected channel can be revised and submitted again; it returns to pending review. Once approved, the updated configuration is applied and the channel is listed and enabled automatically. The original submitter may delete pending, rejected, or offboarded channels. Deletion cannot be undone, and deleted channels no longer appear in supply or review lists. Listed channels cannot be deleted directly by the provider.

The format and model section can probe the corresponding upstream `/v1/models` endpoint. Temporary probe credentials are not persisted or returned. Models that match global pricing can be added to the restriction with one click; unmatched IDs remain visible as pricing gaps.

Administrators with `RELAY_CHANNEL_REVIEW` use the separate Channel Supply Review page for initial submissions and change requests. Multiplier, provider shares, and settlement modes are saved through a separate configuration action.

## IAM access to my submissions

In IAM enforce mode, My submitted channels uses `quyan:relay:ListMyChannelSubmissions` on `acs:relay:*:<accountId>:channel-submission/<submitterUserId>/<channelId>`. The submitter segment and account come from the authenticated identity. This is personal submission access, not platform channel management; deployment-global management membership is not required. A JSON-only grant can allow selected own submissions without granting channel creation, review, deletion or health access.

The list always remains limited to the authenticated user's own non-deleted standalone submissions, including pending, rejected, disabled and provider-paused records. Even wildcard policies cannot list another submitter's channels. Authorization filtering happens before pagination and total calculation; totals describe only allowed submissions. Private visibility does not hide a submission from its original submitter. An assumed role uses its own policy grants, not the user's grants. These unscoped endpoints do not accept OAuth tokens.

The response preserves review information, effective models and upstream key-presence booleans, but never returns key values. A submitted standalone channel does not expose a pool parent or unrelated members. If identity, authorization or relevant resource data changes during loading, the result is rejected. Legacy/shadow retain the existing payload read once, without a second configuration read for shadow comparison.

### Creating a submission pending review

With IAM enforcement enabled, submission creation uses `quyan:relay:CreateMyChannelSubmission`. The server reserves the channel ID and requires this Action to allow both:

- The new submission: `acs:relay:*:<accountId>:channel-submission/<submitterUserId>/*`;
- Every proposed provider relation: `acs:relay:*:<accountId>:submission-provider/<submitterUserId>/*/<providerUserId>`.

The `*` in a relation ARN represents the server-allocated channel ID. Even when no providers are explicitly configured, the original submitter receives a zero-share, manual-settlement relation, so the policy must allow that relation too. To limit other configurable providers, list their user IDs instead of allowing arbitrary recipients. A relation only represents revenue configuration within this submission; it does not grant account or IAM administration over the referenced user. The server resolves provider usernames to real user IDs before authorization.

A new submission is always a disabled standalone channel pending review. Requests cannot choose its ID, impersonate another submitter, or mark it approved. Creation, provider relations and response projection are validated in one transaction. Validation failure following an authorization, identity or related-data change leaves no partial submission. Responses expose only upstream credential-presence flags, never credential contents. During migration, legacy `RELAY_CHANNEL_SUBMIT` maps only to the authenticated submitter's scope; legacy/shadow still execute the original business creation once.

The visual resource builder, catalog and downloadable JSON Schema name these fields explicitly: `submitterUserId` is the original submitter, `channelId` is the submitted channel, and `providerUserId` is the proposed revenue recipient. Personal change-request resources use `submitterUserId` and `requestId`. These template labels do not change any stored ARN. Schema and AI assistance also expose required Actions and variant-specific Actions; these are explanations of additional checks, not automatic grants. Missing identities or unclear variants must be clarified instead of replaced with broader grants.

### Deletion and service availability

Deleting an owned submission requires `quyan:relay:DeleteMyChannelSubmission`; pausing or resuming service requires `quyan:relay:SetMyChannelSubmissionServiceStatus`. Both Actions use the submission ARN above and can be limited to specific channels. They do not grant list, review, or platform-management authority. Wildcards cannot bypass original-submitter ownership.

Deletion is limited to your pending, rejected, or offboarded standalone submissions. Deletion and related token-channel reference cleanup commit or roll back together. Service availability can only be changed for approved standalone submissions; providers cannot resume an administrator-disabled channel. Requests retain two-factor verification and replay protection and do not accept OAuth tokens. Changes to identity, role sessions, AccessKeys, policies, or target state during the write cancel the entire database mutation, with no partial update. Service-status responses still return only credential-presence flags, never credential values.

### Creating and replacing a change request

With IAM enforcement enabled, the original submitter uses `quyan:relay:CreateMyChannelChangeRequest` for all of the following:

- The existing owned channel: `acs:relay:*:<accountId>:channel-submission/<submitterUserId>/<channelId>`;
- The new server-assigned request: `acs:relay:*:<accountId>:channel-change-request/<submitterUserId>/*`;
- Every old pending request being superseded, using its own change-request ARN;
- Every explicitly proposed provider relation: `acs:relay:*:<accountId>:submission-provider/<submitterUserId>/<channelId>/<providerUserId>`.

A proposal does not change live provider assignments or automatically add the submitter. Omitting the provider list preserves the existing configuration for review; an explicit empty list proposes removing all providers. Recipients may belong to other accounts, but a proposal grants no authority to manage their accounts. The server pins the resolved recipient identity; a renamed, disabled or reassigned username cannot silently redirect an approved proposal to another user. Resubmit the proposal if the recipient identity is no longer valid.

New key values are encrypted separately and never included in the configuration snapshot, public response or audit payload. Leaving a key blank keeps the current key; the returned flags indicate presence only. The approved channel continues to serve with its current settings while a change is pending. A rejected channel returns to pending and remains disabled. Authorization, identity, recipient, catalog or response-data changes cancel the new request, old-request replacement and rejected-channel recovery together.

For example, the following grants proposal access to one owned channel and a specific provider; replace every placeholder with your real identifiers:

```json
{
  "Version": "1",
  "Statement": {
    "Effect": "Allow",
    "Action": "quyan:relay:CreateMyChannelChangeRequest",
    "Resource": [
      "acs:relay:*:<accountId>:channel-submission/<submitterUserId>/<channelId>",
      "acs:relay:*:<accountId>:channel-change-request/<submitterUserId>/*",
      "acs:relay:*:<accountId>:submission-provider/<submitterUserId>/<channelId>/<providerUserId>"
    ]
  }
}
```

The request wildcard also permits superseding that submitter's pending requests; it does not grant read, review, delete or platform administration Actions. Explicit Deny still takes precedence. Step-up verification and replay protection remain required; OAuth tokens are not accepted. Existing `RELAY_CHANNEL_SUBMIT` grants are mapped automatically. JSON policies using the old account-owned `quyan:relay:channel:Submit` alias must adopt the new Action and resource types. Legacy/shadow modes perform the original creation once without a second native write.

## Earnings and settlement

Earnings are created only from an amount actually debited from a consumer balance. Failed requests, zero charges, and fully covered monthly-pass usage create no earnings. When a pass covers only part of a request, only the remaining debit is shared. Each earning preserves the channel, provider, and percentage snapshot from when the debit occurred, so later edits never rewrite history.

Providers can use real-time, every-N-days, daily-at-a-fixed-time, or manual settlement. Real-time earnings enter spendable balance directly. Scheduled settlement uses the server's Asia/Shanghai time zone. Manual providers use Transfer to balance on this page. The transfer creates a separate commission transaction in spendable balance; it is not treated as a recharge.

A channel can have several providers. Each provider can receive 0% through 100%, while the total is allowed to exceed 100%. The platform subsidizes the excess, and the channel editor shows the total plus the platform remainder or subsidy.

When resource-level IAM enforcement is enabled, earnings details require both `quyan:relay:ListMyProviderEarnings` on your provider resource (`acs:relay:*:<accountId>:provider/<userId>/<providerId>`) and on the earning resource (`acs:relay:*:<accountId>:provider-earning/<userId>/<earningId>`). Denied earnings are excluded from records, total count, and pending/settled summaries. A broad policy never exposes another user’s earnings. Historical earnings remain available after a provider configuration is disabled, subject to the same authorization.

With IAM enforcement enabled, Transfer to balance requires `quyan:relay:ClaimMyProviderEarnings` for every manual provider and pending earning included in the transfer, your balance account (`acs:balance:*:<accountId>:account/<userId>`), and the new settlement and transaction resources (`acs:relay:*:<accountId>:provider-settlement/<userId>/*` and `acs:balance:*:<accountId>:transaction/<userId>/*`). A denied resource or authorization change cancels the entire transfer without settling any provider or crediting your balance. Repeating a successful transfer does not credit already settled earnings again. Real-time and scheduled settlements continue to use their configured settlement mode.

## Resource-scoped submission review

With IAM enforcement enabled, approving, rejecting and offboarding a submitted channel require `quyan:relay:ReviewChannelSubmission` on `acs:platform:*:platform:relay-channel/<channelId>`. Approval additionally checks that same Action on each proposed provider relation, `acs:platform:*:platform:relay-channel-provider/<channelId>/<providerUserId>`, including the submitter's implicit zero-share relation. A relation authorizes revenue configuration, not management of its recipient's account. The reviewer must retain deployment-managed review eligibility; account policies cannot create this eligibility. Step-up verification and replay protection still apply.

Approval enables the channel and provider service. Rejection requires a reason; rejection and offboarding disable the channel without replacing the existing providers. An active pending change request must be reviewed first. Review, provider changes and the safe configuration response share one transaction: a final permission, identity, recipient, pending-change or response-data change rolls the review back. Responses never include upstream key values. Pool responses include only separately authorized related channels and their contributed capabilities; review does not disclose unrelated channels.

Existing `RELAY_CHANNEL_REVIEW` permissions map to the new Action automatically. JSON policies using the old `quyan:relay:channel:Review` account-owned channel alias must explicitly adopt the platform Action and resource scope. Legacy/shadow modes continue the original review once; shadow does not perform a second write or hydrate native configuration responses.

## Resource-scoped provider configuration

With IAM enforcement enabled, changing a channel's multiplier or provider list requires `quyan:relay:UpdateChannelProviderConfig` on `acs:platform:*:platform:relay-channel/<channelId>`. Replacing providers also requires that Action on every currently active and proposed relation, `acs:platform:*:platform:relay-channel-provider/<channelId>/<providerUserId>`. Removing a provider is a protected change too. Changing only the multiplier does not require grants on unrelated provider relations.

Provider usernames are resolved by the server to the real recipient IDs. A recipient may belong to another account; the relation grant does not authorize management of that account. An empty provider list disables all existing relations and does not automatically add the editor or submitter. Reconfiguration preserves settled earnings history and uses the selected settlement schedule. Identity, permission, recipient or response-data changes during the operation cancel the entire write, including the multiplier change. Responses expose credential presence only and omit unauthorized pool contributions.

The operator must retain deployment-managed eligibility through either channel review or channel update permission. Existing `RELAY_CHANNEL_REVIEW` and `RELAY_CHANNEL_UPDATE` permissions map to the new Action. JSON-only policies using the old account-owned `quyan:relay:channel:Review` or `quyan:relay:channel:Update` alias must explicitly adopt the new Action and platform channel/provider-relation resources. Step-up verification and replay protection remain required; OAuth tokens are not accepted. Legacy/shadow modes perform the existing business operation once, without a second native write.

## Resource-scoped change-request review

With IAM enforcement enabled, reviewing a change request requires `quyan:relay:ReviewChannelChangeRequest` on both the request, `acs:platform:*:platform:relay-channel-change-request/<channelId>/<requestId>`, and the channel, `acs:platform:*:platform:relay-channel/<channelId>`. The reviewer must retain deployment-managed review eligibility; account policies cannot grant that eligibility. Step-up verification and replay protection remain required.

Approval also requires that Action on every current and proposed provider relation, `acs:platform:*:platform:relay-channel-provider/<channelId>/<providerUserId>`, including relations being removed. This does not authorize management of the recipient's account. An explicit empty provider list disables all relations; omitting the list preserves them and never implicitly adds the submitter. New proposals pin recipient identity, so renaming or reusing a username cannot redirect revenue to somebody else. Settled earnings history is retained.

Approval applies only proposed channel settings and explicitly supplied new credentials, leaving routing, visibility and token assignments unchanged. For previously approved channels, a current administrator disable or provider pause remains in force; approving a change does not restart service. Rejection requires a reason and does not decrypt proposed credentials or validate stale upstream, model or provider settings; the stored proposal must still have a valid, safely displayable structure. Rejecting a recovery proposal restores its server-validated previous lifecycle state. Repeating a completed review still checks access again.

Review state, configuration, provider changes and the safe response share one transaction. A permission, identity, recipient, proposal, model-catalog or response-data change cancels the entire operation. Responses never include keys or internal identity bindings. Existing `RELAY_CHANNEL_REVIEW` permissions map to this Action; policies using only legacy JSON Actions must explicitly adopt the platform resource scopes above. Legacy/shadow modes still perform the original business write only once.

## Related pages

- [Relay settings]({{DOCS_BASE_URL}}/en/relay-settings)
- [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history)
