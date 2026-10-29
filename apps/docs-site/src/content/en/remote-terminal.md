# Remote terminal

Use this page to connect to and operate registered remote devices.

## Page purpose

Signed-in users can open the workspace. Devices, session history, and quota information load independently. An unavailable section shows its own notice while other permitted features remain usable. Unavailable quota information is not displayed as zero; connection requests still require server-side session authorization, entitlement, and quota checks. Opening the workspace grants no device or session permissions.

- View registered devices and their online status.
- Start a terminal session by selecting a device and shell type.
- Manage multiple terminal tabs in a single view.
- Browse the remote device's directory tree.

## What you will see

### Device list

The left sidebar shows devices bound to the current user with an active entitlement. When IAM enforcement is enabled, it lists only devices you are allowed to view. Each card shows:

- Hostname, platform, and architecture (e.g. `linux/amd64`).
- Online / offline status tag.
- Last-seen timestamp.

### Quota panel

- **Terminal quota**: active sessions / total terminal limit.
- **Device quota**: active devices / total device limit.

When the terminal session quota is reached, the connect button is disabled with an explanation. It is also unavailable when no online device is selected or a connection is in progress. The device quota limits bound devices; the server still checks each connection.

### Terminal area

The main area is a multi-tab terminal. Each tab maps to one device session and supports:

- Shell-type selection (bash / sh / powershell, etc., depending on the agent).
- Connect, disconnect, and reconnect actions.
- Full xterm.js experience (colors, cursor, scroll history).
- Right-click copies selected text, or attempts to paste from the clipboard when nothing is selected. Connect the terminal before pasting; a disconnected paste is not queued for reconnection.

## Common actions

1. Click a device card to select it.
2. Choose the shell type from the dropdown.
3. Click connect and wait for the session to open.
4. Type commands normally in the terminal.
5. Open a new tab to work on a different device at the same time.

## Notes

- A device only appears after it has been registered using a registration token. Tokens are managed on the "My remote terminal plans" page.
- Sessions use WebSocket; you can reconnect manually or automatically after a network drop.
- The number of concurrent terminals is capped by your entitlement. Purchase a plan or ask an admin to assign one if you need more capacity.

## Device-scoped authorization

When IAM enforcement is enabled, device listing, probing, directory browsing, and preference operations use separate Actions:

| Operation          | Action                                      | Resource                             |
| ------------------ | ------------------------------------------- | ------------------------------------ |
| List devices       | `quyan:remote_terminal:ListDevices`         | Each device is filtered individually |
| Browse directories | `quyan:remote_terminal:BrowseDirectories`   | Selected device                      |
| Read preferences   | `quyan:remote_terminal:GetAgentPreferences` | Selected device                      |

Device ARNs use `acs:remote-terminal:*:<accountId>:device/<userId>/<deviceId>`. The server verifies the account, bound user, and device IDs. A grant does not give access to another user's devices or extend an entitlement.

The policy below permits listing one device and reading its directories and preferences. Replace the placeholder IDs, then validate, simulate, and bind the policy in [RAM management]({{DOCS_BASE_URL}}/en/ram-management). This policy does not grant preference updates or terminal session creation.

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "quyan:remote_terminal:ListDevices",
        "quyan:remote_terminal:BrowseDirectories",
        "quyan:remote_terminal:GetAgentPreferences"
      ],
      "Resource": "acs:remote-terminal:*:account-id:device/user-id/device-id"
    }
  ]
}
```

An explicit Deny overrides Allow. Devices without a matching Allow do not appear in the list. Denied directory or preference reads return a permission error without exposing device availability or policy details. Results are also withheld if access is revoked or the device entitlement becomes inactive during the read.

Deployments using compatibility authorization retain the previous permission behavior. Shadow comparison records IAM results without sending duplicate requests to the device.

Device probing sends requests only to permitted devices and updates their online status. Devices without a matching Allow are neither probed nor updated by that operation. If ownership, entitlement, or authorization changes during a probe, the affected status write is rejected.

Preference updates require a separate write Action. The server checks access again before sending the update. Revoking access after a request has reached the device does not undo a change the device has already applied. Review the target device and settings before saving.

## Session visibility and usage permissions

`quyan:remote_terminal:ListSessions` authorizes each session using `acs:remote-terminal:*:<accountId>:session/<userId>/<sessionId>`. Only the authenticated user's sessions can appear. Matching Deny statements take precedence, and sessions without Allow are omitted. The list returns public summaries; it does not disclose working directories or browser connection tokens. Session resources can also be included in a resource group to limit an authorization's scope.

`quyan:remote_terminal:GetUsageSummary` requires the user's resource, `acs:quyan:*:<accountId>:user/<userId>`. It reports all owned active sessions and device bindings under valid entitlements, including devices and sessions that your list policy hides. List visibility does not reduce quota consumption. Session and device list permissions do not automatically grant usage queries or session creation.

These separate Actions apply when IAM enforcement is enabled; compatibility deployments retain the previous permission behavior.

Creating a pending session requires `quyan:remote_terminal:CreateSession` on the selected device ARN. A device-list or usage grant alone cannot create a session. Creation checks actual quota usage, including sessions hidden from lists. Reconnecting replaces stale pending sessions on that device and preserves connected sessions. If authorization is rejected before issuance completes, the new pending session is discarded and no browser capability is returned.

## Connecting and continuing a session

With IAM enforcement, `quyan:remote_terminal:ConnectSession` separately authorizes `acs:remote-terminal:*:<accountId>:session/<userId>/<sessionId>`. Creating a pending session does not automatically authorize running it. To permit sessions you create, grant this Action on your own session resource pattern, or have an authorized administrator bind a grant for the specific session.

Connection conditions use the actual WebSocket connection's source IP, transport and user agent. Proxy information is accepted according to the server's configured proxy trust, rather than copied from the earlier creation request. The server checks current authorization and credential state before starting the terminal and before forwarding terminal input or output. Idle sessions are checked periodically as well. Revocation, credential rotation, account or entitlement expiry, or unavailable authorization data stops further forwarding and closes the session. Revoking access cannot undo commands already sent to the device.

Malformed frames, frames targeting a different session, and excessive queued data close the originating connection. Browser messages cannot invoke device preference or directory operations; those operations require their own API permissions.

## Related pages

- [My remote terminal products]({{DOCS_BASE_URL}}/en/my-remote-terminal-products)
