# Remote terminal

Select your own online device and shell in the remote terminal workspace to establish an interactive connection. The workspace supports tabs, opening locations, shortcuts and quick commands.

## Before connecting

1. Obtain an active entitlement in [My remote terminal products]({{DOCS_BASE_URL}}/en/my-remote-terminal-products), then install and register the agent as described there. Device quota controls bindings; terminal quota controls concurrent sessions.
2. Confirm that the agent is online and your identity can view the device and create sessions. IAM enforcement also requires a separate connection grant on the new session.
3. Open the workspace and refresh. Devices, session summaries and usage load independently; a failed section shows its own notice while other authorized sections remain usable. Refresh clears old list data instead of retaining an earlier authorization result. Unavailable usage is not displayed as zero quota.

Opening the workspace grants no device access or command execution permission. Its device list contains your enabled bindings under active entitlements, with per-device filtering under IAM enforcement. Expired or disabled entitlements visible on the personal products page do not make their devices available here.

## Establish a connection

1. Select a device card and check the hostname, platform, architecture and online status. Refresh attempts a probe, but a failed probe need not prevent listing; an online marker may reflect an earlier state.
2. Choose a shell reported by the device. Options come from the agent; if none are available, check its version and reported diagnostics.
3. To set a startup directory, configure and save the **Open location** first. Otherwise, use the agent's default location.
4. Click **Connect** and wait until the terminal is ready before typing commands. “Browser connected” means the browser reached the gateway, not that the remote shell is ready.
5. Click **Disconnect** when finished. Stopping, disconnecting or reconnecting cannot undo commands already sent and does not guarantee termination of background jobs started separately by a command.

**Disconnect before switching devices.** Selecting another card or changing the shell changes the next connection selection without replacing an established connection. The title and preferences may already reflect the new selection while terminal input still goes to the old device. For parallel work, create and connect a separate tab.

The connect button is unavailable without an online selected device, during connection setup, or when known terminal quota is exhausted. Unavailable usage, an enabled button or an online marker does not guarantee acceptance: the server still checks authorization, entitlement, device state and actual quota.

## Tabs, disconnection and reconnection

| Operation                | Result                                                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New tab                  | Starts with the current selection without connecting automatically. Select the same or another device and connect. Switching tabs keeps other tabs connected.                                  |
| Disconnect               | Ends the current tab's connection and attempts to stop its terminal. It does not unbind the device or uninstall the agent.                                                                     |
| Close a terminal tab     | Closes that tab's browser connection and discards its local display. The gateway stops the session when it receives the disconnection. The last tab has no close button.                       |
| Leave or reload the page | Connections and local displays are not saved as resumable terminals. Do not rely on them to preserve shell state.                                                                              |
| Reconnect                | Attempts to stop the current connection, creates a new session and clears the tab's previous display. It does not restore the original shell, foreground program, directory or scroll history. |

After an already-ready session disconnects unexpectedly, the page can retry according to that tab's settings. Do not rely on automatic reconnection for initial setup failures before readiness, normal exits or intentional disconnections. Defaults are three attempts with a five-second delay; the controls allow 1–10 attempts and 1–60 seconds. **Cancel retry** stops the wait. Each attempt still requires an online device and server approval.

Reconnection creates a new terminal. Check the previous command's outcome before repeating an operation with side effects. The network badge reflects browser-to-gateway round trips; it alone cannot prove device-to-gateway connectivity or remote command success.

## Set the opening location

1. Select an online device and open the location editor.
2. Expand and select a directory in the tree, or browse the current directory, parent or root entry. This selects directories; it is not a file upload or download tool.
3. Apply the setting to the device's preferences. Saving requires preference-update permission; browsing requires separate directory permission.
4. The next session uses the saved location. Updating it does not run `cd` in an existing shell.

**Clear** in the dialog changes only the draft; apply it to save. **Clear location memory** on the page immediately attempts to save an empty location while keeping shortcuts and quick commands. Path existence and access depend on the device's actual execution result.

Preferences are read and saved per device. A failed read may leave cached or default settings visible. Saving submits the opening location, shortcuts and quick commands together. Resolve read problems before saving if you have not confirmed the device's existing configuration, to avoid overwriting settings you need.

## Shortcuts, quick commands and clipboard

- Manage shortcuts below the terminal by recording a key combination or entering a sequence sent line by line. Sequences support `\r`, `\n`, `\t` and `\e`. Saving requires an online device and preference-update permission.
- Ctrl, Alt, Shift and Meta locks contribute to shortcut combinations. Clear locks after use. **Restore default shortcuts** saves the defaults and clears modifier locks while keeping the opening location and quick commands.
- Quick commands require a name and command content. Saving, editing and deleting updates the selected device's preferences. **Clicking a command immediately sends it, usually adding Enter to execute it, without another confirmation.** A carriage return anywhere or a trailing newline suppresses the extra Enter. Multiline content may execute multiple commands. Check the actual connected device and tab first.
- Right-click copies selected text; without a selection, it attempts to read the clipboard and send it directly to the current terminal. Browser permissions control clipboard access, and pasted newlines may execute commands. Disconnected input and paste are not queued for reconnection.

A timed-out or failed preference save may already have changed the device. Read again and confirm before retrying. Revoking authorization cannot undo a preference update already applied by the device.

## Copy links and view sessions

**Copy link** generates a workspace address with device information, an auto-connect flag and possibly a session ID. Recipients must still sign in and have their own device and session permissions. The link grants no device access and does not provide session takeover, replay or restoration of the original shell.

Opening the link may initiate a new connection; check its target first. If the specified device is not in the current visible list, the page may fall back to another visible device. Link parameters alone do not establish the actual connection target.

**Recent sessions** shows readable session summaries in descending creation order, five per page. It contains no command input or output and is not a complete, permanent history. Closed sessions may disappear. Refresh to check current status.

## Understand quotas

Terminal usage includes pending and connected sessions that have not closed, beyond the tabs open in this browser. Device usage counts enabled bindings under valid entitlements and can include offline devices; it is not an online-device count.

Quotas come from your currently enabled, active entitlements. Devices and sessions hidden by IAM list policies can still consume capacity, so visible cards and rows do not determine remaining quota. Refresh after changes. If no terminal capacity remains, check connections in other windows or purchase or renew an entitlement and contact an administrator.

## Troubleshooting

| Symptom                                              | Check                                                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No devices or an unavailable device list             | Refresh successfully, then check identity, device-read permission, entitlement validity and binding status. Verify registration on the personal products page. |
| Offline device                                       | Check the agent, network and platform connection on the target device, then refresh after recovery. Repeated purchases do not fix connectivity.                |
| Session created but terminal cannot start            | Check WebSocket availability and IAM's separate ConnectSession grant and conditions. Ask an administrator to check deployment or authorization.                |
| Quota exhausted with few visible rows                | Usage includes hidden sessions and other browser connections. Refresh, then check and end unnecessary connections.                                             |
| Changing the opening location did not move the shell | The setting applies to new sessions. Change directory within the current terminal or disconnect and connect again.                                             |
| Command outcome unknown after a drop                 | Reconnection creates a new terminal. Inspect the remote operation's outcome before retrying; disconnection does not prove the command never ran.               |

## Device-scoped authorization

When IAM enforcement is enabled, device listing, probing, directory browsing, and preference operations use separate Actions:

| Operation           | Action                                         | Resource                             |
| ------------------- | ---------------------------------------------- | ------------------------------------ |
| List devices        | `quyan:remote_terminal:ListDevices`            | Each device is filtered individually |
| Probe online status | `quyan:remote_terminal:ProbeDevices`           | Each device is filtered individually |
| Browse directories  | `quyan:remote_terminal:BrowseDirectories`      | Selected device                      |
| Read preferences    | `quyan:remote_terminal:GetAgentPreferences`    | Selected device                      |
| Save preferences    | `quyan:remote_terminal:UpdateAgentPreferences` | Selected device                      |

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
