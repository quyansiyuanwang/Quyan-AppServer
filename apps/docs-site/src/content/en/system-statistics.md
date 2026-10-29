# System statistics

System statistics shows the serving instance, application counts, memory, CPU, and infrastructure status. Use it to investigate restarts, resource usage, or Redis issues. The page is read-only and provides no historical charts, alert configuration, or restart action.

## Requirements

Open **System statistics** on the core management site with system-statistics read permission. Reports contain environment, host, and build information. Check screenshots for deployment details before sharing them.

## View and refresh data

1. Open the page and wait for the initial request to complete.
2. Click **Refresh all** for a current report. Desktop cards share one statistics request and cannot be refreshed individually.
3. For continued observation, set **Auto-refresh** to a positive number of seconds. The supported input range is **0–3600 seconds**; the default, 0, disables it.
4. Set the interval to 0 to stop. Leaving the page also stops auto-refresh; reopening starts with it disabled.

Changing the interval restarts the timer. It queries after the next interval rather than refreshing immediately. The auto-refresh indicator establishes only that the timer is enabled, not that the latest request succeeded. Current time and uptime retain the last sampled values between refreshes.

If the first load fails, initial zeroes, blanks, or unavailable indicators may remain. Later refresh failures retain previous values. Click **Refresh all** and check for errors before drawing conclusions. Neither a timer indicator nor a zero value establishes service health or failure.

## Understand the metrics

| Metric                                    | Meaning and use                                                                                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server uptime, start time, uptime seconds | Start and running information for the current service instance. Values change after restarts or instance switches; they are not continuous uptime for the deployment. |
| Current time                              | Server sampling time, displayed in the browser's local time zone. It is not a continuously ticking clock.                                                             |
| User count and group count                | All records across the deployment, without account or active-status filtering. They can include disabled or soft-deleted records and do not count online users.       |
| Permission count                          | The number of permission definitions, rather than permissions held by the operator.                                                                                   |
| Heap used, heap total, heap usage         | Heap memory in the current service process. Usage is used heap divided by allocated heap, rather than host memory utilization.                                        |
| Resident memory (RSS)                     | Memory resident for the service process, with a different scope from heap memory.                                                                                     |
| User and system CPU                       | Cumulative CPU time consumed since the process started, displayed as time rather than CPU utilization. Growth alone does not establish abnormal load.                 |
| Runtime information                       | Node.js, V8, platform, process ID, CPU cores, hostname, operating system memory, and OS uptime. Distinguish host metrics from process metrics.                        |
| Redis status and circuit state            | Redis availability and circuit state recorded by this instance. They do not establish successful health checks for every Redis command or business feature.           |
| Configuration                             | Summaries of environment, listening port, Redis address, CAPTCHA, and token lifetimes for deployment checks. This is not a configuration editor.                      |
| Build information                         | Version, branch, commit, and build times supplied by the serving instance, for identifying a release rather than tracking deployment progress.                        |

With multiple processes or instances, consecutive requests can reach different instances. Check **hostname and process ID** before comparing uptime, memory, or CPU. The report neither aggregates all instances nor stores historical samples.

For Redis, `closed` means the circuit permits operations, `open` means it is tripped, and `half-open` means recovery probing. A healthy individual indicator does not establish end-to-end availability. A database field displaying “—” also does not establish a database connection failure; check request errors and logs.

## Use the mobile view

Mobile accordion sections show server timing, application counts, selected memory metrics, and Redis status, with manual and automatic refresh. Use the desktop view for CPU time, runtime information, configuration, build cards, and other complete details.

## Management permissions

This is a deployment-wide report. With IAM enforcement, an actual platform global user group must provide `SYSTEM_STATS_READ` eligibility, and policies must allow `quyan:system:GetStatistics` on `acs:platform:*:platform:system/stats`.

Account ownership, private account groups, added user permissions, or account policies alone cannot replace platform eligibility. Role sessions use role policies and do not inherit group Allow grants. The management report does not accept OAuth access tokens. Explicit Deny, withdrawn eligibility, disabled accounts, expired or revoked role sessions, or relevant authorization changes during a read can fail the request. Authorization is checked before loading and before returning data. Legacy and shadow modes retain existing permission behavior.

Build information displayed on this page is included in the statistics report and protected by statistics access. **Calling the separate build-information endpoint** additionally requires `DEBUG_ACCESS` and `quyan:system:GetBuildInfo` on `acs:platform:*:platform:system/build-info`. That separate grant does not automatically grant statistics access.

## Investigation tips

| Symptom                                          | Next step                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Uptime suddenly shortens or CPU time decreases   | Compare hostname, process ID, and build version for a restart or instance switch.                          |
| Memory keeps increasing                          | Compare several samples from the same instance and inspect system logs. This page has no historical chart. |
| Redis is unavailable or its circuit is open      | Refresh manually to confirm a valid sample, then inspect server logs and related business requests.        |
| Auto-refresh is enabled but values do not update | Click Refresh all to check for errors, and confirm that the identity and read grant remain valid.          |

Related: [System logs]({{DOCS_BASE_URL}}/en/system-logs), [Error center]({{DOCS_BASE_URL}}/en/error-center), [Consumption statistics]({{DOCS_BASE_URL}}/en/consumption-statistics), and [Upstream status]({{DOCS_BASE_URL}}/en/upstream-status).
