# System statistics

Use this page to monitor runtime health, resource usage, and service summary information.

## Management permissions

System statistics are a deployment-wide report. With IAM enforcement, you need `SYSTEM_STATS_READ` in an actual deployment administrator group and `quyan:system:GetStatistics` on `acs:platform:*:platform:system/stats`. Build information separately requires `DEBUG_ACCESS` and `quyan:system:GetBuildInfo` on `acs:platform:*:platform:system/build-info`. Ordinary account owners and account policies cannot grant deployment administrator eligibility.

Authorization is checked before loading data and before returning it. Explicit Deny, removal of the deployment grant, disabled accounts, or revoked role sessions prevent the report from being returned.

## Page purpose

- Review current server status.
- Watch uptime and timing metrics.
- Inspect memory, CPU, and infrastructure summaries.
- Refresh metrics manually or through auto-refresh.

## What you will see

### Core metrics

- Server timing and uptime.
- Application-level counters.
- Memory used by the service process.
- Cumulative CPU time spent by the service process in user and system modes.

### Environment summary

- Runtime information.
- Redis or infrastructure status.
- Config summary.

### Controls

- Refresh-all button.
- Auto-refresh interval input.
- Auto-refresh state indicator.

## Common actions

1. Use **Refresh all** to fetch current data.
2. To keep observing, enter an auto-refresh interval in seconds (0–3600). The default is 0, which disables auto-refresh. Auto-refresh stops when you leave the page.
3. When investigating resource issues, record memory and CPU values at different times and inspect the infrastructure summary.

## Notes

- CPU values are cumulative time consumed since the process started, not CPU utilization; an increasing value alone does not indicate abnormal load. Memory metrics also describe the service process; operating system memory is shown separately in runtime information. In a multi-process deployment, different requests may be handled by different processes, so check the process ID when comparing values.
- If an automatic refresh fails, the page may retain the previous values. The auto-refresh indicator does not guarantee a successful update. To confirm, refresh manually and look for an error message.
- The mobile view shows less information than the desktop view.
- A normal uptime value does not always mean all subsystems are healthy.
- Pair this page with logs and consumption statistics for deeper diagnosis.

## Related pages

- [Consumption statistics]({{DOCS_BASE_URL}}/en/consumption-statistics)
- [System logs]({{DOCS_BASE_URL}}/en/system-logs)
- [Upstream status]({{DOCS_BASE_URL}}/en/upstream-status)
