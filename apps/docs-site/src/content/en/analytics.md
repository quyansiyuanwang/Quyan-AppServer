# Analytics

Analytics provides overview, funnel, and heatmap reports for collected site events. Results reflect data successfully delivered and still retained, rather than complete access logs, verified people counts, or billing records.

## Prerequisites

Open the relevant analytics page in the management site with `ANALYTICS_READ`. IAM enforcement also requires eligibility from a real deployment-wide group and the separate report grants below.

Data depends on browser collection and successful delivery. Uninitialized collection, pages without matching events, network failures, or deleted history can leave results empty or incomplete. Refreshing queries saved data without collecting past events retroactively. These pages provide no global tracking switch or backfill action.

## Review the overview

1. Open the overview and wait for the default last-30-days report.
2. Choose Today, 7, 30, or 90 days to query immediately.
3. After choosing custom dates, select Refresh; changing custom dates alone does not update charts.
4. Check totals before comparing daily trends, popular events, and page rankings.

Today runs from browser local midnight to now. Other shortcuts count backward from the current time rather than selecting whole calendar days. A custom end date is normally midnight and is not extended to the end of the day. To include a full target day, select the following day, noting that its midnight can also be included. Queries filter by server receipt time; daily buckets use database dates. Timezones and reporting delays can affect date comparisons.

| Page metric                 | Actual meaning                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Total PV, page PV, PV trend | Events in the current query, including page views, clicks, and other collected events; not only `page_view` |
| Distinct sessions (UV)      | Distinct session IDs, not accounts or verified people                                                       |
| Active pages                | Distinct page paths with events in the query                                                                |
| Popular events Top10        | The ten most frequent event names in the period, not a complete event directory                             |

The overview has no event-type, user, or page-path controls. An authorized integration can supply `page` or `eventType` to `POST /v1/track/stats` when a specific page or event type is needed. This remains a deployment-level reporting API.

Paths normally omit hostnames, query strings, and fragments. Identical paths across sites in the same deployment can merge. Page rankings therefore do not prove traffic for one specific domain.

## Analyze a funnel

1. Open Funnel and enter at least two nonempty event names.
2. Add, remove, or reorder steps to match the business sequence, then choose dates. The default is the last seven days.
3. Choose Analyze and check session counts and rates in the table.
4. Analyze again after changing steps or dates. Funnel definitions are not saved when leaving the page.

Names are trimmed and matched exactly, including case. Blank steps are ignored; fewer than two valid steps does not submit a query. Suggestions are only the top ten popular events from the last 90 days. Missing suggestions do not prove an event never occurred; type a known event name manually. Suggestions require overview-report access, so a caller with only funnel access may still enter names and analyze.

Steps match within one session in **server receipt order**, allowing other events between them. The funnel neither joins separate sessions nor reorders events by client click time. Batching and delays can affect ordering, and events in one batch can share a receipt timestamp.

Counts labeled Users are sessions that reached each step. Each rate is relative to the preceding step. The first always displays 100%, even with zero sessions; check counts before interpreting percentages. Repeating an event name requires repeated occurrences in the session rather than counting one occurrence twice.

## Query a heatmap

1. Open Heatmap and select or enter a collected page path, such as `/your-page`.
2. Select dates and either clicks or scroll stops. Defaults are the last seven days and clicks.
3. Choose Query and wait for success before interpreting points.
4. Query again after changing the path, dates, or type.

Page suggestions come from overview data for the last 90 days and do not establish that heatmap data exists. Suggestions need overview-report access; enter a known path manually if choices are empty. Paths match collected values exactly. A full URL or an address with query parameters may not match.

The background loads the current page in a frame rather than showing a historical screenshot. Relative paths open on the current management-site domain without automatically locating the original site. Identical paths across sites, login state, page versions, and embedding restrictions can change or block the background. A failed background does not establish a failed data query.

**Changing the path switches the background immediately, while points update only after a successful query.** Failed queries can leave old points over a new background. Verify criteria and successful loading before using the result. The background is a display; business operations cannot be performed inside the frame.

Nearby proportional coordinates are grouped, returning at most the 2,000 locations with the highest counts. The footer counts returned locations rather than clicks or sessions. Red intensity is relative to the current result and cannot directly compare absolute traffic across queries.

Click coordinates use the original viewport proportions; scroll stops use the page-height proportion and viewport center. The preview scales a desktop-width page. Original device size, scrolling, and layout changes can misalign points and elements. Scroll stops do not establish complete reading duration or actual attention.

## IAM report authorization

The three query APIs use login authentication and do not accept third-party OAuth access tokens. IAM enforcement requires `ANALYTICS_READ` eligibility from a real deployment-wide group, plus the corresponding action and resource:

| API                      | IAM action                              | Resource ARN                                     |
| ------------------------ | --------------------------------------- | ------------------------------------------------ |
| `POST /v1/track/stats`   | `quyan:analytics:GetTrackingStatistics` | `acs:platform:*:platform:system/tracking-stats`  |
| `POST /v1/track/funnel`  | `quyan:analytics:GetFunnelStatistics`   | `acs:platform:*:platform:system/tracking-funnel` |
| `POST /v1/heatmap/query` | `quyan:analytics:GetHeatmap`            | `acs:platform:*:platform:system/heatmap-stats`   |

Dates, paths, and events filter data without limiting authorization to a user or page resource. Account policies or individual additions cannot replace group eligibility. Matching Deny takes priority; role sessions use role grants. Identity, eligibility, policy, or session invalidation during a read rejects the entire result. Public collection and protected reporting are separate operations; being able to submit data does not grant report access.

## Troubleshooting

| Symptom                                           | What to do                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Custom dates change without overview updates      | Choose Refresh; custom dates and shortcuts trigger queries differently                       |
| PV exceeds expected page views                    | The page includes all matched events; filter by event type for view-only queries             |
| Funnel or page suggestions are empty              | Check overview grants and last-90-days data, or enter exact known names or paths             |
| The first funnel step shows 100% with zero users  | The fixed initial rate does not establish conversion. Check names, dates, and collection     |
| The background loads without points               | Check collection, exact path, type, dates, and successful querying                           |
| Points do not align with elements                 | Check the site, layout version, device size, and scroll position                             |
| Old charts or initial zeros remain after an error | Retained results or defaults do not establish no data under new criteria. Retry successfully |

There is no automatic refresh, export, saved funnel, or historical page-screenshot feature. Event and heatmap retention follows deployment data-lifecycle configuration.

## Related pages

- [Data lifecycle]({{DOCS_BASE_URL}}/en/data-lifecycle)
- [Server configuration]({{DOCS_BASE_URL}}/en/server-configuration)
- [Debug]({{DOCS_BASE_URL}}/en/debug-tools)
