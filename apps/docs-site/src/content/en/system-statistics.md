# System statistics

Use this page to monitor runtime health, resource usage, and service summary information.

## Page purpose

- Review current server status.
- Watch uptime and timing metrics.
- Inspect memory, CPU, and infrastructure summaries.
- Refresh metrics manually or through auto-refresh.

## What you will see

### Core metrics

- Server timing and uptime.
- Application-level counters.
- Memory usage.
- CPU usage.

### Environment summary

- Runtime information.
- Redis or infrastructure status.
- Config summary.

### Controls

- Refresh-all button.
- Auto-refresh interval selector.
- Auto-refresh state indicator.

## Common actions

1. Refresh all metrics before comparing values.
2. Enable auto-refresh during active incident observation.
3. Compare memory and CPU trends when performance looks abnormal.
4. Inspect infrastructure summary before escalating service-health issues.

## Notes

- Auto-refresh is useful during incidents but may not be necessary for routine checks.
- A normal uptime value does not always mean all subsystems are healthy.
- Pair this page with logs and consumption statistics for deeper diagnosis.

## Related pages

- `consumption-statistics`
- `system-logs`
- `upstream-status`
