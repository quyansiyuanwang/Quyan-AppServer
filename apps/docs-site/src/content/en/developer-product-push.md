# Push Aggregation

Push Aggregation sends one business message to selected channels and returns a result for each channel. Configure a generic Webhook, DingTalk, Feishu, or WeCom channel and use [Secret Vault]({{DOCS_BASE_URL}}/en/developer-product-secret) to store an optional channel Bearer credential.

## Prerequisites and permissions

Create an enabled Push product instance and prepare a destination that accepts requests. See [Developer products]({{DOCS_BASE_URL}}/en/developer-products-overview) for instance and product API key creation.

| Task                                            | Product permission            |
| ----------------------------------------------- | ----------------------------- |
| View and manage channel configurations          | `product:push:channel:manage` |
| Send messages and display the console test card | `product:push:send`           |
| View delivery logs                              | `product:push:delivery:read`  |
| Manage instances and keys                       | `product:push:manage`         |

These permissions are independent. Sending requires both the product key's action grants and its bound identity's effective permissions to allow sending. With send permission alone, you can enter known channel IDs in the test card without necessarily seeing the channel directory. Managed credential references also involve Secret read, write, or use eligibility, as described below.

## Configure channels

1. Open the Push product instance details and add a channel.
2. Enter a name of 1–100 characters, choose a type, and enter an HTTP(S) destination of up to 2,000 characters. Names must be unique within the instance. Private, unresolvable, or username/password-bearing URLs are rejected.
3. For Bearer authentication, select an available Secret Vault instance belonging to the same storage owner and an alias. Leave both fields empty if no credential is needed.
4. Save and check the type, destination, and reference before sending a test message.

Choose the type when creating the channel; editing changes its name, destination, and reference. Enable and disable actions submit immediately without additional confirmation. Deletion requires confirmation, also deletes the channel's delivery records, and cannot be restored from the console.

### Request format and destination compatibility

| Type            | JSON sent by the platform                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Generic Webhook | `{"title":"Title","content":"Body"}`                                                                                              |
| DingTalk        | `msgtype: "text"`, with `text.content` containing the title, a newline, and the body                                              |
| Feishu          | `msg_type: "text"`, with `content.text` containing the title, a newline, and the body                                             |
| WeCom           | Currently the same `title` and `content` fields as a generic Webhook; no automatic conversion to the native WeCom bot text format |

Confirm that your destination accepts the selected format. Use a compatible receiver to adapt native WeCom bot payloads or provider signing requirements. Managed credentials are sent in the `Authorization: Bearer ...` header; they do not implement a bot-specific signature algorithm.

The platform sends POST requests with a 10-second HTTP timeout, no redirect following, and a 1 MiB response-body limit. An HTTP success is treated as a successful delivery without checking provider business errors in the response body. It does not prove that a message was displayed or read.

### Reference or write a managed credential

After selecting a vault and alias, subsequent deliveries read that alias's current value. Bind credentials only to trusted destinations. Users who can configure channels and use a Secret can make the platform send the credential to a destination, even if they cannot read its plaintext; grant access accordingly.

Writing a Secret in the channel editor saves it to the vault immediately and selects its alias. An existing alias is overwritten, affecting other references. Cancelling the channel editor does not undo this write. Save the channel separately to apply the reference. Switching vaults clears the selected alias; check it again.

Saving or enabling/disabling a channel with an existing Secret reference in the product console checks vault read and use eligibility. Writing a Secret separately requires write permission. Listing available vaults, listing aliases, and saving a channel are separate operations. If a selector fails to load, check the corresponding permissions before removing an existing reference.

## Test in the console

1. In the instance details, enter a product API key with send permission in the Push online test card.
2. Select channels or enter their IDs, enter a title and body, and send.
3. Check `channelId`, `status`, and `success` in the returned records. A success notification does not mean every channel succeeded.

The entered key determines the instance and account used for sending, while channel options come from the open instance. A mismatch may leave no available channels; use a matching key. Changing input or failing client validation retains the old result. A valid submission clears it.

Tests send real messages and count toward usage. Every click generates a new idempotency key, so repeated clicks create new deliveries. After a successful response, the page attempts to reload the current instance's delivery logs, but a failed reload can retain old records. Test results do not update automatically after background retries. Check the receiver and logs after a timeout before sending again.

## Integrate the send API

Use a product key from a trusted server to call your deployment's API service. Login tokens, AccessKeys, and Relay Tokens cannot replace the product key.

```http
POST /v1/products/push/send
Authorization: Bearer <PRODUCT_API_KEY>
Content-Type: application/json

{
  "channelIds": ["channel_id_1", "channel_id_2"],
  "title": "Deployment complete",
  "content": "The application has been updated",
  "idempotencyKey": "deploy-event-001"
}
```

| Field            | Requirement                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `channelIds`     | 1–20 channel IDs from the key's instance                                                                                              |
| `title`          | 1–200 characters after trimming surrounding whitespace                                                                                |
| `content`        | 1–10,000 characters after trimming surrounding whitespace                                                                             |
| `idempotencyKey` | Optional, 1–100 characters after trimming; reuse a stable value for the same business event and different values for different events |

Check the HTTP status and business code, then inspect each item in the response `data` array. Records are created only for valid, enabled selected channels; other IDs may be skipped. The request fails if no channel is available. Response order may differ from input order; match results by `channelId`.

| Status or field             | Interpretation                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pending`                   | A record exists without a completed result; delivery is not confirmed                                                                            |
| `success` / `success: true` | The channel HTTP request succeeded; provider business acceptance and message display are not guaranteed                                          |
| `failed` / `success: false` | This attempt failed; `failureReason` is `dispatch_failed`                                                                                        |
| `attemptCount`              | Recorded attempts, including failed configuration checks                                                                                         |
| `nextRetryAt`               | Planned retry time, not a guaranteed execution time; no further automatic retry occurs at the attempt limit even if this field still has a value |

A normal API response can contain only failed channels. Responses exclude the title, body, idempotency key, destination, and raw upstream errors. Do not rely on the old `error` field; an empty console error column does not indicate success.

## Idempotency and background retries

Reusing an `idempotencyKey` within the same instance returns existing delivery records without sending the new title, body, or channel selection. While the original request is processing, records may be empty or incomplete; later calls may show updated statuses. Deleting records does not guarantee that the same key creates new deliveries. Use a new event key for a new message.

Idempotency controls creation of deliveries and does not guarantee exactly one external receipt. Connection loss or failure to record status after delivery can cause duplicates during retries. Receivers should deduplicate business events when required. Calling again with the same key still passes through product quota checks and metering; it is not a free status query.

A background task scans failed deliveries, with at most three recorded attempts including the first. Failures are scheduled for another attempt after about 60 seconds; actual timing also depends on scanning, queues, and service health. Retries use the channel's current destination and Secret value, so configuration changes and credential rotation can affect unfinished messages.

The console currently has no manual retry, individual cancellation, or attempt-counter reset. For records stuck in `pending`, at the attempt limit, or repeatedly failing, contact an administrator before deciding whether to send as a new business event.

Disabling an instance or product, or revoking the sending key, does not guarantee cancellation of queued background retries. To stop subsequent channel sends, disable the relevant channels before disabling the instance. Requests already in progress may finish. Disabled channels cause retries to fail and consume attempts; re-enabling does not reset the limit. Deleting a channel deletes its delivery records.

## Usage and logs

Product sends are metered per completed API call, not per channel: selecting several channels is still one call. A normal return counts even when every channel fails or an idempotency key returns existing records. Thrown errors enter the quota refund process, which may be delayed. Automatic background retries do not separately call the metered product send API.

Push instances in one account share daily quota, counted by the server's calendar date. Free quota, overage settings, and prices depend on current product configuration. Requests still accumulate when the price is zero. Key request counts, channel attempts, and delivery-log counts are not billing counts.

Console delivery logs show at most the current instance's latest 100 records, newest first, without pagination, search, or polling. They do not provide message-content retrieval or complete history export. Close and reopen details to reload; the top refresh updates only the instance list. Failed channel or log loads can retain old data, including another instance's data. Use the relevant error message's retry action and confirm successful loading before operating.

## Project management APIs and authorization scope

The instance console lists `/v1/products/push/instances/{instanceId}/channels` and `/v1/products/push/instances/{instanceId}/deliveries` check `ListPushChannels` and `ListPushDeliveries`, respectively, on the backing project without per-record filtering. These differ from the project management pagination APIs below.

Project management APIs in IAM enforce mode support resource-specific authorization within one account:

| Task                                                                                      | Action and resource                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create a channel                                                                          | `quyan:developer:CreatePushChannel` on the project ARN                                                                                                    |
| View, update, or delete a channel                                                         | `ListPushChannels`, `UpdatePushChannel`, or `DeletePushChannel`, respectively, on the channel ARN                                                         |
| List deliveries or read a delivery's details                                              | `ListPushDeliveries` or `GetPushDelivery`, respectively, on the delivery ARN                                                                              |
| Bind a Secret, change a destination while retaining its reference, or re-enable a channel | Also requires `quyan:developer:UseSecret` on the specific Secret ARN; a project management request that only renames or disables may not need this action |

Channel ARNs use `acs:developer:*:<accountId>:push-channel/<projectId>/<channelId>`; delivery ARNs use `acs:developer:*:<accountId>:push-delivery/<projectId>/<deliveryId>`. Secret ARNs use `acs:developer:*:<accountId>:secret/<vaultProjectId>/<ALIAS>`, and references must come from an available vault belonging to the same storage owner. Use IDs and aliases exactly as returned, preferably copying `resourceArn`.

Reading channel configuration includes its destination, which may contain query credentials you entered; grant it carefully. Delivery metadata excludes message content and channel credentials. Listing does not grant updates, sending, or individual detail access, and creation does not grant subsequent access to new resources. Matching Deny statements still take priority.

Paginated project management endpoints are `GET /v1/developer/projects/{projectId}/push-channels/page` and `GET /v1/developer/projects/{projectId}/push-deliveries/page`. They return `items`, `page`, `pageSize`, and `hasNext`, without `total`. Candidates are paginated before filtering, so an empty page may have a next page. In enforce mode, old array endpoints return only the default first page. Read a single delivery with `GET /v1/developer/projects/{projectId}/push-deliveries/{id}`; reading does not trigger sending.

Project management validates Secret references using metadata only, without updating last-used time; product console validation may read the Secret. Reload and check before resubmitting after configuration conflicts or invalid references. Removing resource-group membership affects subsequent authorization. Disabled channels retain readable history, while deletion removes it. See [RAM management]({{DOCS_BASE_URL}}/en/ram-management) for more authorization rules.

## Troubleshooting

| Symptom                                                       | Action                                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| The request succeeds but no message arrives                   | Check each channel status, then the receiver's business response; HTTP success does not prove message display              |
| No channel is available                                       | Check the key's instance, channel IDs, and enabled state; the open console directory alone is insufficient                 |
| A bot returns a business error but the delivery shows success | Check the actual channel JSON format and destination compatibility; use an adapter receiver if needed                      |
| Saving or enabling/disabling is denied                        | Separately check channel operations, vault metadata and Secret-use eligibility, and the validity of the existing reference |
| Logs appear unchanged                                         | Confirm a successful reload; logs and online test results do not automatically track background retries                    |
| Duplicate messages or increased usage                         | Check repeated test clicks, reused event keys, and automatic retries after uncertain external delivery                     |
