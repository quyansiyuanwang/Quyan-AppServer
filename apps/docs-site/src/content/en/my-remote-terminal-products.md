# My remote terminal products

Use this page to browse published remote terminal product plans, purchase or claim entitlements, and manage your registered devices.

In IAM enforcement mode, revocation uses `quyan:remote_terminal:RevokeMyDeviceBinding`, and reminders use `quyan:remote_terminal:GetMyUnbindReminder`. Both operations require permission on your `acs:remote-terminal:*:<accountId>:product-binding/<userId>/<bindingId>` and its `acs:remote-terminal:*:<accountId>:product-entitlement/<userId>/<entitlementId>`. Other users' bindings are always denied. Authenticated users can read their own reminders; revocation still requires the corresponding permission. The allowance is shared by an entitlement, and concurrent revocations cannot exceed the remaining allowance. Authorization or allowance configuration changes during the operation cause it to fail.

Your registration-token rotation uses `quyan:remote_terminal:RotateMyRegistrationToken` and checks both `acs:remote-terminal:*:<accountId>:product-entitlement/<userId>/<entitlementId>` and `acs:remote-terminal:*:<accountId>:product-registration-token/<userId>/<entitlementId>/<tokenId>`. Authenticated identities retain their own rotation capability, while a matching explicit Deny still blocks the operation. A token wildcard under the selected entitlement can cover first-time creation. Failed rotations preserve the previous token; after a successful rotation, update the Agent configuration with the new token.

Install-token issuance uses `quyan:remote_terminal:GetMyInstallToken` on `acs:remote-terminal:*:<accountId>:product-entitlement/<userId>/<entitlementId>`. Authenticated users retain issuance for their own entitlements, while a matching explicit Deny still blocks the operation. Other users' entitlements and entitlements with zero device allowance cannot receive an install token. The server rechecks entitlement state and authorization before returning the token; changes during issuance prevent credential delivery. The install protocol is unchanged, and the response's expiration time still determines the token's validity.

In IAM enforce mode, new install tokens are bound to their issuer and the authorization, identity, and entitlement revisions at issuance. Device registration checks these facts again. Revoked policies, a disabled issuer or changed identity revision, a revoked role session, a revoked or expired AccessKey, or changed entitlement configuration can invalidate a token before its expiration. Obtain a new install token in that case. Source-IP, HTTPS, and other request conditions use the device's actual registration request rather than the browser attributes from issuance.

Device-slot checks, binding writes, and token-use records share one authorization transaction. Failed authorization leaves no new binding and returns no new heartbeat credential. Reactivating disabled devices also consumes capacity, and previously unbound devices retain the existing cooldown rules. Compatibility install tokens continue to work in legacy/shadow mode; enforce mode requires reissuance. New tokens retain their IAM constraints after an authorization-mode rollback. Long-term registration tokens continue to follow their existing validity and rotation rules.

In IAM enforcement mode, purchase and renewal use `quyan:remote_terminal:ClaimPublishedTemplate` on your user resource, the published offer `acs:remote-terminal:*:<accountId>:published-template/<userId>/<templateId>`, and the resulting entitlement. The offer is the published plan available to your identity and grants no access to platform template management. Authenticated users retain purchases for their own resources; matching explicit Deny still blocks them. Balance deductions, transaction records and entitlement changes commit together; failed authorization returns no entitlement or credential and rolls back the charge. Renewal charges only the current renewal or upgrade amount, while the entitlement records the cumulative purchase amount. Purchase results omit registration credentials; obtain one through the separate registration-token rotation operation.

Your entitlement list uses `quyan:remote_terminal:ListMyEntitlements` and evaluates each `product-entitlement` resource before calculating the total or selecting a page. Denied entitlements are omitted. Template names, registration-token metadata and registered-device counts require their own contributing resources to be readable with the same action; partial access omits the affected field. Registration secrets are never returned by this list in IAM enforcement mode. Use the separately authorized token rotation operation to obtain a credential. The list remains restricted to your identity, including when other users belong to the same account.

Your device list uses `quyan:remote_terminal:ListMyDevices` on each `product-binding` resource before calculating the total or selecting a page. Denied devices are omitted. A denied parent entitlement hides its name; a denied registration-token resource hides its reference. The list returns supported shell names without reading heartbeat credentials or the full host snapshot. Device rows and parent entitlements must belong to your identity; inconsistent ownership is rejected.

In IAM enforcement mode, published plans use `quyan:remote_terminal:ListPublishedTemplates` on each offer `acs:remote-terminal:*:<accountId>:published-template/<userId>/<templateId>`. Only enabled, published plans admitted for your identity appear. An explicit Deny can hide a specific plan or every plan. Viewing an offer does not grant permission to purchase it or manage its platform template; those operations have separate actions.

Each renewal or upgrade debits only the amount for that operation. The entitlement’s purchase amount is the cumulative amount paid across purchases and renewals; it is not debited again. A free renewal retains that total and creates no new purchase debit. If the current charge exceeds your balance, the renewal fails and leaves the entitlement unchanged.

## Page purpose

- Browse published remote terminal product plans with pricing.
- Purchase new plans or merge upgrades into existing entitlements.
- View your current entitlements, their validity, device/terminal quotas, and registration tokens.
- Manage bound devices and revoke them when needed.
- Generate install commands for the remote terminal agent.

## What you will see

### Published plans tab

- Cards for each published product plan with name, description, and unit pricing.
- Billing unit (day/week/month), purchase limits, and minimum purchase requirements.
- Purchase form: plan name, purchase mode (new or merge), units, device count, terminal count.
- Estimated price with breakdown (renewal vs. upgrade cost).
- **Claim** button to confirm and purchase.

### My entitlements tab

- Table of your active, pending, expired, and disabled entitlements.
- Each row shows: plan name, template, validity period, duration days, device/terminal limits.
- Registration token (masked) with copy and rotate actions.
- **Connect device** button to jump to the remote terminal console.

### My devices tab

- Table of registered devices with hostname, device ID, entitlement, platform, and last seen time.
- **Connect device** action to open a terminal session.
- **Revoke** action with an unbind reminder dialog showing allowance, cooldown, and used count.

## Common actions

1. Browse plans and adjust the purchase form to match your needs.
2. Claim a free plan or purchase a paid plan — confirm the estimated price before proceeding.
3. Copy or rotate the registration token for an entitlement.
4. Open the install agent dialog to generate the correct command for your OS and architecture.
5. Revoke a device you no longer need, respecting the cooldown and allowance limits.

## Notes

- Merge mode lets you upgrade an existing entitlement instead of purchasing a new one.
- Free plans (zero estimated price) can be claimed without cost.
- Token rotation invalidates the old token — update your agent configuration immediately.
- Device revocation is subject to per-window limits and cooldown periods.

## Related pages

- [Remote terminal]({{DOCS_BASE_URL}}/en/remote-terminal)
- [Remote terminal management]({{DOCS_BASE_URL}}/en/remote-terminal-management)
- [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history)
