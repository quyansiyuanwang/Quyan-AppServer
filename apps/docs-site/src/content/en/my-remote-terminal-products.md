# My remote terminal products

Use **My remote terminal products** to browse published plans, purchase or renew entitlements, and generate agent installation commands for your own devices. Run commands on connected devices in the [Remote terminal]({{DOCS_BASE_URL}}/en/remote-terminal) console.

## Before you start

- Sign in with an identity authorized to view plans, your entitlements and devices, and perform the purchase, token or unbinding operations you need. Viewing a plan does not grant permission to buy it; viewing a device does not grant permission to connect or unbind it.
- The header shows your balance. The three tabs are **Published plans**, **My entitlements** and **My devices**. Only enabled, published plans accessible to your identity appear.
- This page loads only the first 100 entitlements and first 100 devices, with no pagination controls. Contact an administrator or use an authorized paginated API to check missing records. Do not infer that an entitlement is absent, a device is unbound or another purchase is allowed from these lists alone.
- **Refresh** attempts a device probe and reloads plans, entitlements, devices, sessions and balance. If any data request fails, previous data remains visible; check again after a successful refresh. The page clock recalculates status and estimates locally without continuously fetching lists from the server.

## Purchase or renew

### Purchase a new entitlement

1. Under **Published plans**, check the billing unit, prices, minimum and maximum purchase quantities, device and terminal quota ranges, and purchase limits.
2. Select a new purchase, then enter a name, purchase units, device count and terminal count. Counts are the resulting quotas, and at least one must be positive. An item not offered by the plan cannot be purchased; an item priced at zero can still be offered.
3. Check the estimate and breakdown, click **Claim**, then confirm the purchase. Use the same flow for a free plan.
4. After success, check validity and quotas under **My entitlements** and verify your balance. New entitlements start at purchase time.

One billing week is 7 days and one billing month is 30 days, rather than a calendar month. A new purchase costs “purchase units × (device price × device count + terminal price × terminal count).” Prices, limits and availability use the server configuration at submission; renewals and upgrades also use the plan's current prices.

### Merge into an existing entitlement

1. Select merge in the same plan's purchase form, then choose your existing entitlement from that template.
2. Enter additional purchase units and the resulting total device and terminal quotas. For example, to add one device to an allowance of two, enter 3, not 1. Quotas cannot decrease.
3. Check the target, charge and additional duration, submit, then refresh the target entitlement.

An unexpired entitlement keeps its original start time and extends from its previous expiration. A pending entitlement does not start earlier as a result. An expired but enabled entitlement restarts at purchase time. Disabled entitlements cannot be merged; the current candidate list may still include them, which does not mean the server will accept them.

**Current limitation:** the form accepts zero units for a quota-only upgrade, but the server requires a positive integer meeting the plan's minimum purchase units. Zero-unit upgrades therefore fail. Enter at least the required additional duration; contact an administrator before proceeding if you want an upgrade without renewal.

### Understand estimates and actual charges

For merges, the server charges separately for extending the old quotas and for additional quotas over the applicable interval through the merged expiration. The additional-quota interval rounds up to whole days, then is priced proportionally to the billing unit. Pending entitlements use their original start time; expired entitlements use only the newly purchased duration. Charges retain four decimal places.

The current page breakdown uses “renewal at the new total quotas + upgrade over the old remaining duration,” rounds remaining time up to hours, and rounds the displayed estimate up to an integer. These duration and amount rules differ from the server, so **the estimate may differ from the actual charge**. The confirmation dialog also shows the estimate. Contact an administrator before purchasing if the amount is unclear, and verify the payment in account transactions afterward.

Each renewal or upgrade charges only that operation. The entitlement's purchase amount is cumulative actual payment, not a second charge of that total. Free renewals preserve the accumulated amount. A purchase fails if the balance cannot cover the server-calculated charge.

## Install and register a device

### Choose an install credential

An entitlement with a positive device allowance can register devices. A terminal-only entitlement cannot issue device registration or install tokens. Opening the install dialog does not establish that an entitlement is active: registration checks its status, validity, token and available device capacity.

| Credential                   | How to obtain and use it                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install token                | Newly issued by default on the first opening of the dialog; currently valid for 15 minutes. It is not restricted to a single use, but authorization, entitlement and quota checks still apply. Obtain a new one after expiration instead of rerunning an expired command. |
| Long-term registration token | Selecting this option uses only a secret already returned by the current list. It does not retrieve or rotate a token. Existing expiration settings still apply; “long-term” does not mean it never expires.                                                              |

The long-term option persists while this page is open, so check the selection each time. IAM enforcement mode omits long-term secrets from the list; selecting that option yields an empty token. Clear it to issue a new install token. Resolve issuance errors before proceeding.

In IAM enforcement mode, a new purchase does not create a long-term registration token, but device registration still requires an existing, valid token record. If none has been created after your first purchase, use **Rotate token** to create one, then obtain a new install token. A disabled or expired long-term token also prevents registration using an install token. Rotation preserves the old expiration; contact an administrator to adjust an expired credential.

### Generate and run the command

1. Click **Install agent** on an entitlement. Select the target device's Linux, Windows or macOS system and x64 or arm64 architecture. The Linux/x64 defaults do not detect the target machine.
2. Check the version. The server supplies the list; the first successful load selects its first item, and manual input is supported. Confirm that the release has an asset for the selected system and architecture. Retry a failed version load and do not use a command with an empty version.
3. Check the token and download address. Commands may still appear with an empty token or after issuance fails. Copy only a complete command and verify the clipboard.
4. Download and launch in a trusted terminal on the target device. On Windows, prefer the PowerShell command marked as recommended. Resolve download errors and confirm the file downloaded before launching, to avoid running an older file left in the directory.
5. Refresh **My devices** to confirm registration, then click **Connect device** to open the console and select the device and shell. This button opens the console without selecting or connecting the row's device.

In bash/sh on Linux or macOS, the `RTC_REGISTRATION_TOKEN="..."` assignment at the beginning of the generated command applies only to the downloader, not the agent launched afterward. Change it to `export RTC_REGISTRATION_TOKEN="..."` and run it separately, then run the remaining download, executable-permission and launch commands. Run `unset RTC_REGISTRATION_TOKEN` when finished.

The background option appends the agent's `start` argument; it does not configure a system service or startup at boot. Proxy options affect the generated download step. A value beginning with HTTP(S) is treated as a download reverse proxy and does not establish that the agent's own connection uses that proxy.

Commands contain credentials: do not share them publicly, and remember that command history may retain tokens. For installation failures, check the release, architecture, credential validity, entitlement activation and device allowance. Repeated purchases do not resolve registration errors.

## Rotate a long-term registration token

Click **Rotate token** on an entitlement with device allowance and confirm. After success, the old token immediately stops authorizing new registrations. Update installation scripts or agent configuration that still stores it. This page has no expiration editor: rotation keeps the existing token's expiration, so an expired token does not gain a new validity period.

In IAM enforcement mode, lists omit secrets and an authorized rotation obtains a new token. The page attempts to copy it. Even if it reports copying succeeded, verify the clipboard in a secure location. If you did not obtain the secret, rotate again and use the latest token.

A definitive server rejection preserves the old token. A timeout or interrupted connection may leave the outcome unknown; rotate again to obtain the latest token before updating configuration.

## Unbind a device

1. Find the device under **My devices** and click **Revoke**.
2. Read the rolling window, used and remaining allowance, and rebind cooldown in the dialog. An administrator configures these values; devices in the same entitlement share the unbind allowance.
3. Select the acknowledgment checkbox and submit. An enabled button does not guarantee remaining allowance: the server checks again and rejects exhausted allowances or disabled unbinding.
4. Refresh after success to confirm removal from the current binding list. Unbinding revokes the platform binding without uninstalling the agent; stop the agent on the device as well if it is no longer needed.

Rebinding the same device requires waiting for the cooldown and passing valid-entitlement, quota and credential checks again. The reminder is a snapshot taken when the dialog opens; other operations and configuration changes can affect the final result.

## Troubleshooting

| Symptom                                           | Action                                                                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Old entitlement or balance after purchase success | The operation may have succeeded while its subsequent refresh failed. Refresh successfully and check entitlements and transactions before buying again.                                                                              |
| Purchase or renewal times out or disconnects      | The outcome may be unknown. Refresh this page and transactions in [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history), then check the new or updated entitlement and payment. Contact an administrator if uncertain. |
| Missing plans, entitlements or devices            | Check refresh success, identity and permissions, publication status and the page's first 100-record limit. An empty list does not necessarily mean deletion.                                                                         |
| An unexpired install token fails                  | Check entitlement, capacity and token status. Under IAM enforcement, authorization or identity changes can invalidate a token early; obtain a new one.                                                                               |
| Unbinding times out or refresh fails              | Successfully refresh devices and reopen the reminder before deciding the next action. Do not rely on the old remaining allowance.                                                                                                    |

## IAM permissions and resource scope

In IAM enforcement mode, revocation uses `quyan:remote_terminal:RevokeMyDeviceBinding`, and reminders use `quyan:remote_terminal:GetMyUnbindReminder`. Both operations require permission on your `acs:remote-terminal:*:<accountId>:product-binding/<userId>/<bindingId>` and its `acs:remote-terminal:*:<accountId>:product-entitlement/<userId>/<entitlementId>`. Other users' bindings are always denied. Authenticated users can read their own reminders; revocation still requires the corresponding permission. The allowance is shared by an entitlement, and concurrent revocations cannot exceed the remaining allowance. Authorization or allowance configuration changes during the operation cause it to fail.

Your registration-token rotation uses `quyan:remote_terminal:RotateMyRegistrationToken` and checks both `acs:remote-terminal:*:<accountId>:product-entitlement/<userId>/<entitlementId>` and `acs:remote-terminal:*:<accountId>:product-registration-token/<userId>/<entitlementId>/<tokenId>`. Authenticated identities retain their own rotation capability, while a matching explicit Deny still blocks the operation. A token wildcard under the selected entitlement can cover first-time creation. An explicitly rejected rotation preserves the previous token. If the request times out or the connection is interrupted, the outcome may be unknown; rotate again to obtain the latest token, then update the Agent configuration.

Install-token issuance uses `quyan:remote_terminal:GetMyInstallToken` on `acs:remote-terminal:*:<accountId>:product-entitlement/<userId>/<entitlementId>`. Authenticated users retain issuance for their own entitlements, while a matching explicit Deny still blocks the operation. Other users' entitlements and entitlements with zero device allowance cannot receive an install token. The server rechecks entitlement state and authorization before returning the token; changes during issuance prevent credential delivery. The install protocol is unchanged, and the response's expiration time still determines the token's validity.

In IAM enforce mode, new install tokens are bound to their issuer and the authorization, identity, and entitlement revisions at issuance. Device registration checks these facts again. Revoked policies, a disabled issuer or changed identity revision, a revoked role session, a revoked or expired AccessKey, or changed entitlement configuration can invalidate a token before its expiration. Obtain a new install token in that case. Source-IP, HTTPS, and other request conditions use the device's actual registration request rather than the browser attributes from issuance.

Device-slot checks, binding writes, and token-use records share one authorization transaction. Failed authorization leaves no new binding and returns no new heartbeat credential. Reactivating disabled devices also consumes capacity, and previously unbound devices retain the existing cooldown rules. Compatibility install tokens continue to work in legacy/shadow mode; enforce mode requires reissuance. New tokens retain their IAM constraints after an authorization-mode rollback. Long-term registration tokens continue to follow their existing validity and rotation rules.

In IAM enforcement mode, purchase and renewal use `quyan:remote_terminal:ClaimPublishedTemplate` on your user resource, the published offer `acs:remote-terminal:*:<accountId>:published-template/<userId>/<templateId>`, and the resulting entitlement. The offer is the published plan available to your identity and grants no access to platform template management. Authenticated users retain purchases for their own resources; matching explicit Deny still blocks them. Balance deductions, transaction records and entitlement changes commit together; failed authorization returns no entitlement or credential and rolls back the charge. Renewal charges only the current renewal or upgrade amount, while the entitlement records the cumulative purchase amount. Purchase results omit registration credentials; obtain one through the separate registration-token rotation operation.

Your entitlement list uses `quyan:remote_terminal:ListMyEntitlements` and evaluates each `product-entitlement` resource before calculating the total or selecting a page. Denied entitlements are omitted. Template names, registration-token metadata and registered-device counts require their own contributing resources to be readable with the same action; partial access omits the affected field. Registration secrets are never returned by this list in IAM enforcement mode. Use the separately authorized token rotation operation to obtain a credential. The list remains restricted to your identity, including when other users belong to the same account.

Your device list uses `quyan:remote_terminal:ListMyDevices` on each `product-binding` resource before calculating the total or selecting a page. Denied devices are omitted. A denied parent entitlement hides its name; a denied registration-token resource hides its reference. The list returns supported shell names without reading heartbeat credentials or the full host snapshot. Device rows and parent entitlements must belong to your identity; inconsistent ownership is rejected.

In IAM enforcement mode, published plans use `quyan:remote_terminal:ListPublishedTemplates` on each offer `acs:remote-terminal:*:<accountId>:published-template/<userId>/<templateId>`. Only enabled, published plans admitted for your identity appear. An explicit Deny can hide a specific plan or every plan. Viewing an offer does not grant permission to purchase it or manage its platform template; those operations have separate actions.

## Related pages

- [Remote terminal]({{DOCS_BASE_URL}}/en/remote-terminal)
- [Remote terminal management]({{DOCS_BASE_URL}}/en/remote-terminal-management)
- [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history)
