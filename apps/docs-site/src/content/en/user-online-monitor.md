# User online monitor

Use the online monitor to find sessions, inspect a user's timeline, export records, and force sessions offline when needed. Online state comes from heartbeats; it does not establish that a user is currently interacting or provide an audit of every login.

## Requirements

- Open **User online monitor** on the core management site with `user_online_monitor:read`. Force-offline actions separately require `user_online_monitor:force_offline`. IAM enforcement also checks the action and resource scope.
- Use desktop for details, export, or force-offline actions. Mobile supports overview and filters; its view-detail button currently does not display a detail drawer.
- Sessions contain IP addresses, locations, and User-Agent information. Share only with authorized people and protect downloaded files.

## Find sessions

1. Enter a keyword, IP, or location, or select an online status. Committing a text change runs the query; status changes query immediately. Both return to page one.
2. Keywords match text in user IDs, usernames, or names. IP and location are also text matches, rather than subnet matching or map-area filters.
3. Review the target session and click **View detail** on desktop.

**Each overview row represents a session.** One user can appear in several rows and have online and offline records simultaneously. IP and location reflect the last values recorded for that session, rather than a complete history of IP changes. IP geolocation does not establish a user's exact position.

The default is 20 rows per page. Desktop supports page-size changes; mobile has no page-size selector. Clear individual inputs or status to remove filters. The top **Refresh** reloads the current page with current filters and updates overview metrics, without refreshing open details. The page has no automatic polling.

Failed requests can retain previous rows and statistics, or initial zeroes on the first failure. Check the error and refresh successfully before judging current state.

## Understand online state and statistics

Heartbeat intervals and timeout thresholds follow current server configuration. Network loss, browser background scheduling, or failed heartbeat requests can make a session appear offline. End times can also be inferred from heartbeat timeout or assigned by later cleanup; they are not exact browser-close times.

With IAM enforcement, overview statistics use authorized active session records in the current account:

| Metric                   | Scope                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Online users             | Distinct users with at least one visible online session.                                                                          |
| Offline users            | Users with visible sessions but no visible online session; this does not include every registered user without a visible session. |
| Active sessions          | All authorized online sessions, rather than distinct users.                                                                       |
| Average session duration | Average duration of sessions on the **current page** of filtered results. Changing pages or page size can change it.              |
| List total               | Matching authorized sessions, rather than distinct users.                                                                         |

The first three metrics do not narrow with ordinary keyword, IP, or location filters. Average duration and list totals depend on filters or pagination. Mobile shows only online users and active sessions.

Legacy and shadow modes retain their earlier calculation: the value labeled Online users actually counts online sessions and equals Active sessions. Offline users is all user records minus that value, with a minimum of zero. When Online status is selected, the online count also follows the current query filters. Do not use these values to calculate an accurate user online rate.

## Inspect user details and the timeline

1. Open details on desktop. Confirm that loading succeeds and the title names the intended user.
2. Review current sessions, total sessions, total duration, and the latest session's IP, location, User-Agent, and times.
3. Select a date-time range if needed. It filters by **session start time**, including the boundaries, rather than heartbeat time, end time, or overlap with the interval.
4. Page through current online cards and historical offline entries.

The timeline defaults to 10 rows per page, with 20 or 50 also available, ordered by start time newest first. Online cards and offline entries partition only the **current timeline page**. An empty section does not establish that the user has no other online or historical sessions; check other pages.

The summary above the timeline does not change with date filters. Total duration sums saved session durations, without continuously adding elapsed time for unfinished sessions. It is not actual presence time deduplicated across simultaneous sessions. With IAM enforcement, the user summary can aggregate all active records for that user while the timeline includes only authorized sessions, so their counts can differ.

Reopening details can retain a previous date selection even though the initial timeline request does not apply that range. Select the range again or clear it, and wait for a successful query before reviewing or exporting. Export always uses the range currently shown in the control.

**Failed detail loads can leave the previously viewed user and sessions visible.** Close and reopen the intended user, and confirm successful loading and the correct title before forcing sessions offline or exporting. Failed filters or pagination can also leave an old timeline. Close and reopen for current details; the top Refresh updates only the overview.

## Force sessions offline

### End one session

Click force offline on the target online card, check the confirmation, and submit. This closes the selected record and revokes its associated authentication session. Other pages or connections sharing that authentication session can also be affected; the scope can exceed one card.

### End all sessions for a user

Click force user offline in the detail toolbar, check the username, and confirm. It affects all current sessions for that user, beyond the current timeline page, date range, or visible records. The button is unavailable when the summary shows the user as offline.

After success, details and the overview reload. If the operator's current authentication session or user is affected, the current page signs out too. The action does not delete history or prevent a later new sign-in.

Enforcement relies on subsequent server authentication and heartbeat checks; all client screens are not guaranteed to close simultaneously. With IAM enforcement, failure to reliably save revocation markers fails the operation. After network or refresh errors, query the target again before repeating an action against old cards.

## Export session records

1. Confirm that details loaded and check the username in the title.
2. Select the range again or clear it, and confirm that the timeline query succeeds.
3. Choose **CSV** or **JSON** from the export menu and wait for the browser download.

Export requests every matching timeline page in the selected range, rather than just the current page. Fields include `sessionId`, `authSessionId`, start, heartbeat and end times, duration in seconds and formatted duration, IP, location, User-Agent, and online state. JSON also includes the user summary, range, and export time. Its summary is not recalculated for the selected date range.

Files use the ISO date-time values supplied by the API, while the interface displays browser-local times. Sessions can change between page requests, so export is not a single-moment snapshot. Retry the complete export after any page fails. Narrow the date range if it includes too many records.

## IAM authorization

With IAM enforcement, operations are limited to active users and session records in the current account. Overview and timeline results are authorized per session before filtering and pagination.

| Task                        | Required action                    | Resource                                                           |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| Browse overview             | `quyan:user:ListOnlineSessions`    | `acs:quyan:*:<accountOwnerId>:online-session/<userId>/<sessionId>` |
| Read a user summary         | `quyan:user:GetOnlineUser`         | `acs:quyan:*:<accountOwnerId>:user/<userId>`                       |
| Read timeline or export     | `quyan:user:GetOnlineUserTimeline` | Each session's `online-session` resource.                          |
| End one session             | `quyan:user:ForceOfflineSession`   | The target `online-session` resource.                              |
| End all sessions for a user | `quyan:user:ForceOfflineUser`      | The target `user` resource.                                        |

These actions are independent. The page loads the user summary and timeline together, so opening details requires both read grants. Export reuses timeline reading. Visible buttons do not establish backend authorization. Role sessions must satisfy role policies; matching explicit Deny takes precedence. Query again after access or session invalidation.

Delegated subaccounts cannot force the account owner or the owner's sessions offline, even with a matching policy grant. The owner can act on their own sessions. Cross-account, invalid-target, or invalid-identity operations are rejected. Force-offline actions still require replay protection. Read access does not grant termination rights. Legacy and shadow modes retain existing permissions and behavior.

## Related pages

- [System statistics]({{DOCS_BASE_URL}}/en/system-statistics)
- [System logs]({{DOCS_BASE_URL}}/en/system-logs)
- [Business operation logs]({{DOCS_BASE_URL}}/en/business-logs)
- [IP monitoring dashboard]({{DOCS_BASE_URL}}/en/ip-monitoring-dashboard)
