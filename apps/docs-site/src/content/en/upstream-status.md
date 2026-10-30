# Upstream status

Open **Upstream Status** in the AI management site to review configured monitors, uptime percentages and recent heartbeats when investigating relay failures. This page is read-only; it does not add monitors, switch channels or change concurrency limits.

## Before you begin

You need upstream-status read permission, and an administrator must configure a monitoring source or static data in [Relay settings]({{DOCS_BASE_URL}}/en/relay-settings). The page covers only configured, authorized monitors, rather than the live availability of every channel or model.

IAM enforcement also requires deployment-managed global group eligibility and resource grants, described below. If the page is unavailable, ask an administrator to check access.

## Check the latest status

1. Open **Upstream Status** and wait for loading to finish. The page measures your current user-to-server latency before loading monitor data.
2. Check the overall indicator, then locate the relevant monitor within its category.
3. Hover over a heartbeat bar to inspect that sample's normal or abnormal state, timestamp and latency. On narrow screens, the heartbeat area can scroll horizontally.
4. Select **Refresh** while investigating. Data loads on entry and manual refresh; the page does not poll automatically.

“All services are running normally” means all visible monitors currently report normal status. “Some services are experiencing issues” means at least one visible monitor is not normal. The indicator does not use uptime percentages and does not guarantee that your specific relay request will succeed.

## Understand the indicators

| Indicator              | Meaning and limits                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall status         | Aggregates visible monitors' current states. With a monitoring source, each state comes from its latest heartbeat; missing heartbeats count as abnormal          |
| Uptime                 | The source's last-24-hour ratio, or the configured value for static data. It is not the current state                                                            |
| Uptime badge color     | Green at 95% or more, warning at 80% to below 95%, and red below 80%                                                                                             |
| Heartbeat bars         | Green means that sample was normal; red means abnormal. At most 100 recent samples appear. The source's sampling interval determines the time span               |
| Upstream latency       | Latency recorded for that heartbeat, rather than the entire browser-to-model request duration                                                                    |
| User-to-server latency | One measurement from the current page load or refresh, shared across historical heartbeat tooltips. It is not historical network latency; failure displays `N/A` |

The right-hand “Now” label is a chart label. Use the tooltip timestamp to judge freshness: the latest heartbeat can already be old, and historical success does not establish current availability. Missing uptime data can appear as 0%; check heartbeats and the monitoring source.

### Static fallback data

When a monitoring source is configured, the system tries it first. If it fails and static data is configured, that data provides a fallback. Static data can also be used on its own.

The page does not identify fallback mode. A successful refresh means displayable data was obtained; static states, uptime and heartbeats may not describe the current service. Ask an administrator to check the source and data timestamps when you need a live assessment.

## Investigate problems

| Symptom                                          | Next step                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Overall status is abnormal                       | Locate the affected monitor, check its latest heartbeat time and latency, then compare actual request errors                    |
| High uptime but current failure                  | Uptime is historical; use the latest valid heartbeat and actual requests to assess the present state                            |
| Overall status is normal but relay requests fail | Check the request's model, token, quota and channel, then review [AI request logs]({{DOCS_BASE_URL}}/en/ai-request-logs)        |
| Error or failed refresh                          | Check connectivity, access and monitor configuration, then retry. An old overall indicator may remain and is not a fresh result |
| Successful load with no monitors                 | Monitors may be unavailable to you or excluded by “show only configured” filtering; ask an administrator to check               |
| Old heartbeats or `N/A` latency                  | Check the source's update time. Missing latency is not zero and does not independently prove health or failure                  |

Without any usable data source, loading can display an error rather than a normal empty list. That does not establish that an upstream recovered.

## Access and resource scope

Legacy permission mode requires `UPSTREAM_STATUS_READ`. IAM enforcement uses `quyan:relay:GetUptimeStatus` and additionally requires membership in an active deployment-managed global group with `UPSTREAM_STATUS_READ`. Personal additions, private groups and account-owner identity cannot replace that eligibility. The endpoint uses a signed-in identity and does not accept OAuth access tokens.

| Authorization target | Resource                                                    |
| -------------------- | ----------------------------------------------------------- |
| Monitor collection   | `acs:platform:*:platform:relay-uptime-control/default`      |
| Specific monitor     | `acs:platform:*:platform:relay-uptime-monitor/<monitor ID>` |

Collection authorization happens before monitor filtering. Only authorized monitors and their categories are returned. Explicit Deny overrides Allow, so the overall indicator also covers only visible monitors. This Action does not grant relay configuration editing, model pricing or concurrency-status access.

Administrators should use returned monitor IDs in resource-specific policies. Source-provided IDs remain unchanged. Legacy static monitors without explicit IDs receive a `static_<SHA-256>` ID derived from category and monitor names; renaming either changes the resource identity. Explicit IDs must start with a letter or number, contain only letters, numbers, dots, underscores or hyphens, and be at most 200 characters. Duplicate or unsafe IDs are rejected.

Reading does not create configuration. Changes to eligibility, policies, valid role sessions, configuration or authorization conditions during a request can cause failure; refresh and retry. Storage failure is not returned as a successful empty list.

## Administrators and API users: read concurrency status

`GET /v1/relay-config/concurrency-status` samples current concurrency and queue state. **The Upstream Status page does not display these records.** The endpoint uses the separate Action `quyan:relay:GetConcurrencyStatus` and requires a signed-in identity. IAM enforcement requires the same active deployment-managed global group eligibility for `UPSTREAM_STATUS_READ`.

| Authorization target          | Resource                                                    |
| ----------------------------- | ----------------------------------------------------------- |
| Concurrency collection        | `acs:platform:*:platform:relay-concurrency-control/default` |
| A user's ordinary concurrency | `acs:platform:*:platform:relay-concurrency-user/<user ID>`  |
| Global image concurrency pool | `acs:platform:*:platform:relay-concurrency-scope/image`     |

Only authorized records are returned. A selected `userId` must identify an active user whose resource is authorized. It does not automatically grant image-pool access. The pool is authorized separately, so an authorized global image-pool record can accompany a selected user's records. Explicit Deny takes precedence.

IAM enforcement supports this pagination:

- `page` starts at 1 and is at most 10000. `pageSize` defaults to 50 and is at most 100.
- `items` contains this page's authorized aggregate records. `total` counts all authorized aggregate records, not requests.
- `totals` covers all authorized records, not just this page. `hasNext` indicates another page.
- Legacy and shadow modes retain their original response behavior; do not assume they paginate with these fields.

Leases that expire during sampling are excluded from active counts, and traffic can change between page requests. An unavailable concurrency backend returns 503 rather than successful zero values. Reading does not create configuration. Changes to eligibility, policies, sessions, user ownership or configuration during a request can cause failure.

## Related pages

- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
- [Relay settings]({{DOCS_BASE_URL}}/en/relay-settings)
- [AI request logs]({{DOCS_BASE_URL}}/en/ai-request-logs)
- [System logs]({{DOCS_BASE_URL}}/en/system-logs)
