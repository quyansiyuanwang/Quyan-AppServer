# Push Aggregation

Push Aggregation delivers one business message to generic webhooks, DingTalk bots, Feishu bots, or WeCom bots. Channels are isolated by instance and can reference a Secret Vault alias for credentials. Managed Secret plaintext is not returned in channel-management responses.

## Configure channels

Create each channel in the Console with a name, type, HTTP(S) endpoint, and optional secret alias. Channels can be independently enabled, edited, or deleted. Choose the channel type when creating it; editing can change its name, endpoint, and secret reference. Channel management and delivery-log read are separate RAM actions, allowing least-privileged assignments for operations and applications.

After you select a Secret Vault instance and alias, deliveries use its value as a Bearer credential. You can also save a credential securely from the channel editor; its alias is selected automatically and its plaintext cannot be viewed again. This writes to the vault immediately. An existing alias is updated, which can affect other channels or applications that reference it. Cancelling the channel editor afterwards does not undo the credential write; save the channel separately to apply the reference.

## Test in the console

Open a Push product instance and use the online test if you have send permission. Enter a product API key with send permission, select channels, and provide a title and content before sending. The test sends real messages and counts toward product usage; use a trusted device and suitable test channels.

Each send uses a new idempotency key, so sending again creates new deliveries. A request-success message does not mean every channel delivered successfully. Check the returned channel statuses and, if authorized, the delivery logs. If sending times out or the connection is interrupted, the message may already have been delivered. Check the destination and any visible delivery logs before deciding whether to send again.

If channels or delivery logs fail to load, the previous list may remain visible, including after switching instances. Select **Retry** in the relevant error message and confirm the current instance and successful load before editing channels or judging delivery status.

## Unified send API

Sending needs the Push send action:

```http
POST /v1/products/push/send
Authorization: Bearer sk-dpk-...
Content-Type: application/json

{
  "channelIds": ["channel_id_1", "channel_id_2"],
  "title": "Deployment complete",
  "content": "production has been updated",
  "idempotencyKey": "deploy-2026-07-24-001"
}
```

The response reports delivery status, failure classification, attempt count, and next retry time for each channel. Only selected channels that are enabled and active produce records; the request fails if none are available. Check that the returned channels match your intended recipients. One failed channel does not block the others.

Reuse a stable `idempotencyKey` for the same business event: a duplicate request returns existing delivery records rather than sending its new content. Those records may still be incomplete while the first request is processing. Failed deliveries are retried by a background job for up to three attempts, including the first. A successful delivery means the channel HTTP request succeeded; it does not guarantee that the recipient displayed the message. Product API calls count toward usage; quota and charges depend on current product configuration.

Titles are limited to 200 characters, bodies to 10,000 characters, and a request to 20 channels.

## Project Channel resource authorization

In IAM enforce mode, JWT project management can delegate one channel. Its ARN is `acs:developer:*:<accountId>:push-channel/<projectId>/<channelId>`. accountId comes from authentication context, and IDs must exactly match stored letter case.

- `quyan:developer:CreatePushChannel` controls creation on a specified project ARN without automatically granting visibility, modification, or deletion of the new channel.
- `quyan:developer:ListPushChannels` controls configuration visibility per channel. This is sensitive access: an endpoint may contain credentials entered by you. Prefer managed Secret references and grant configuration access carefully.
- `quyan:developer:UpdatePushChannel` and `DeletePushChannel` separately control modification and deletion, without granting message dispatch or delivery-log access.

### Separate credential-use authority

Selecting or replacing a managed Secret, or changing the destination or re-enabling a channel while retaining its reference, also requires `quyan:developer:UseSecret` on `acs:developer:*:<accountId>:secret/<vaultProjectId>/<ALIAS>`. Channel management, Secret metadata, or Secret writes do not satisfy this requirement. A matching Deny still wins. This high-risk capability permits configuring the credential for an external request destination; it is not an endpoint for obtaining plaintext.

The reference must belong to an active Secret instance of the channel project's stored owner, with an active alias and backing project. Management queries reference metadata only, without decryption or changing last-used time. Renaming or disabling a channel does not require Secret-use authority. Removing the reference while changing the destination is atomic and does not retain the old credential. Broken legacy references require reselection before changing the destination or enabling the channel.

The server rechecks the authorized channel snapshot and Secret target within a transaction. Concurrent changes to configuration, references, or instance backing projects cause a safe failure; requests are not automatically retried with stale authorization. Writes retain HTTP(S)/SSRF validation.

### Lists and authorization scope

`GET /v1/developer/projects/{projectId}/push-channels/page` accepts page/pageSize and returns items, page, pageSize, hasNext, and each item's resourceArn. Candidates are restricted to an active same-account project before per-channel evaluation. No unauthorized total is returned; empty pages may have a next page. The old array endpoint returns only the default first page in enforce. Channels support resource groups; removal changes scope on the next request. Paused channels remain manageable, while inactive resources, wrong-project IDs, and foreign accounts are rejected.

These rules cover JWT project channel management. Product credentials, dispatch, scheduled retries, and product-instance delivery-record access retain their separate validation paths; legacy/shadow keep individual project ownership constraints.

## Project Delivery record resource authorization

JWT project management supports per-record authority using `acs:developer:*:<accountId>:push-delivery/<projectId>/<deliveryId>`. `quyan:developer:ListPushDeliveries` controls each record's list visibility; `GetPushDelivery` controls a specific record's detail. Listing does not imply detail access, and channel configuration grants do not imply delivery visibility. Both Actions are sensitive reads.

- `GET /v1/developer/projects/{projectId}/push-deliveries/page` accepts page/pageSize and returns items, page, pageSize, and hasNext. Candidates are restricted to active same-account projects, channels, and records before per-resource evaluation. No unauthorized total is returned. Empty pages may have a next page; continue according to hasNext. The old array endpoint returns only the default first page in enforce.
- `GET /v1/developer/projects/{projectId}/push-deliveries/{id}` returns authorized status, channel ID, attempts, retry time, creation/update times, and resourceArn. It does not dispatch or retry a message.

Management responses contain no message title/body, idempotency key, channel endpoint, or raw provider error. Failed records expose the safe classification `failureReason: "dispatch_failed"`. To prevent URLs, tokens, or message contents in historical errors from leaking, all delivery responses—including legacy/shadow and product dispatch responses—no longer populate the old error field. Clients should use status and failureReason. New dispatch failures store only a fixed identifier, not provider exception text.

Records support resource groups; member removal changes scope on the next request. A record and its channel must belong to the same project and account. Paused channels retain history access; inactive resources, wrong projects, case-aliased IDs, or noncanonical historical foreign keys are rejected or omitted without stopping traversal of later pages. Deleting a channel also deletes its deliveries, so their group memberships no longer grant access. legacy/shadow retain personal array ownership constraints; product-instance APIs retain their independent principal and permission checks.
