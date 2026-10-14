# Upstream status

Use this page to review the health and availability of upstream services.

## Page purpose

- Check whether upstream services are fully available.
- Inspect heartbeat history and latency indicators.
- Identify partial outages or degraded routing.

## What you will see

### Overall status

- All-up or some-down indicator.
- Error alert area.
- Empty state when no monitors are available.

### Monitor list

- Category-grouped upstream monitors.
- Uptime percentage badges.
- Heartbeat bars over time.
- Tooltips for upstream and user-to-server latency.

## Access and resource scope

In IAM enforcement mode, the page uses `quyan:relay:GetUptimeStatus`. The authenticated subject must belong to an active deployment-managed global group with `UPSTREAM_STATUS_READ`. A personal addition, a private group, or account-owner identity does not replace that eligibility. The collection requires an Allow for `acs:platform:*:platform:relay-uptime-control/default`.

Individual monitors use `acs:platform:*:platform:relay-uptime-monitor/<monitor ID>`. Only permitted monitors and categories containing them are returned. A matching Deny overrides Allow; an overall indicator therefore describes your visible monitors, not every upstream service. An empty list can mean no configured monitors or no permitted monitor records.

Provider monitor IDs remain unchanged. Legacy static monitors without IDs receive a deterministic `static_<SHA-256>` ID derived from the category and monitor names; renaming either changes that resource ID. Explicit IDs must contain letters, numbers, dots, underscores, or hyphens, begin with a letter or number, and be at most 200 characters. Duplicate or unsafe IDs are rejected. Use the returned ID when writing a resource-specific policy.

Reading status does not create configuration. The configured upstream is preferred; a configured static category can provide fallback when that upstream is unavailable. Heartbeat history is limited to the latest 100 entries. Changed qualifications, policies, role sessions, configuration snapshots, or expired contributing grants cause the request to fail rather than release stale data. Storage failure is not reported as a successful empty result. The status Action does not grant configuration editing or model pricing access.

## Common actions

1. Refresh the page when investigating a current outage.
2. Look at the overall indicator first.
3. Open the affected category and inspect heartbeat bars.
4. Compare latency and uptime trends before escalating.

## Notes

- A service can be reachable but still degraded because of high latency.
- Heartbeat visuals are best for spotting intermittent failures.
- When users report relay problems, compare this page with relay tokens and system logs.

## Related pages

- `relay-token-management`
- `relay-settings`
- `system-logs`
