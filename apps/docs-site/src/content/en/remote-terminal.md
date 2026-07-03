# Remote terminal

Use this page to connect to and operate registered remote devices.

## Page purpose

- View registered devices and their online status.
- Start a terminal session by selecting a device and shell type.
- Manage multiple terminal tabs in a single view.
- Browse the remote device's directory tree.

## What you will see

### Device list

The left sidebar lists all devices bound to your account. Each card shows:

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
