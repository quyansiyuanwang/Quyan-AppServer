# Content safety

Content safety is managed from dedicated pages in the AI console instead of being embedded in relay settings.

## User policy

The Content Safety page manages request and response policies, AI audit switches, private rules, and personal enable/disable overrides for system rules. System rules can only be changed through a personal enabled/disabled override; private rules support full editing.

The rule table supports multi-select batch editing, batch enable, and batch disable. CSV imports are previewed before application. Overwrite mode updates matches by rule ID or `type + direction + pattern` and never deletes rules outside the CSV.

## System policy

Administrators with system configuration permission can manage the system baseline, AI channel, default rules, system rules, and redacted incident records from the System Content Safety page. Existing security verification remains required for system changes.

## Export

Users and administrators can export the current scope as JSON policy or CSV rules. Exports do not include API keys, tokens, matched source text, or complete request/response payloads.
