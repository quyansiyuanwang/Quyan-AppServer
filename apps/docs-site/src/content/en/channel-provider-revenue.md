# Channel supply and earnings

Submit standalone relay channels, follow reviews, pause or resume your supplied channels, and inspect commission earnings and balance transfers. Supplying a channel does not guarantee earnings: it must be approved, available, used for actual balance charges, and configured with a nonzero share for you.

## Prerequisites

Open **Channel supply and earnings** in the console. Page access accepts either of the first two permissions below; data and operations are checked separately.

| Purpose                                                                                | Console permission              |
| -------------------------------------------------------------------------------------- | ------------------------------- |
| Submit channels, read your submissions, request changes, pause or delete your channels | `relay:channel:submit`          |
| Read your earnings                                                                     | `relay:channel:provider:read`   |
| Transfer manual earnings to balance                                                    | `relay:channel:provider:settle` |
| Open channel supply review and review submissions                                      | `relay:channel:review`          |

IAM enforcement additionally checks independent Actions and resources, described later. Earnings access does not grant submission access. Receiving a share does not make you the original submitter: changes, service switches, and deletion remain restricted to that submitter. These endpoints have no OAuth scopes and do not accept OAuth tokens.

## Submit a standalone channel

1. Click **Submit channel**, enter a name, and select supported protocol formats. This workflow creates standalone channels, not pools.
2. Enter a base URL and API key for each enabled upstream type. OpenAI Chat Completions and Responses share the OpenAI upstream configuration. Selecting a format does not guarantee upstream compatibility; verify the supplied capability first.
3. Optionally set allowed models, mappings, the channel multiplier, cache-read accounting, time-period multipliers, and context-length multipliers. The channel multiplier affects consumer charges and differs from a provider's commission percentage. See [Relay settings]({{DOCS_BASE_URL}}/en/relay-settings) for pricing rules.
4. To allocate revenue, enter provider usernames, percentages, and settlement modes. Usernames must identify active users and cannot be duplicated. Each provider can receive 0%–100%; the total may exceed 100%, with the platform subsidizing the excess. Check the total and platform remainder before submitting.
5. After submission, confirm pending review in your submissions list. The new channel is disabled until an administrator approves it.

On initial submission, if the original submitter is not explicitly listed as a provider, the system adds them with **0% commission and manual settlement**. **A 0% share generates no earnings.** The automatic relation does not award a nonzero commission.

After keys are submitted, lists and configuration responses return only configured-key flags, not key values. Never put keys in names, review reasons, or other descriptive fields.

### Discover upstream models

Use model discovery in the format and model section to read the upstream `/v1/models` list. If the base path already ends in `/v1`, discovery appends `/models`. Results matching platform model pricing can be selected and added to the restriction; unmatched results are displayed but cannot be added with that button. Discovery does not prove that a model is callable or that a channel has been approved.

- **Initial submission form:** discovery uses the URL and key currently entered, without saving credentials or creating a channel.
- **Existing channel's change form:** discovery uses the corresponding upstream configuration already saved on the server, ignoring the new URL and key awaiting review in the form. A successful probe does not validate those new credentials.

Discovery has independent IAM authorization. Enforcement uses `quyan:relay:ListUpstreamModels` on `acs:quyan:*:<accountId>:account` for a new preview, or on the original submitter's submission ARN for an existing owned standalone channel. Submission and read grants do not automatically grant discovery.

## Understand review and service status

| Review status   | Main operations for the original submitter | Service meaning                                                       |
| --------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| Pending         | Submit or replace a change request, delete | Awaiting review; not online                                           |
| Approved/listed | Request changes, pause or resume           | Serves only when administrator-enabled and not provider-paused        |
| Rejected        | Read the reason, request changes, delete   | Not serving; a new proposal returns it to pending                     |
| Offboarded      | Delete                                     | Not serving; the current supply form does not accept change proposals |

Review status and service status appear separately. An approved channel can still be administrator-disabled or provider-paused. Resuming provider service cannot override an administrator disable.

### Submit or replace a change request

1. Click **Submit change request** on your submission row. This is available for pending, approved, and rejected standalone channels.
2. Check the complete configuration before submitting. The form loads current channel settings; it **does not load or merge the previous pending proposal**. Re-enter any unapplied changes you need to retain.
3. Leave a key blank to retain the currently saved key, or enter a replacement. Replacing a pending proposal does not automatically retain its unapplied new key either.
4. If a pending request exists, confirm replacement. The previous request is superseded and no longer appears as reviewable; the new request still needs approval.
5. Check status and reasons in the submission's change-request column. An approved channel keeps using its existing configuration while review is pending; the proposal itself does not change service switches.

The UI sends the form's complete provider list. Removing every provider proposes removing all relations, rather than preserving them. Only omitting the list in an API request preserves existing assignments. Change proposals do not automatically add the submitter; verify that every intended recipient remains listed.

A new proposal for a rejected channel returns it to pending while disabled; approval applies the configuration and enables service. For a previously approved channel, approving changes preserves its current administrator enablement and provider pause state, rather than restarting service. Rejecting a recovery proposal restores the server-validated previous state.

### Pause, resume, or delete

- For an approved channel, click **Pause service** or **Resume service** and confirm. Pausing does not change the review result, pending proposal, or existing earnings. It controls channel availability and should not be used to cancel requests already in progress.
- A provider cannot resume an administrator-disabled channel; contact the administrator to confirm enablement first.
- Pending, rejected, and offboarded channels can be deleted; listed channels cannot be deleted directly by the provider. Deletion cannot be undone. The channel and its change requests disappear from supply/review lists, and related token-channel references are cleaned up.

Submissions use 20 rows per page. The current page additionally loads only the latest 100 visible change requests and displays the latest one found for each channel. A blank column does not prove no proposal exists. There is no automatic polling: reopen the page or refresh the browser for review changes. Paging submissions does not refresh earnings. Failed loads can retain previous data; check error notices.

## Read earnings and transfer to balance

### How earnings are created

Commission uses the amount **actually debited from the consumer's balance**. Failed requests, zero charges, and fully covered monthly-pass usage generate none. With partial pass coverage, only the remaining balance debit is shared. Each provider's share is rounded to 4 decimal places per charge; no earning record is created when the result is zero.

For example, an actual balance debit of 10 with a 20% share yields 2. If a pass covers that charge completely, it yields no commission. Each earning retains its original debit amount, percentage, and commission amount; later percentage edits do not recalculate historical amounts. The channel name in the list is its current name, not a historical name snapshot.

The earnings section shows channel name, actual charge basis, percentage, commission amount, and settlement state, with 20 rows per page. Pending and settled totals cover all your authorized earnings, not just the current page. Historical earnings remain readable after a provider relation is disabled, subject to IAM authorization.

### Settlement modes

| Mode                  | Result and timing                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Real-time             | Newly created earnings settle directly into spendable balance                                                                            |
| Every N days          | N is an integer from 1 to 365; processing follows the current settlement schedule rather than waiting N days separately for each earning |
| Daily at a fixed time | Uses `HH:mm` in `Asia/Shanghai`, independently of the browser's time zone                                                                |
| Manual                | The recipient clicks **Transfer to balance** on this page                                                                                |

The background scheduler checks due plans about once a minute. Settlement is not guaranteed at an exact second, and service outages or task failures can delay it. Reconfiguring a provider recalculates its future schedule. Switching to real-time does not guarantee immediate settlement of every historical pending earning.

### Transfer manual earnings

1. Check pending totals and earning records, and confirm `relay:channel:provider:settle` plus the required IAM grants.
2. Click **Transfer to balance**. There is no per-channel or per-record selection step. The operation attempts to claim all unsettled earnings under your **currently active, manual-settlement** provider relations.
3. After success, the earnings list returns to page 1. Check settled state and the **channel commission** credit in balance history. The credit increases spendable balance and is not a recharge.

**The pending total is not the manually claimable amount.** It may include scheduled earnings or history under disabled relations. A clickable button can still result in a zero transfer. If a relation is disabled, ask an administrator to check whether to restore it and which settlement mode to use.

Read and claim grants are independent. Under IAM enforcement, a claim authorizes every candidate earning; any denial cancels the entire claim rather than claiming only the visible subset. Repeating a claim does not credit settled earnings twice. If a request fails or a refresh fails after success, query earnings and balance history before deciding whether to retry.

## Administrator review and configuration

1. Open **Channel supply review**. It defaults to pending submissions. To find changes for an online channel, switch the status filter to all or approved. Press Enter to search channel names; status-filter changes query again.
2. If a pending change request exists, inspect and review that proposal first. Reviewing the initial submission while a pending proposal exists conflicts. Approval applies the complete proposal; rejection requires a reason.
3. For a pending channel without a pending change request, approve or reject the initial submission. Initial approval enables both the channel and provider service; offboarding disables the channel.
4. Click **Configure**, check the multiplier, recipient usernames, total percentage, and settlement modes, then save. This save is independent of proposal review and changes current configuration directly. Saving an empty provider list disables all relations.
5. Refresh to confirm the review outcome and service state. There is no polling. Refresh returns channel listings to page 1; the page separately loads only the latest 100 pending proposals, so an undisplayed proposal can still block initial review.

Reading management listings, opening configuration, and listing proposals require grants independent of reviewing or saving. A review Action alone does not guarantee every UI step is available. Under IAM enforcement, review and provider configuration updates recheck authorization and related data within a transaction, so failure does not apply partial configuration. The following reference describes additional resource checks.

## IAM access to my submissions

In IAM enforce mode, My submitted channels uses `quyan:relay:ListMyChannelSubmissions` on `acs:relay:*:<accountId>:channel-submission/<submitterUserId>/<channelId>`. The submitter segment and account come from the authenticated identity. This is personal submission access, not platform channel management; deployment-global management membership is not required. A JSON-only grant can allow selected own submissions without granting channel creation, review, deletion or health access.

The list always remains limited to the authenticated user's own non-deleted standalone submissions, including pending, rejected, disabled and provider-paused records. Even wildcard policies cannot list another submitter's channels. Authorization filtering happens before pagination and total calculation; totals describe only allowed submissions. Private visibility does not hide a submission from its original submitter. An assumed role uses its own policy grants, not the user's grants. These unscoped endpoints do not accept OAuth tokens.

The response preserves review information, effective models and upstream key-presence booleans, but never returns key values. A submitted standalone channel does not expose a pool parent or unrelated members. If identity, authorization or relevant resource data changes during loading, the result is rejected.

### Creating a submission pending review

With IAM enforcement enabled, submission creation uses `quyan:relay:CreateMyChannelSubmission`. The server reserves the channel ID and requires this Action to allow both:

- The new submission: `acs:relay:*:<accountId>:channel-submission/<submitterUserId>/*`;
- Every proposed provider relation: `acs:relay:*:<accountId>:submission-provider/<submitterUserId>/*/<providerUserId>`.

The `*` in a relation ARN represents the server-allocated channel ID. Even when no providers are explicitly configured, the original submitter receives a zero-share, manual-settlement relation, so the policy must allow that relation too. To limit other configurable providers, list their user IDs instead of allowing arbitrary recipients. A relation only represents revenue configuration within this submission; it does not grant account or IAM administration over the referenced user. The server resolves provider usernames to real user IDs before authorization.

A new submission is always a disabled standalone channel pending review. Requests cannot choose its ID, impersonate another submitter, or mark it approved. Creation, provider relations and response projection are validated in one transaction. Validation failure following an authorization, identity or related-data change leaves no partial submission. Responses expose only upstream credential-presence flags, never credential contents. During migration, legacy `RELAY_CHANNEL_SUBMIT` maps only to the authenticated submitter's scope.

### Deletion and service availability

Deleting an owned submission requires `quyan:relay:DeleteMyChannelSubmission`; pausing or resuming service requires `quyan:relay:SetMyChannelSubmissionServiceStatus`. Both Actions use the submission ARN above and can be limited to specific channels. They do not grant list, review, or platform-management authority. Wildcards cannot bypass original-submitter ownership.

Deletion is limited to your pending, rejected, or offboarded standalone submissions. Deletion and related token-channel reference cleanup commit or roll back together. Service availability can only be changed for approved standalone submissions; providers cannot resume an administrator-disabled channel. Requests retain two-factor verification and replay protection and do not accept OAuth tokens. Changes to identity, role sessions, AccessKeys, policies, or target state during the write cancel the entire database mutation, with no partial update. Service-status responses still return only credential-presence flags, never credential values.

### Read change requests

Your proposal list uses `quyan:relay:ListMyChannelChangeRequests` on `acs:relay:*:<accountId>:channel-change-request/<submitterUserId>/<requestId>`. It returns only your own visible proposals for undeleted channels and does not require deployment-global group eligibility. The administrator list uses the independent `quyan:relay:ListChannelChangeRequests` on each `acs:platform:*:platform:relay-channel-change-request/<channelId>/<requestId>`, together with actual deployment-global review eligibility.

Both lists filter authorization before totals and pagination and never return keys. Read, create, and review Actions are independent. A missing proposal after an IAM denial or before refresh does not prove it does not exist.

### Creating and replacing a change request

With IAM enforcement enabled, the original submitter uses `quyan:relay:CreateMyChannelChangeRequest` for all of the following:

- The existing owned channel: `acs:relay:*:<accountId>:channel-submission/<submitterUserId>/<channelId>`;
- The new server-assigned request: `acs:relay:*:<accountId>:channel-change-request/<submitterUserId>/*`;
- Every old pending request being superseded, using its own change-request ARN;
- Every explicitly proposed provider relation: `acs:relay:*:<accountId>:submission-provider/<submitterUserId>/<channelId>/<providerUserId>`.

A proposal does not change live provider assignments or automatically add the submitter. Omitting the provider list preserves the existing configuration for review; an explicit empty list proposes removing all providers. Recipients may belong to other accounts, but a proposal grants no authority to manage their accounts. The server pins the resolved recipient identity; a renamed, disabled or reassigned username cannot silently redirect an approved proposal to another user. Resubmit the proposal if the recipient identity is no longer valid.

New key values are encrypted separately and never included in public responses or audit records. Leaving a key blank keeps the current key; the returned flags indicate presence only. The approved channel continues to serve with its current settings while a change is pending. A rejected channel returns to pending and remains disabled. Authorization, identity, recipient, catalog or response-data changes cancel the new request, old-request replacement and rejected-channel recovery together.

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

The request wildcard also permits superseding that submitter's pending requests; it does not grant read, review, delete or platform administration Actions. Explicit Deny still takes precedence. Step-up verification and replay protection remain required; OAuth tokens are not accepted. Existing `RELAY_CHANNEL_SUBMIT` grants are mapped automatically. JSON policies using the old account-owned `quyan:relay:channel:Submit` alias must adopt the new Action and resource types.

## IAM permissions for earnings reads and claims

When resource-level IAM enforcement is enabled, earnings details require both `quyan:relay:ListMyProviderEarnings` on your provider resource (`acs:relay:*:<accountId>:provider/<userId>/<providerId>`) and on the earning resource (`acs:relay:*:<accountId>:provider-earning/<userId>/<earningId>`). Denied earnings are excluded from records, total count, and pending/settled summaries. A broad policy never exposes another user’s earnings. Historical earnings remain available after a provider configuration is disabled, subject to the same authorization.

With IAM enforcement enabled, Transfer to balance requires `quyan:relay:ClaimMyProviderEarnings` for every manual provider and pending earning included in the transfer, your balance account (`acs:balance:*:<accountId>:account/<userId>`), and the new settlement and transaction resources (`acs:relay:*:<accountId>:provider-settlement/<userId>/*` and `acs:balance:*:<accountId>:transaction/<userId>/*`). A denied resource or authorization change cancels the entire transfer without settling any provider or crediting your balance. Repeating a successful transfer does not credit already settled earnings again. Real-time and scheduled settlements continue to use their configured settlement mode.

## Resource-scoped submission review

With IAM enforcement enabled, approving, rejecting and offboarding a submitted channel require `quyan:relay:ReviewChannelSubmission` on `acs:platform:*:platform:relay-channel/<channelId>`. Approval additionally checks that same Action on each proposed provider relation, `acs:platform:*:platform:relay-channel-provider/<channelId>/<providerUserId>`, including the submitter's implicit zero-share relation. A relation authorizes revenue configuration, not management of its recipient's account. The reviewer must retain deployment-managed review eligibility; account policies cannot create this eligibility. Step-up verification and replay protection still apply.

Approval enables the channel and provider service. Rejection requires a reason; rejection and offboarding disable the channel without replacing the existing providers. An active pending change request must be reviewed first. Review, provider changes and the safe configuration response share one transaction: a final permission, identity, recipient, pending-change or response-data change rolls the review back. Responses never include upstream key values. Pool responses include only separately authorized related channels and their contributed capabilities; review does not disclose unrelated channels.

Existing `RELAY_CHANNEL_REVIEW` permissions map to the new Action automatically. JSON policies using the old `quyan:relay:channel:Review` account-owned channel alias must explicitly adopt the platform Action and resource scope.

## Resource-scoped provider configuration

With IAM enforcement enabled, changing a channel's multiplier or provider list requires `quyan:relay:UpdateChannelProviderConfig` on `acs:platform:*:platform:relay-channel/<channelId>`. Replacing providers also requires that Action on every currently active and proposed relation, `acs:platform:*:platform:relay-channel-provider/<channelId>/<providerUserId>`. Removing a provider is a protected change too. Changing only the multiplier does not require grants on unrelated provider relations.

Provider usernames are resolved by the server to the real recipient IDs. A recipient may belong to another account; the relation grant does not authorize management of that account. An empty provider list disables all existing relations and does not automatically add the editor or submitter. Reconfiguration preserves settled earnings history and uses the selected settlement schedule. Identity, permission, recipient or response-data changes during the operation cancel the entire write, including the multiplier change. Responses expose credential presence only and omit unauthorized pool contributions.

The operator must retain deployment-managed eligibility through either channel review or channel update permission. Existing `RELAY_CHANNEL_REVIEW` and `RELAY_CHANNEL_UPDATE` permissions map to the new Action. JSON-only policies using the old account-owned `quyan:relay:channel:Review` or `quyan:relay:channel:Update` alias must explicitly adopt the new Action and platform channel/provider-relation resources. Step-up verification and replay protection remain required; OAuth tokens are not accepted.

## Resource-scoped change-request review

With IAM enforcement enabled, reviewing a change request requires `quyan:relay:ReviewChannelChangeRequest` on both the request, `acs:platform:*:platform:relay-channel-change-request/<channelId>/<requestId>`, and the channel, `acs:platform:*:platform:relay-channel/<channelId>`. The reviewer must retain deployment-managed review eligibility; account policies cannot grant that eligibility. Step-up verification and replay protection remain required.

Approval also requires that Action on every current and proposed provider relation, `acs:platform:*:platform:relay-channel-provider/<channelId>/<providerUserId>`, including relations being removed. This does not authorize management of the recipient's account. An explicit empty provider list disables all relations; omitting the list preserves them and never implicitly adds the submitter. New proposals pin recipient identity, so renaming or reusing a username cannot redirect revenue to somebody else. Settled earnings history is retained.

Approval applies only proposed channel settings and explicitly supplied new credentials, leaving routing, visibility and token assignments unchanged. For previously approved channels, a current administrator disable or provider pause remains in force; approving a change does not restart service. Rejection requires a reason and does not decrypt proposed credentials or validate stale upstream, model or provider settings; the stored proposal must still have a valid, safely displayable structure. Rejecting a recovery proposal restores its server-validated previous lifecycle state. Repeating a completed review still checks access again.

Review state, configuration, provider changes and the safe response share one transaction. A permission, identity, recipient, proposal, model-catalog or response-data change cancels the entire operation. Responses never include keys or internal identity bindings. Existing `RELAY_CHANNEL_REVIEW` permissions map to this Action; policies using only legacy JSON Actions must explicitly adopt the platform resource scopes above.

## Related pages

- [Relay settings]({{DOCS_BASE_URL}}/en/relay-settings)
- [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history)
