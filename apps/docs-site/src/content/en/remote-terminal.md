# Remote terminal

Use this page to connect to and operate registered remote devices.

## Page purpose

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

When a quota is reached, the connect button is disabled with an explanation.

### Terminal area

The main area is a multi-tab terminal. Each tab maps to one device session and supports:

- Shell-type selection (bash / sh / powershell, etc., depending on the agent).
- Connect, disconnect, and reconnect actions.
- Full xterm.js experience (colors, cursor, scroll history).
- Optional paste-on-reconnect: content typed while disconnected is sent when the session resumes.

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

## Related pages

- `my-monthly-passes`

## Device-scoped read authorization

When IAM enforcement is enabled, device listing, directory browsing, and preference reads use separate Actions:

| Operation          | Action                                      | Resource                             |
| ------------------ | ------------------------------------------- | ------------------------------------ |
| List devices       | `quyan:remote_terminal:ListDevices`         | Each device is filtered individually |
| Browse directories | `quyan:remote_terminal:BrowseDirectories`   | Selected device                      |
| Read preferences   | `quyan:remote_terminal:GetAgentPreferences` | Selected device                      |

Device ARNs use `acs:remote-terminal:*:<accountId>:device/<userId>/<deviceId>`. The server verifies the account, bound user, and device IDs. A grant does not give access to another user's devices or extend an entitlement.

The policy below permits listing one device and reading its directories and preferences. Replace the placeholder IDs, then validate, simulate, and bind the policy in [RAM management](/docs/ram-management). This policy does not grant preference updates or terminal session creation.

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
