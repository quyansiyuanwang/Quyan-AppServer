# Status Monitoring

Status Monitoring periodically checks public HTTP(S) services and can publish a status page that requires no sign-in. Use it for recent website, API, or dependency checks. Failures between checks may go undetected.

## Requirements

1. Open **Status Monitoring** under developer products, select an available instance, and open its management or view drawer.
2. Check task permissions: `product:status:read` for reading, `product:status:write` for adding, editing, and manual checks, `product:status:manage` for deletion, and `product:status:publish` for publication. IAM enforcement also requires the corresponding action and resource grant.
3. Prepare a public HTTP(S) URL reachable from the platform. SSRF protection rejects private, loopback, link-local, and other restricted destinations; this feature cannot check private services.

For instances, product quotas, and credentials, see [Developer products overview]({{DOCS_BASE_URL}}/en/developer-products-overview). The console instance ID differs from the project ID used in resource policies. Use actual resource identifiers supplied by the API or confirmed by an administrator.

## Add a monitor target

Click **Add target**, complete the configuration, and click **Save**.

| Setting              | Instructions and limits                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                 | Required, at most 100 characters. The public page shows it, so avoid sensitive information.                                                                                              |
| Target URL           | Select `https://` or `http://`, then enter the host and path without repeating the scheme in the text box. The complete URL supports at most 2000 characters.                            |
| Method               | GET, HEAD, POST, PUT, PATCH, or DELETE; GET by default.                                                                                                                                  |
| Request payload      | Optional for POST, PUT, PATCH, and DELETE. Nonempty content must be valid JSON, at most 20000 bytes. The form has no custom-header or login-flow configuration.                          |
| Check interval       | 60–86400 seconds, default 60. The scheduler checks for due targets approximately once per minute; execution is not guaranteed at the exact configured second.                            |
| Alert delay          | 1–1440 minutes, default 5. This is not the HTTP request timeout.                                                                                                                         |
| Success status codes | Only `200` by default. Separate codes with commas, such as `200, 201, 204`, up to 100 entries. The form ignores invalid entries and may save if valid ones remain, so check every entry. |
| Response-body match  | Optional Contains or Equals with expected text, at most 10000 bytes. Both the status code and body condition must match when enabled. Not available for HEAD.                            |

Body matching compares case-sensitive text. It supports neither regular expressions nor JSON field selectors. Equals compares the entire body, so whitespace and line breaks can cause mismatches. GET and HEAD send no request payload.

Saving configuration does not complete a check. Wait for scheduling or use the row's **Check** action. `up` means the rules matched; `down` means they did not match or the request failed. A target without checks may have no latest status.

## Check, edit, and pause

| Action          | Result and considerations                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Check           | Sends one real request immediately, even for a paused target. Only the selected row is checked, then the list reloads. A success notice means the check completed; the target can still be `down`.                       |
| Edit            | Applies configuration on Save. Switching to GET or HEAD clears the request payload; HEAD also clears body matching. Confirm these removals before saving.                                                                |
| Pause or resume | Submits immediately without confirmation. Pausing stops subsequent scheduled checks and hides the target from the public page. Records remain, and resuming keeps history. An already dispatched check can still finish. |
| Delete          | Requires confirmation and deletes the target and its check records. The page has no restore action.                                                                                                                      |

Scheduled and manual checks send real HTTP requests. POST, PUT, PATCH, and DELETE can change target data, so confirm that repeated calls are acceptable. Each request has a 10-second timeout and a 1 MiB response limit. Checks follow up to five redirects, validating each destination. Total check latency can exceed 10 seconds, and redirects can change the request method under HTTP rules.

To stop scheduled checks, **pause the monitor targets first**. Unpublishing affects public access only. Disabling an instance does not replace target pausing: enabled targets can still be checked by the background scheduler. Pause them before disabling the instance.

The console lists configuration, latest status, and enabled state, with no check-history or latency-chart view. Close and reopen the instance drawer to retrieve results after scheduled checks; the panel does not poll automatically.

## Usage and charges

Manual checks for product instances and scheduled checks that use product metering consume product calls. Free quota, overage availability, and prices follow current account entitlement and server product configuration. Instances of the same product share the account's product quota. Once free quota is exhausted, configuration determines whether a check charges the account balance or is rejected.

A completed check that classifies a target as `down` still counts as a product call. Target failure does not establish free usage or a refund. Repeating Check sends a new request and incurs corresponding usage. A zero price still records usage but does not block calls because the free allowance is exhausted.

## Alert notifications

The first detected failure starts the outage duration. A later check that still fails after the alert delay attempts one outage notification. Recovery resets the episode; a recovery notification is attempted only if an outage notification was previously triggered.

Notifications are not independently triggered at the exact delay boundary; another check is required. Check intervals, scheduling delays, and quota exhaustion can delay detection or notification. Triggering an event does not establish delivery. Subscription, cooldown, and destinations follow [Notification settings]({{DOCS_BASE_URL}}/en/notification-settings). A failed delivery is not guaranteed to trigger another alert for the same outage episode.

## Publish a public status page

1. Click **Publish status page** in the instance drawer. It submits immediately without an extra confirmation.
2. After success, click **Open status page**, review it, and share the actual opened URL, whose path is `/status/{slug}`.
3. Click **Unpublish status page** when public access is no longer needed.

Anyone with the link can see enabled targets' names, latest states, check times, latency, HTTP codes, and recent check results. The public page omits target URLs, request payloads, body-match text, and error summaries. Management lists still contain configuration and should not be used as a public sharing surface.

Availability is the successful proportion among the latest **30 checks at most**. It is not a time-weighted SLA or a fixed 24-hour uptime measure. With no checks the page displays 0%, which does not establish measured total failure. All visible targets must be `up` for the overall normal indicator; an empty list or unchecked targets can also appear as partial service failure.

History marks run oldest to newest, while the detailed history area shows at most the latest five checks. The page loads once on opening and does not refresh automatically. Reload the browser page for current results and inspect the last-check time. An old `up` value does not establish a recent check.

Unpublishing or disabling the product or instance makes the public page unavailable. Check history older than 90 days is cleaned when scheduling runs successfully. The public page still selects only the latest 30 checks and offers no complete history export or restore.

## Loading and operation failures

Failed list or publication-state loading can leave previous results visible, including after switching instances. Use **Retry** in the error message and wait for success. Neither empty rows nor an old publication state establishes current state.

Creating, editing, deleting, checking, or changing publication reloads data. An operation can succeed while the reload fails, and a success notice may still appear. Reopen the drawer or retry loading before repeating a submission. Repeating Check sends another target request and consumes usage.

## IAM resource authorization

The product uses its own actions and resources. A project resource is `acs:developer:*:<accountId>:project/<projectId>`; a monitor resource is `acs:developer:*:<accountId>:status-monitor/<projectId>/<monitorId>`. The account comes from authentication context, and identifiers must match stored resources.

The **instance console** uses these authorization boundaries:

| Task                   | Action                                | Resource scope                                                                                                                         |
| ---------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| List targets           | `quyan:developer:ListStatusMonitors`  | The instance's backing project. This endpoint returns the project's monitor configuration without per-monitor filtering.               |
| Create a target        | `quyan:developer:CreateStatusMonitor` | Project; does not automatically grant subsequent management of the new monitor.                                                        |
| Edit, pause, or resume | `quyan:developer:UpdateStatusMonitor` | Target monitor.                                                                                                                        |
| Delete a target        | `quyan:developer:DeleteStatusMonitor` | Target monitor.                                                                                                                        |
| Run a manual check     | `quyan:developer:CheckStatusMonitor`  | Target monitor, independent of list and update actions.                                                                                |
| Read publication state | `quyan:developer:GetProject`          | Project. The panel also loads this information when publication permission is present, so a missing read grant can fail panel loading. |
| Publish or unpublish   | `quyan:developer:UpdateStatusPage`    | Project.                                                                                                                               |

Management lists return configuration such as request payloads; review sensitive contents before granting read access. A list grant on one monitor cannot replace the project-level list grant required by the instance console.

The **project management API**, `GET /v1/developer/projects/{projectId}/monitors/page`, has a different list boundary: it checks `ListStatusMonitors` per monitor within a candidate page and returns `items`, `page`, `pageSize`, and `hasNext`, with `resourceArn`. It provides no unauthorized total. Empty pages can have a next page, so continue according to `hasNext`. With IAM enforcement, that API's old array endpoint returns only the default first page, rather than the complete list. These pagination rules do not describe the instance console endpoint.

The project management API supports same-account monitor grants and resource-group membership. Removing a member changes the evaluated scope. Cross-account, wrong-project, case-mismatched, or invalid targets are rejected. Its manual checks recheck active resources before dispatch and persistence; paused targets remain manageable. Public pages, background jobs, and product credentials have their own access boundaries; management grants do not grant identical access through these entry points. Legacy and shadow project management retain individual project ownership behavior.

## Related documentation

- [Developer products overview]({{DOCS_BASE_URL}}/en/developer-products-overview)
- [Notification settings]({{DOCS_BASE_URL}}/en/notification-settings)
- [Balance history]({{DOCS_BASE_URL}}/en/balance-history)
