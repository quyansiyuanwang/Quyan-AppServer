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
