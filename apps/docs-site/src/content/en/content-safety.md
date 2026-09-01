# Content safety

Content safety is managed from dedicated AI console pages instead of being embedded in relay settings. Request and response directions are configured independently, and policies, rules, and incidents use server-side pagination.

## Actions and inheritance

Rule or AI matches can allow content, replace sensitive text (`blackhole`), or block with an error (`unreachable`). “Maximum action” is the direction-level safety cap; the effective action can never exceed it. System, user, and token scopes use the strictest value in `allow < blackhole < unreachable` order. User and token settings can inherit the parent scope, keep its cap, or tighten it, but cannot loosen the system cap.

Use the batch “set to allow for observation” action to keep recording matches without replacing or blocking content while you observe normal usage. System rules are changed through personal enable/disable overrides; private user rules support full editing. Batch operations skip system rules that are not editable in the current scope.

AI auditing sends text to the configured model and charges input/output tokens. Confirm the upstream endpoint, model, and pricing before enabling it.

## Notifications and incidents

Updating the system policy creates an audit log only; it does not send a content safety email. Email delivery occurs only when the user subscribes to `content_safety_blocked` and the final action is `unreachable`; the notification service still applies subscription, cooldown, and email-address checks. `allow` and `blackhole` matches never dispatch this event.

Incident records support refresh, server-side filtering, sorting, and pagination. Refresh keeps the current filters and page. The table shows the matching rule name, type, and rule ID/pattern summary; AI matches show their AI source. Context is HTML-escaped before the matched fragment is highlighted, and complete request/response payloads are not exposed.

## Rules and export

The rule table supports multi-select editing, enable/disable, and batch observation mode. CSV imports are previewed before application. Overwrite mode updates matches by rule ID or `type + direction + pattern` and never deletes rules outside the CSV.

Users and administrators can export the current scope as JSON policy or CSV rules. Exports do not include API keys, tokens, matched source text, or complete request/response payloads.

## System policy

Administrators with system configuration permission can manage the system baseline, AI channel, default rules, system rules, and all incident records from the System Content Safety page. Existing security verification remains required for system changes.
