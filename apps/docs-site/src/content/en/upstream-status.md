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

## Concurrency status API

In IAM enforcement mode, `GET /v1/relay-config/concurrency-status` uses `quyan:relay:GetConcurrencyStatus` and requires the same active deployment-managed global group eligibility for `UPSTREAM_STATUS_READ`. Its collection resource is `acs:platform:*:platform:relay-concurrency-control/default`.

User records use `acs:platform:*:platform:relay-concurrency-user/<user ID>`; the global image pool uses `acs:platform:*:platform:relay-concurrency-scope/image`. Only permitted records are returned. A selected `userId` must identify an active user and requires an Allow for that user resource; it does not implicitly grant access to the global image pool. Explicit Deny always takes precedence.

Enforcement mode supports `page` and `pageSize`: pages start at 1 and cannot exceed 10000; the default page size is 50 and the maximum is 100. `items` contains the current authorized page, `total` counts all authorized aggregate records, `totals` covers all authorized records, and `hasNext` indicates another page. Legacy and shadow modes retain the original response behavior.

Concurrency data is sampled live; leases that expire during sampling are not counted as active records. An unavailable backend returns 503 rather than successful zero values. Reading does not create configuration. Changes to eligibility, policies, sessions, resource ownership, or configuration during a request cause it to fail.

## Common actions

1. Select **Refresh** to fetch the latest status when investigating an outage.
2. Check the overall indicator, then find the relevant monitor in the category list.
3. Hover over a heartbeat bar to see its status, time, and latency.
4. Use the uptime percentage, heartbeat history, and system logs together to investigate.

## Notes

- A service can be reachable but still degraded because of high latency.
- Upstream latency comes from the corresponding heartbeat. User-to-server latency is measured when the page loads or refreshes; it is not a historical measurement for each heartbeat. A failed measurement displays `N/A`.
- A failed refresh displays an error and may leave the previous overall indicator visible. Use the result of a successful refresh.
- Heartbeat visuals can help identify intermittent failures.
- When users report relay problems, compare this page with relay tokens and system logs.

## Related pages

- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
- [Relay settings]({{DOCS_BASE_URL}}/en/relay-settings)
- [System logs]({{DOCS_BASE_URL}}/en/system-logs)
