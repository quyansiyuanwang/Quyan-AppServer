# Content safety

Content safety is managed from dedicated AI console pages instead of being embedded in relay settings. Request and response directions are configured independently, and policies, rules, and incidents use server-side pagination.

## Configure your policy

1. Open **Content Safety** in the AI console and expand **Policy settings**. Review the default action, maximum action, and AI audit settings separately for **User requests** and **Upstream responses**. Select **Inherit** to use the parent setting. See “Actions and inheritance” below for how the action cap works.
2. Select **Save** at the top of the page to submit your policy. To restore the system defaults, select **Restore system defaults**; this immediately saves the inheritance settings.
3. To define your own matching conditions, expand **Dangerous rules**, select **Add rule**, and enter the name, type, pattern, direction, action, and other settings. Save in the dialog. Rule creation and edits are submitted separately from the policy save button at the top of the page.
4. Expand **My incidents** and filter the records as needed to check matched rules and outcomes. Token settings can override the user policy, subject to the maximum action cap.

## Actions and inheritance

Rule or AI matches can allow content, replace sensitive text (`blackhole`), or block with an error (`unreachable`). “Maximum action” is the direction-level safety cap; the effective action can never exceed it. The effective cap is the lowest configured value across system, user, and token scopes in `allow < blackhole < unreachable` order. User and token settings can inherit the parent cap; a lower value further limits the final action, while a higher value cannot exceed the parent cap. For example, if the system cap is `blackhole`, a user cap of `unreachable` still permits at most `blackhole`, while a user cap of `allow` limits matches to allowing content.

Use the batch “set to allow for observation” action to keep recording matches without replacing or blocking content while you observe normal usage. System rules are changed through personal enable/disable overrides; private user rules support full editing. Batch operations skip system rules that are not editable in the current scope.

AI auditing sends text to the configured model and charges input/output tokens. Confirm the upstream endpoint, model, and pricing before enabling it.

## Notifications and incidents

Updating the system policy creates an audit log only; it does not send a content safety email. Email delivery occurs only when the user subscribes to `content_safety_blocked` and the final action is `unreachable`; the notification service still applies subscription, cooldown, and email-address checks. `allow` and `blackhole` matches never dispatch this event.

Incident records support refresh, server-side filtering, sorting, and pagination. Refresh keeps the current filters and page. The table shows the matching rule name, type, and rule ID/pattern summary; AI matches show their AI source. Context is HTML-escaped before the matched fragment is highlighted, and complete request/response payloads are not exposed.

## Rules and export

The rule table supports multi-select editing, enable/disable, and batch observation mode. CSV imports are previewed before application. Overwrite mode updates matches by rule ID or `type + direction + pattern` and never deletes rules outside the CSV.

The import preview lists potential creates and updates. Changing the **Overwrite existing rules** checkbox does not refresh the preview. The current checkbox value is used when you confirm: if it is unchecked, updates to matching existing rules in the preview are not applied. The preview update count therefore may differ from the number actually applied. Check the CSV and overwrite setting before confirming.

Users and administrators can export the current scope as JSON policy or CSV rules. Exports do not include API keys, tokens, matched source text, or complete request/response payloads.

## System policy

Administrators with system configuration permission can manage the system baseline, AI channel, default rules, system rules, and all incident records from the System Content Safety page. Existing security verification remains required for system changes.

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

Rule writes are atomic. If identity, group membership, authorization, or target content changes before completion, the write is rejected and rolled back. Deletion disables and removes the rule from the active set. Priority `0` remains valid.

The shared budget is 500 active rules and 1 MiB of pattern data, including system and private rules. Writes cannot increase a dimension beyond its limit. If existing data already exceeds a limit, edits that do not worsen that dimension and deletions remain available to repair the ruleset.

## Import authorization

In IAM enforcement mode, CSV import uses `quyan:content_safety:ImportSystemRules`; default import uses `quyan:content_safety:ImportDefaultSystemRules`. Both require the rule control resource, authority for existing rules they use, and authority for each actual rule ID generated during application.

CSV preview returns old values for authorized system rules only. An explicit ID that is private, missing, or denied rejects the request, so it cannot be used to probe another rule. Preview and rows with validation errors do not write. With overwrite disabled, existing rules remain unchanged; imported replacements of default rules retain their default origin.

Application is atomic: a denied target or generated resource, a ruleset or authorization change, or the shared capacity limit rolls back all writes. Default import is repeatable and checks existing default targets; private copies do not count as installed system defaults. Legacy and shadow modes keep one old import, with shadow checking the real created IDs.

## System incident scope

In IAM enforcement mode, `quyan:content_safety:ListSystemIncidents` controls each `acs:platform:*:platform:content-safety-incident/<incidentId>`. Records are authorized before pagination and counting; only allowed records contribute to totals or expose matching excerpts. The usual filters and sort choices still apply. The operator must retain system configuration management eligibility; role sessions require their own policy Allow.

Associated rule names and types provide context. A live system rule pattern additionally requires `ListSystemRules` authority for that rule; denied, private, or inactive rule patterns are omitted. The UI can show the rule ID instead. Token and channel names may appear as context, while credentials are never returned. Changes to contributing incident content, rule data, context names, or authorization during the read cause rejection.

API dates remain ISO timestamps and incident costs are decimal strings. `legacy` and `shadow` retain the previous system incident scope; shadow compares IAM results without changing the old response.

## Programming workflows and rule updates

The default import uses a relaxed development baseline: only complete PEM private-key material is blocked. Tool definitions, system prompts, common code, commands and configuration paths are not blocking signals by themselves. Placeholders, standalone markers and abbreviated key templates do not match; avoid sending complete real credentials.

Upgrades do not automatically disable existing rules. To relax a legacy ruleset, retain each rule ID and set enabled=false in CSV, preview, then import with overwrite. Removing CSV rows does not delete database rules. CSV contains rules, not AI-review switches; AI review can still block independently.

Each upstream attempt uses its initial policy and rule snapshot. Edits apply to the next request, retry or channel switch; active long-lived streams keep their original rules.
