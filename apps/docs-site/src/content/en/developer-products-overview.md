# Developer products

Developer products include KV Storage, Short Link, Secret Vault, Status Monitoring, Verification, IP Geolocation, Push Aggregation, and JSON Endpoints. Choose a product, create an instance, and follow its guide to manage resources or call its API.

| Entry                 | Tasks                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Product console       | Manage this account's instances, resources, and product API keys; some products also show usage, call records, or online tests |
| Operations            | Manage a primary account's free quota, overage billing, and instance limit for one product                                     |
| Product configuration | Set the product's platform service switch, default quota, price, and default instance limit                                    |

Operations records manage quota and usage; they do not replace RAM grants. Seeing an entry does not grant every resource operation. See each product guide for prerequisites.

## Create an instance

1. Open the product console and select **Create Instance**. You need the product's instance-management permission; read or send permission may allow only viewing existing instances.
2. Enter a name of 1–100 characters and a slug of 3–80 characters. Slugs accept lowercase letters, digits, and hyphens and must be unique within this account's product. JSON Endpoints also enforce endpoint-slug uniqueness within the account.
3. Open the new instance's details and configure its resources. Create a product key when external API calls are needed.

The instance interface currently does not edit names or slugs. Disabled, non-deleted instances still count toward the instance limit. At the limit, ask an administrator to adjust the account limit, or back up needed data before deleting unused instances.

The console's top quota and instance limit come from product defaults. They may differ from this account's actual limits and do not indicate remaining calls. Check usage information or Operations for actual account quota. The list has no pagination or polling. The top refresh reloads instances and keys; resource refresh behavior is described in each product guide.

## Create, save, and revoke a product key

1. In instance details, select **Create Key** and enter a name of 1–100 characters.
2. Choose the calling identity and at least one action. Primary accounts can choose an identity in their own account with product permissions; RAM users can bind only themselves. Recheck selected actions after switching identities.
3. Optionally set an expiry. Leaving it blank sets no expiry. Choose a future time; a past time may create an immediately unusable key.
4. Copy the full key, store it in your deployment's secret management, and confirm that you saved it. The complete value appears only in this dialog and cannot be retrieved later. If the response is lost or you did not save the value, reload the list, revoke the unused key, and create a replacement.
5. From a trusted server, call the deployment's API service with `Authorization: Bearer <PRODUCT_API_KEY>`. See the product guide for paths, fields, and any additional signing requirements.

New keys use the `sk-dpk-` prefix; existing `dpk_` credentials remain compatible. Login tokens, AccessKeys, and Relay Tokens cannot replace a product key. Keep it out of public repositories, frontend code, and mobile application packages. Console online tests require entering a key in the browser; use a trusted device.

Each key binds one instance and one identity. Calls must satisfy both the key's selected actions and the identity's current effective permissions. Removing an identity's permission affects subsequent calls without reissuing the key. Instance management does not automatically grant product read, write, or send permissions, and Operations settings do not grant them either.

Existing keys do not support action, identity, or expiry edits. To rotate, create and deploy a replacement, verify calls, then select **Revoke** on the old key and confirm. Revocation cannot be undone. Requests already processing may finish, and public access and background tasks do not depend on that key. Unrevoked expired keys may remain listed; check their expiry.

## Disable or delete an instance

| Operation | Result and next steps                                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disable   | Submits immediately without further confirmation; rejects new product-key calls while retaining data and keys, and allows restoring the instance                       |
| Restore   | Allows new calls that satisfy the product switch, key validity, and permissions; does not restore revoked or expired keys                                              |
| Delete    | Confirmation permanently deletes the instance, its product resources, related resource history, and keys, without console recovery; account usage totals are not reset |

Disabling an instance is not a universal public-access withdrawal switch. A public JSON URL may remain accessible; change endpoint access protection or delete the endpoint separately. Queued Push retries may continue; disable the channels first. See individual guides for status pages, short links, and other entry points. Requests already running may finish.

## Quota, charges, and call records

All instances in an account share the product's daily call quota; RAM users do not receive extra independent quota. Days follow the server's calendar. A new day's count does not delete historical logs.

| Setting                             | Meaning                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Use product default quota           | Accounts without an override use the current product default, so later default changes affect them                           |
| Specify an account daily free quota | Overrides the product default; product availability and RAM permissions still apply                                          |
| Overage price is 0                  | Daily product quota does not reject calls, but metered counts still accumulate; capacity, rate, and input limits still apply |
| Overage price is positive           | Calls above free quota require overage billing to be allowed and enough primary-account balance; each uses the current price |

Metering depends on the product and entry point. Console resource management differs from product-key calls, and public short links can also be metered. A normal Push response counts even when all channels fail; verification checks differ from metered code sends. HTTP success, key request counts, business deliveries, and billed calls are different measures.

An error thrown after metering enters the usage and charge refund process, which may be delayed. Refunds do not undo external requests or resource changes already made. Requests rejected before passing quota or balance checks may not appear in product call records. For uncertain outcomes, check resources, receivers, and logs before repeating an operation.

Products with usage panels show this account's daily product totals and at most the latest 200 call records, newest first, without complete-history pagination, export, or polling. A successful record means the call completed normally, not that a message was read. Failed loads can retain old data; retry using the error message. The JSON product console has no usage panel; authorized administrators can inspect it in Operations.

## Manage account quota and instance limits

1. Open the product's **Operations** page. Search by username, display name, or account ID, using Enter or the search button. The default is 20 rows per page, with 10, 20, 50, and 100 available.
2. Select **Manage User** for the primary account and verify its username and account ID. Accounts without a product operations record may also appear and can have settings saved.
3. Choose the product default quota or enter an integer from 0 to 10,000,000. Set **Allow Overage Billing** and an instance limit of 1–1,000, then save.
4. For an existing product record, inspect instances, daily usage, and recent call audit records in the drawer. Its instance table is for viewing; it does not edit resources or retrieve key plaintext.

Changing quota does not reset today's usage. Lowering the instance limit does not delete existing instances; it affects subsequent creation. Saving Operations settings does not change RAM product permissions. Allowing overage billing can deduct subsequent charges from the primary account's balance; confirm authorization and the current price first.

The top refresh reloads the account directory without automatically updating all open drawer details. Reopen details or retry from the error message. Retrying reapplies saved Operations settings and may discard unsaved input. If any instance, usage, or audit read fails, old detail content may remain. Confirm successful loading and the selected account before interpreting it.

## Configure product defaults and pricing

1. Open the product's **Product Configuration** page, confirm successful loading, and check the product name and existing values.
2. Adjust the service switch, default daily free quota, overage price, and default instance limit, then save. Changing the switch also requires saving.
3. Reload to verify the result. Changes affect subsequent calls without recalculating historical charges.

Default quota accepts 0–10,000,000 and default instance limits accept 1–1,000. The server accepts overage prices from 0 to 1,000,000; the interface accepts up to six decimal places. At a zero price, quota displays as unlimited and its input is hidden. Recheck the actual quota when switching to positive pricing.

The default instance limit initializes new account product records. Existing records keep their saved account limit rather than all changing with the default. Accounts without a quota override use the current default quota. The product switch blocks new relevant product calls without deleting data or guaranteeing that public JSON access or queued Push retries stop.

Without configuration read access, the page may retain initial or previously loaded values; these do not prove that the product is disabled. Resolve loading failures or missing target configurations before saving over existing settings. The page does not edit resource-capacity policies, general settings, or retention periods. Do not treat those API fields as promises of enforced product capacity or cleanup.

## Manage project quota overrides

Quota overrides in **Developer Service Management** apply to project-based Verification, IP Geolocation, and Push calls. They are separate from product-account quota and do not increase the account-level free quota of product keys.

1. Add an override, choose a user or project, and enter its actual ID.
2. Select Verification, IP Geolocation, Push delivery, or all services, and enter a daily free quota from 0 to 10,000,000.
3. Optionally set a future expiry. Leaving it blank sets no expiry; clearing and saving also removes an existing expiry.
4. Save and check the subject, service, quota, and expiry. Deletion requires confirmation. Deletion or expiry falls back to the next applicable priority.

Priority is: project service, project all-services, user service, user all-services, then project default quota. User rules match the project's owner. Saving the same subject type, ID, and service updates the existing rule. Changing subject type or service while editing may write a different rule without deleting the old one; check and clean up the old rule when moving scope.

Non-deleted expired rules remain listed; visibility does not mean they apply. The list has no pagination or polling and may retain old records after a loading failure. An override changes free counts without granting permissions or automatically allowing overage billing.

## IAM authorization reference

The following applies to IAM enforce mode. Ordinary users need `GetProductCatalog`, `ListProductInstances`, `ListProductSubjects`, `GetProductUsage`, and `ListProductCallLogs` for the catalog, instance list, identity directory, usage, and call records, respectively. Creating an instance requires `CreateProductInstance`. All these actions use the `quyan:developer:` prefix and account resources. Updating/deleting instances and listing/creating/revoking keys use `UpdateProductInstance`, `DeleteProductInstance`, `ListProductInstanceKeys`, `CreateProductInstanceKey`, and `RevokeProductInstanceKey`, respectively, on the instance's backing project resource. Lists and writes are independent; product key actions must still be selected separately.

Platform management additionally requires eligibility from a real global group: `DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE` for Operations, `DEVELOPER_PRODUCT_CONFIG_MANAGE` for Product Configuration, and `DEVELOPER_QUOTA_MANAGE` for overrides. Operations also reads configurations, requiring configuration-read eligibility and authorization. OAuth application access tokens cannot use these platform administration APIs. AssumeRole uses only the role's own grants, and matching Deny statements take priority.

Actions below use the `quyan:developer:` prefix and resource paths use `acs:platform:*:platform:`. Use actual record IDs; a primary-account ID is not a product-account record ID.

| Task                                    | Action                        | Resource path                                                                                                                                                    |
| --------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read administrative configurations      | `ListProductConfigurations`   | `developer-product-config/<configId>`                                                                                                                            |
| Save configuration                      | `UpsertProductConfiguration`  | Both `developer-product-config-control/<productCode>` and the actual configuration record                                                                        |
| List saved product accounts             | `ListProductAccounts`         | `developer-product-account/<productAccountRecordId>`                                                                                                             |
| Search primary accounts with pagination | `ListProductAccountOwners`    | `developer-product-account-scope/<primaryAccountId>/<productCode>`; provisioned accounts also need this action on the actual product record                      |
| Save account quota                      | `UpsertProductAccount`        | Both the account/product scope above and the actual product account record                                                                                       |
| Read account product usage              | `GetProductAccountUsage`      | The actual product account record                                                                                                                                |
| View account product instances          | `ListProductAccountInstances` | `developer-product-instance/<instanceId>`                                                                                                                        |
| View account call records               | `ListProductAccountCalls`     | `developer-product-call-log/<logId>`                                                                                                                             |
| Read quota overrides                    | `ListQuotaOverrides`          | `developer-quota-override/<overrideId>`                                                                                                                          |
| Save quota overrides                    | `UpsertQuotaOverride`         | Both `developer-quota-subject/<user-or-project>/<subjectId>/<service>` and the actual override record; service is `ip`, `verification`, `push`, or generic `all` |
| Delete quota overrides                  | `DeleteQuotaOverride`         | The actual override record                                                                                                                                       |

Administrative lists filter by authorization. Primary-account directory totals count only visible accounts, and call records return at most the latest 200 allowed records. Configuration lists show only saved, readable configurations, sorted by product code; saving one product does not initialize others. Product-account lists sort by latest update and may retain disabled or expired, non-deleted records for cleanup. Listed instances must have an active backing project in the same account; disabled instances remain viewable.

Administrative reads do not provision target account product records or reset counters. User-ID lookups do not bypass authorization on the actual product record. Usage, configuration, and display information are read after resource authorization; call metadata excludes detailed request bodies and credentials. First saves also check newly created records. Restoring deleted configurations, account records, or overrides preserves original IDs. Concurrent resource, ownership, or permission changes may reject a read or write. Reload before resubmitting rather than repeatedly using old page data. See [RAM management]({{DOCS_BASE_URL}}/en/ram-management).

## Choose a product guide

| Goal                                                 | Guide                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| Store lightweight JSON data                          | [KV Storage]({{DOCS_BASE_URL}}/en/developer-product-kv)                 |
| Create and analyze sharing links                     | [Short Link]({{DOCS_BASE_URL}}/en/developer-product-short-link)         |
| Store third-party credentials                        | [Secret Vault]({{DOCS_BASE_URL}}/en/developer-product-secret)           |
| Check service availability and publish a status page | [Status Monitoring]({{DOCS_BASE_URL}}/en/developer-product-status)      |
| Send and verify codes                                | [Verification]({{DOCS_BASE_URL}}/en/developer-product-verification)     |
| Look up a public IP's location                       | [IP Geolocation]({{DOCS_BASE_URL}}/en/developer-product-ip-geolocation) |
| Send to Webhooks or compatible bot receivers         | [Push Aggregation]({{DOCS_BASE_URL}}/en/developer-product-push)         |
| Publish readable JSON content                        | [JSON Endpoints]({{DOCS_BASE_URL}}/en/developer-product-json-endpoint)  |

## Troubleshooting

| Symptom                                      | Action                                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No instance or key creation button           | Check instance-management eligibility and related IAM actions; read or send permissions do not include instance management                                         |
| Empty identity or action list                | Check same-account membership, current identity product permissions, and directory-read grants                                                                     |
| Key returns 401 or 403                       | Check credential type, expiry, revocation, instance and product switches, key actions, and current identity permissions; use the response business code            |
| Top quota differs from Operations            | The top shows product defaults; separately check account overrides, today's usage, and free unlimited mode                                                         |
| Other page areas remain old after saving     | Resources, directories, and details do not refresh together automatically; reload the relevant area, and note that save success does not guarantee refresh success |
| Access or delivery continues after disabling | Check public JSON access protection and Push channel retries; withdraw the corresponding entry using its product guide                                             |
