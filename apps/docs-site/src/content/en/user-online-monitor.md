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

If loading details fails, the drawer may still show the previously viewed user and sessions. Close the drawer and reopen the intended user’s details. Before forcing a session offline or exporting, make sure the load succeeds and the username in the title is correct. Timeline filtering or pagination can also leave old records visible if loading fails; reload before drawing conclusions.

### Timeline area

The detail drawer is also split into:

- current online session cards
- historical offline timeline entries

The online cards are better for handling live sessions. The offline timeline is better for historical reconstruction. Both groups split the current timeline page only; they do not represent all sessions for the user. Check other pages for additional records.

## Actions inside the detail view

### Time-range filtering

The detail view supports filtering by date range so you can:

- inspect activity in one time window
- review sessions around an incident
- export only part of the history

When reopening details, the date control may retain the previous selection, but the initial timeline load does not apply it. Select the range again or clear it, and wait for the list to update before reviewing. Export uses the range currently shown in the control.

### Force one session offline

Each online session card can force one `sessionId` offline.

Typical use cases:

- a suspicious device is still logged in
- the authentication session associated with an entry needs to be revoked

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

Export requests all matching timeline pages for the selected date range, not just the visible page. JSON also includes user details, the selected range, and export time. The file contains sensitive data such as IP addresses and device information; store it securely.

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

- forcing one session offline closes the selected record and revokes its associated authentication session; other connections sharing that authentication session may also be affected
- forcing a user offline affects all active sessions for that user
- if the action hits the operator's current session, the operator will also be logged out

That means you should confirm whether the target user is yourself, or whether the current browser session is part of the affected set.

## Common actions

1. Check the top metrics to see whether the issue is isolated or broad.
2. Filter by keyword, status, IP, or location.
3. Open the target user's detail drawer.
4. Use online cards and offline timeline entries to scope the issue.
5. To limit the scope, select the target session and check which authentication session may be affected.
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

- [System statistics]({{DOCS_BASE_URL}}/en/system-statistics)
- [System logs]({{DOCS_BASE_URL}}/en/system-logs)
- [Business logs]({{DOCS_BASE_URL}}/en/business-logs)
- [IP monitoring]({{DOCS_BASE_URL}}/en/ip-monitoring-dashboard)
