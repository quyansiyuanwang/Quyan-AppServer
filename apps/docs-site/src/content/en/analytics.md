# Analytics

Analytics provides overview, funnel, and heatmap views of collected site events. Results depend on tracking being enabled and users producing matching events.

## Overview

Choose a time range and refresh to see page event totals, distinct sessions (labeled UV on the page), active pages, daily trends, popular events, and page rankings. UV is deduplicated by session ID, not by account. The page offers today, 7-, 30-, and 90-day shortcuts and custom dates; it has no event-type or page-path filter controls.

## Funnel

1. Enter at least two event names, adding, removing, or reordering steps as needed.
2. Choose a time range and select **Analyze**.
3. Review the session count and conversion rate for each step. The system matches events in sequence within each session; each rate is relative to the previous step, with the first shown as 100%.

The page labels the counts as users, but they are sessions rather than distinct accounts. Funnel definitions cannot be saved on this page and must be entered again after leaving. Select **Analyze** again after changing steps or the time range. If a query fails, the page may still show the last successful result.

## Heatmap

Select or enter a page path, a time range, and either clicks or scroll stops, then select **Query**. The page loads the target in an embedded frame and overlays heat points; stronger red indicates greater relative density. The background may not appear if the target cannot be embedded or loaded, and no points appear without matching collected data. Changing the path immediately changes the background, but points update only after another successful query. A failed query may leave the previous points visible; do not treat them as results for the new criteria.

## Permission requirements

Viewing these reports requires `ANALYTICS_READ`; IAM enforcement also requires the separate grants below.

## IAM report authorization

The JWT query APIs require `ANALYTICS_READ`. With IAM enforcement, this eligibility must come from an actual deployment-wide group. The three reports have separate actions and resources:

| API                      | IAM action                              | Resource ARN                                     |
| ------------------------ | --------------------------------------- | ------------------------------------------------ |
| `POST /v1/track/stats`   | `quyan:analytics:GetTrackingStatistics` | `acs:platform:*:platform:system/tracking-stats`  |
| `POST /v1/track/funnel`  | `quyan:analytics:GetFunnelStatistics`   | `acs:platform:*:platform:system/tracking-funnel` |
| `POST /v1/heatmap/query` | `quyan:analytics:GetHeatmap`            | `acs:platform:*:platform:system/heatmap-stats`   |

These are deployment-level aggregate reports. Date, page and event filters select report data; they do not restrict authorization to that page or turn the report into an account-scoped resource. Account policies cannot grant deployment-wide eligibility. A matching Deny overrides Allow, and results are withheld if eligibility, policies or the current role session become invalid during a read. AssumeRole uses its own role grants. The anonymous collection endpoints retain their existing collection behavior.

## Notes

- Results depend on collected events and can be empty when tracking is disabled or there is no matching data. Retry failed queries and use the successfully returned results.
- Page paths, time ranges, and event names select report data; they do not change the authorization scope.

## Related pages

- [Server configuration]({{DOCS_BASE_URL}}/en/server-configuration)
- [Debug]({{DOCS_BASE_URL}}/en/debug-tools)
