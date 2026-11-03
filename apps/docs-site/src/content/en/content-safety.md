# Content safety

Content safety checks text in relay requests and upstream responses, then records, replaces, or blocks content matched by a rule or AI audit. Request and response settings are independent. Your policy, token settings, and the system baseline determine the effective result.

## Before you begin

Open **Content Safety** in the AI console. The navigation entry requires relay token read permission; access to the page does not grant every operation. In IAM enforcement mode, reading and saving your policy, reading and changing rules, importing, exporting, and listing incidents require their respective `quyan:content_safety:` Actions. Ask an administrator to check the failed operation rather than menu access alone.

Administrators maintain the baseline under **System Content Safety**, which requires system configuration permission. System resource authorization, management eligibility, and verification requirements appear below.

Before enabling AI auditing, confirm that an administrator has configured a trusted audit endpoint, model, key, and prices. Auditing sends the original inspected text, even when a local rule already matches; local replacement does not redact text before it reaches the audit model. Inspected text can include serialized request or response fields, beyond chat messages. This feature does not guarantee complete inspection of images, audio, or other binary content.

## Configure your policy

1. Expand **Policy settings** and review the mode, maximum action, and AI settings separately for **User requests** and **Upstream responses**.
2. To set an explicit AI switch, first choose an explicit enabled mode for that direction, then adjust AI auditing and its action. Under **Inherit**, the form shows your overrides: an unchecked AI checkbox does not prove that inherited AI auditing is off.
3. Select **Save** at the top. This saves your policy only. Rule dialogs, rule switches, batch changes, and imports submit independently without this button.
4. Verify with a test request containing no real credentials, then check the direction, source, and action under **My incidents**.

The mode's **Inherit** option clears only that direction's enabled and default-action overrides. It does not clear maximum action, the AI switch, or the AI action. Select **Restore system defaults** to clear all personal policy overrides; this saves immediately. It does not remove private rules, personal overrides for system rules, incident history, or token overrides.

The top **Refresh** reloads the policy and current rule page, replacing unsaved policy changes. It does not refresh the separate incident table. Rules and incidents default to 20 rows per page, with no automatic polling. Failed loads can retain previous data; confirm a successful refresh before acting on it.

## Actions and inheritance

| Setting or action                     | Effect                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Disabled                              | This policy runs neither local rules nor AI auditing in this direction. Other nodes in a composite token can still apply their policies. |
| Allow `allow`                         | Keep content and record a match. Check rule actions, AI actions, and the maximum action separately.                                      |
| Replace sensitive content `blackhole` | Use replacement text from a rule or AI audit, subject to the limitations below.                                                          |
| Block with an error `unreachable`     | Reject the request or stop the response. Previously delivered stream content cannot be recalled.                                         |
| Maximum action                        | Cap this direction's processing severity; it does not turn off auditing.                                                                 |

Enabled state, default action, AI switch, and AI action use the first explicit value in token → personal → system order. The maximum action is calculated separately: take the lowest cap across system, personal, and token settings in `allow < blackhole < unreachable` order. For example, a system cap of `blackhole` limits a personal `unreachable` setting to replacement. A personal cap of `allow` limits this policy's matches to observation, while checks and AI costs can still occur.

Rules use their own actions. Selecting **Allow** for a direction does not change all rule actions or disable AI auditing. Setting one rule to observation still records its match; the independent AI audit can replace or block the same content. Rule and AI results are each capped, then combined with blocking taking precedence over replacement and allowing.

Composite-token responses can pass through several node policies. Allowing or disabling the current node does not guarantee that the entire path allows the response. Each upstream attempt keeps its initial policy and rules. Changes apply to the next request, retry, or channel switch; existing long-lived streams keep their initial settings.

## Add, adjust, and stop rules

1. Expand **Dangerous rules**, select **Add rule**, enter the name, type, pattern, direction, action, and priority, then save the dialog.
2. Names accept 1–120 characters and patterns 2–2000 characters. Choose requests, responses, or both. `literal` matches literal content; `regex` accepts the expression body without `/.../` delimiters. Expressions must be valid and must not match empty text. Backreferences and some unsafe repetition structures are rejected.
3. Lower priorities match first. Ties use creation time from oldest to newest, then rule ID. Each evaluation uses only the first matching local rule; it does not replace matches from every rule. The private-rule dialog currently saves priority `0` as `100`; use a positive integer and verify the saved value.
4. For batch changes, select only your private rules, then use batch editing, enable, disable, or observation mode. Batch editing changes only checked fields. Selecting system rules hides the personal page's batch buttons; the page does not automatically skip them.

The personal page cannot edit or delete system rule content. A system row's switch saves an exception for you alone. System rules disabled globally do not appear in the personal rule list and cannot be re-enabled by a personal exception.

**Current limitation: a private rule displayed as disabled can still participate in runtime matching.** To ensure that a private rule stops applying, export a backup, delete the rule, and verify with a new test request. There is no restore button after deletion. Do not rely solely on its switch or `enabled=false` in a CSV to establish that a private rule has stopped matching.

Matching normalizes Unicode, removes some zero-width and control characters, collapses whitespace, and ignores case. Rule replacement only attempts to replace the first matching fragment in the original text with `[REDACTED]`. A match in normalized text can also fail to replace directly in the original. Multiple fragments, different rules, and AI replacements are not automatically combined into complete redaction. `blackhole` therefore does not guarantee full sanitization. Replacement that makes a structured request or response unparseable can still block the request.

## AI auditing, costs, and streaming

AI auditing runs independently of local rules; a local match does not avoid the audit call. Costs use the administrator's configured prices per million input and output tokens: `(input tokens × input price + output tokens × output price) / 1000000`. Text-length estimates can be used when the model supplies no usage. An allowing audit can still cost money and contribute to relay usage settlement.

Missing channel parameters, text exceeding the audit length limit, timeout, call failure, or an invalid audit result produces an audit-failure result that blocks by default, subject to the maximum action. Some failures record estimated tokens and costs even without a request to the audit model. Neither an absent upstream call, an absent answer, nor an absent AI incident proves zero cost. Blocked paths can still settle audit fees; consult actual usage and billing.

| Response mode                          | Observable behavior                                                                                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-streaming                          | Inspect the received response before returning it. Blocking withholds the response; replaced structured content must remain parseable.                                                                |
| Streaming with response AI auditing    | Collect the complete textual stream before checking it, then send headers and content only after it passes. This increases waiting time and is subject to server stream-buffer and frame limits.      |
| Streaming without response AI auditing | Check local rules on stream frames, including adjacent frames. This is not one full-response audit. A later block cannot recall delivered content, and matching across more frames is not guaranteed. |

Long responses can also exceed the AI text limit and fail auditing. Avoid repeated retries as a way to test whether a failure is free; first review incidents, usage, and the audit configuration.

## Import and export rules

Export JSON to inspect the current scope's policy and rules, or CSV to migrate rules. Exports cover more than the current table page and contain no API keys, token credentials, matched source text, or complete request/response payloads. Personal exports can include system rules; these cannot be imported as private-rule overwrites. The page has no one-click JSON restore workflow.

1. Prepare a UTF-8 CSV of at most 1 MiB with a header and at least one rule. Required columns are `name,type,pattern,direction,action`; optional columns include `id,enabled,priority`. Rules default to enabled with priority `100`. This example only observes matches:

   ```csv
   name,type,pattern,direction,action,enabled,priority
   Example observation,literal,example-marker,request,allow,true,100
   ```

2. Import the CSV and review potential creates, updates, and errors. Validation errors prevent all application.
3. Choose **Overwrite existing rules** as needed, then confirm. Existing rules match by ID or `type + direction + normalized pattern`. Without overwrite, only new rules apply. Changing the checkbox does not refresh the preview; confirmation uses its current value, so previewed update counts can differ from applied counts.
4. Review the saved rules and send a test request. Importing rules does not change policy or AI switches, and does not delete rules omitted from the CSV.

Administrators can repeat default-rule import to add missing defaults. The current default baseline matches complete PEM private-key material only. Ordinary tool definitions, system prompts, code, commands, and configuration paths alone do not trigger this default rule. Upgrades do not clean up existing rules. To relax historical system rules, keep their IDs, set `enabled=false`, preview, and import with overwrite. AI auditing can still match independently; never test with complete real credentials.

## View incidents and notifications

Expand **My incidents** and filter by time, request ID, token name, channel name, direction, source, or processing status. Submit text filters with Enter or the filter button. Date, direction, source, and status changes query immediately. Filtering and sorting return to page one; the table's **Refresh** retains the current page and filters. Sort by time, request ID, or status code. Use **Column settings** to show audit model, tokens, duration, and cost; choices are stored in this browser separately for personal and system tables.

Rows count matches, so one request can produce multiple rule and AI records. An allowing AI audit need not create an AI incident, and incident cost is not the entire request bill. Excerpts are limited context rather than full payloads. Normalized matches and AI incidents can have no excerpt. Token, channel, and rule context names can reflect current names. Failed loads can leave old rows visible; confirm successful refresh.

System policy changes create operation audit logs without sending content-safety emails. Notification is attempted only when the user subscribes to `content_safety_blocked` and the final action is `unreachable`, subject to subscription, cooldown, and email configuration. Allowing and replacement do not dispatch this event. No email does not prove that no block occurred.

## Maintain the system policy

In **System Content Safety**, configure request and response settings and the AI endpoint, model, key, protocol, timeout, input/output prices, and text length limit. Select **Save** in the policy section. Audit protocols support OpenAI Chat Completions, Anthropic, and Gemini. Timeout accepts 1000–30000 milliseconds and text length 1000–100000 characters. Defaults are 5000 milliseconds and 16000 characters; use the current configuration as authoritative.

Leave the key blank to retain its saved value. Enter and save a new value to replace it; after success the input clears and only the configured marker remains. Clearing the stored key requires the API's explicit clear option, which has no page button. Policy refresh also reloads rules; refresh incidents separately. System rule edits, imports, and batch operations save independently and can require step-up verification.

## Resource permissions for system policy reads

In IAM enforcement mode, system configuration reads and writes, rule lists, and rule exports use separate Actions:

| Operation                   | Action                                    | Resource                                                                     |
| --------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| Read system configuration   | `quyan:content_safety:GetSystemConfig`    | `acs:platform:*:platform:content-safety-config`                              |
| List system rules           | `quyan:content_safety:ListSystemRules`    | `acs:platform:*:platform:content-safety-rule/<ruleId>`                       |
| Export system rules         | `quyan:content_safety:ExportSystemRules`  | The same rule resource; choose specific rules or use `content-safety-rule/*` |
| Update system configuration | `quyan:content_safety:UpdateSystemConfig` | `acs:platform:*:platform:content-safety-config`                              |

Configuration updates are atomic: authorization changes or a conflicting configuration change reject the entire update. An omitted AI API key is preserved; a replacement is encrypted, and the clear option takes precedence when both are supplied. The update response describes the saved configuration and contains only the key-configured marker.

Generic configuration APIs also require the corresponding content safety read or update Action for these fields. A domain Deny therefore also restricts the generic configuration workflow.

The operator must still belong to an active global group with system configuration management eligibility. Account policies cannot manufacture that membership. Role sessions use the role's own Allow, and matching explicit Deny takes precedence.

Each rule resource is evaluated before pagination, and totals include allowed rules only. System reads include system rules; use the corresponding user rule workflow for private rules. A list can be empty when no Allow matches. Denied rule bodies are neither read nor exported.

JSON export includes system configuration and therefore also requires separate configuration read authority. CSV contains rules only and does not require config read authority. Responses and exports never return API keys, only whether a key is configured. Policy, rule content, ownership, or config changes during a read cause rejection to prevent a result assembled from mixed states.

`legacy` and `shadow` retain the previous system configuration permission checks and response scope. Shadow compares the new resource checks without replacing the old result. Adding a specific-resource Allow does not remove existing broad Allows; review the identity's other policies and group grants when restricting scope.

## System rule writes and resource scope

IAM enforcement separates `CreateSystemRule`, `UpdateSystemRule`, `DeleteSystemRule`, and `BatchUpdateSystemRules` under `quyan:content_safety:`. These operations retain system configuration management eligibility, step-up verification, and replay protection.

Creation requires Allow for both `acs:platform:*:platform:content-safety-rule-control` and the actual `acs:platform:*:platform:content-safety-rule/<ruleId>` generated by the server. Allow for the control resource alone is insufficient. Updates and deletion require authority for the target rule. Batch updates check every rule ID and reject duplicate IDs; if any target is denied, missing, or private, the entire operation fails without partial changes. Private rules use the user rule workflow.

Rule writes are atomic. If identity, group membership, authorization, or target content changes before completion, the write is rejected and rolled back. Deletion disables and removes the rule from the active set. System rule writes in IAM enforcement mode preserve priority `0`; see the private-rule dialog limitation above.

The shared budget is 500 undeleted rules and 1 MiB of pattern data across system and private rules. Disabled but undeleted rules still consume capacity. Writes cannot increase a dimension beyond its limit. If existing data already exceeds a limit, edits that do not worsen that dimension and deletions remain available to repair the ruleset.

## Import authorization

In IAM enforcement mode, CSV import uses `quyan:content_safety:ImportSystemRules`; default import uses `quyan:content_safety:ImportDefaultSystemRules`. Both require the rule control resource, authority for existing rules they use, and authority for each actual rule ID generated during application.

CSV preview returns old values for authorized system rules only. An explicit ID that is private, missing, or denied rejects the request, so it cannot be used to probe another rule. Preview and rows with validation errors do not write. With overwrite disabled, existing rules remain unchanged; imported replacements of default rules retain their default origin.

Application is atomic: a denied target or generated resource, a ruleset or authorization change, or the shared capacity limit rolls back all writes. Default import is repeatable and checks existing default targets; private copies do not count as installed system defaults. Legacy and shadow modes keep one old import, with shadow checking the real created IDs.

## System incident scope

In IAM enforcement mode, `quyan:content_safety:ListSystemIncidents` controls each `acs:platform:*:platform:content-safety-incident/<incidentId>`. Records are authorized before pagination and counting; only allowed records contribute to totals or expose matching excerpts. The usual filters and sort choices still apply. The operator must retain system configuration management eligibility; role sessions require their own policy Allow.

Associated rule names and types provide context. A live system rule pattern additionally requires `ListSystemRules` authority for that rule; denied, private, or inactive rule patterns are omitted. The UI can show the rule ID instead. Token and channel names may appear as context, while credentials are never returned. Changes to contributing incident content, rule data, context names, or authorization during the read cause rejection.

API dates remain ISO timestamps and incident costs are decimal strings. `legacy` and `shadow` retain the previous system incident scope; shadow compares IAM results without changing the old response.

## Related pages

- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
- [AI request logs]({{DOCS_BASE_URL}}/en/ai-request-logs)
- [Notification settings]({{DOCS_BASE_URL}}/en/notification-settings)
