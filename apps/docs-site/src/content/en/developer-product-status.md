# Status Monitoring

Status Monitoring periodically checks public HTTP(S) services and exposes a public status page. It is suited to API, website, and dependency availability and latency, not a replacement for full application performance monitoring or log analytics.

## Configure monitors

Set a name, HTTP(S) target URL, method, interval, accepted status codes, and an alert delay (1 to 1,440 minutes; 5 minutes by default) in the Console. The interval must be between 60 and 86,400 seconds. Requests pass SSRF protection: only HTTP(S) is allowed, private, loopback, and link-local targets are rejected. Status checks follow up to five HTTP redirects, validating every destination again, and reject redirect loops and non-HTTP schemes such as `file://`.

Check records include status code, latency, and a sanitized error summary. A target can be paused, resumed, or checked manually; a manual check only affects the selected row. A subsequent check triggers one outage notification after the detected outage has lasted for the configured delay. A recovery notification is sent only if an outage notification was previously sent. Notifications use the platform notification/webhook system and existing notification preferences.

## Public status page

After publication, the page is available at `/status/{slug}` and shows enabled monitors’ current state, recent latency, status code, and recent check history. Availability is the proportion of successful results among the latest 30 checks at most, not time-based uptime; the page displays 0% when there are no checks. Turning publication off removes public access; disabling the product or instance also makes the page unavailable. Publishing has its own RAM action, separate from monitor read, write, and delete actions.

## Monitor resource authorization

In IAM enforce mode, JWT management uses this product's Actions and resources, not Aliyun DNS permissions. A monitor ARN is `acs:developer:*:<accountId>:status-monitor/<projectId>/<monitorId>`. Identifiers must exactly match the stored resource; accountId comes from authentication context.

- `quyan:developer:CreateStatusMonitor`: authorizes creation on the specified project ARN, without automatically granting management of the new monitor.
- `quyan:developer:ListStatusMonitors`: controls each monitor's configuration and status visibility. Configuration can include request payloads; review sensitive contents before granting access.
- `quyan:developer:UpdateStatusMonitor` and `DeleteStatusMonitor`: independently control modification and deletion of a specific monitor.
- `quyan:developer:CheckStatusMonitor`: separately authorizes a manual outbound HTTP check. Listing or modification does not imply this capability.

`GET /v1/developer/projects/{projectId}/monitors/page` accepts page/pageSize and returns items, page, pageSize, and hasNext. Candidates are limited to an active same-account project before per-item evaluation. Responses include resourceArn for policy authoring, without an unauthorized total. Empty pages can have a next page; the old array endpoint returns only the default first page in enforce.

Same-account identities can receive authority on one monitor, and resource groups can contain individual monitors. Removing a member changes scope on the next request. Foreign accounts, wrong projects, case aliases, and inactive resources are rejected; paused monitors remain manageable. Manual checks retain SSRF and per-redirect destination validation and recheck resource availability before dispatch and result persistence. Public status pages, scheduled checks, and product credentials retain their own access boundaries; legacy/shadow keep individual project ownership constraints.
