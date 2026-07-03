# User online monitor

Use this page to inspect user online state, session details, and session history, and to force sessions offline when needed. It is mainly useful for operations, support, security troubleshooting, and account-risk handling.

## Page purpose

- Track current online and offline user statistics.
- Filter sessions by username, state, IP, and location.
- Inspect one user's detail view and timeline.
- Force a session or an entire user offline.
- Export session history as CSV or JSON.

## What you will see

### Top statistic cards

The overview area usually includes:

- online users
- offline users
- active sessions
- average session duration

These metrics help you judge whether an issue is isolated or system-wide.

### Filter area

The current page supports filters for:

- keyword
- online status
- IP address
- location

That means you can investigate by person or by source. For example:

- whether a certain user was recently online
- whether one IP is unusually active
- whether one region has a cluster of sessions

### Overview list

The list usually shows:

- username
- name
- current status
- IP address
- location
- started time
- last heartbeat time
- ended time
- session duration

Desktop uses a table layout, while mobile compresses the same information into cards.

### Detail drawer

Clicking view detail opens a user detail drawer. It usually shows:

- current session count
- total session count
- total duration
- latest IP
- latest location
- latest user agent
- latest started, heartbeat, and ended times

This layer is for single-user investigation rather than wide filtering.

### Timeline area

The detail drawer is also split into:

- current online session cards
- historical offline timeline entries

The online cards are better for handling live sessions. The offline timeline is better for historical reconstruction.

## Actions inside the detail view

### Time-range filtering

The detail view supports filtering by date range so you can:

- inspect activity in one time window
- review sessions around an incident
- export only part of the history

### Force one session offline

Each online session card can force one `sessionId` offline.

Typical use cases:

- a suspicious device is still logged in
- one device should be disconnected without touching others
- you want to keep the rest of the user's sessions

### Force one user fully offline

The detail toolbar can also force the entire target user offline.

Typical use cases:

- suspected account compromise
- immediate re-login is required everywhere
- all current sessions must be terminated quickly

### Export session history

The page supports exporting:

- CSV
- JSON

The export usually includes:

- `sessionId`
- `authSessionId`
- started, heartbeat, and ended times
- duration
- IP, location, and user agent
- online state

## Risk notes for force-offline actions

Force-offline is a high-impact action and should be used carefully.

Important behavior:

- forcing one session offline only affects that session
- forcing a user offline affects all active sessions for that user
- if the action hits the operator's current session, the operator will also be logged out

That means you should confirm whether the target user is yourself, or whether the current browser session is part of the affected set.

## Common actions

1. Check the top metrics to see whether the issue is isolated or broad.
2. Filter by keyword, status, IP, or location.
3. Open the target user's detail drawer.
4. Use online cards and offline timeline entries to scope the issue.
5. Force one session offline when the rest of the user's access should remain.
6. Force the whole user offline when a full reset is needed.
7. Export CSV or JSON when you need records for analysis or handoff.

## Permission requirements

This page usually involves:

- `user_online_monitor:read`
- `user_online_monitor:force_offline`

Specifically:

- `user_online_monitor:read` is needed for overview, detail, and timeline access
- `user_online_monitor:force_offline` is needed for force-offline actions

With read-only permission, users can typically inspect data but not terminate sessions.

## Notes

- Online state is driven by heartbeat data and does not always mean the user is actively clicking right now.
- The detail timeline is best for single-user analysis; broader trends should still be compared with statistics and logs.
- JSON export is better for programmatic processing, while CSV is better for spreadsheet review.

## Related pages

- [`system-statistics`](/en/system-statistics)
- [`system-logs`](/en/system-logs)
- [`business-logs`](/en/business-logs)
- [`ip-monitoring-dashboard`](/en/ip-monitoring-dashboard)
