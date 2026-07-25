# Push Aggregation

Push Aggregation delivers one business message to generic webhooks, DingTalk bots, Feishu bots, or WeCom bots. Channels are isolated by instance and can reference a Secret Vault alias for credentials. Credentials are neither stored in delivery logs nor returned by the Console.

## Configure channels

Create each channel in the Console with a name, type, HTTP(S) endpoint, and optional secret alias. Channels can be independently enabled, edited, or deleted. Channel management and delivery-log read are separate RAM actions, allowing least-privileged assignments for operations and applications.

## Unified send API

Sending needs the Push send action:

```http
POST /v1/products/push/send
Authorization: Bearer dpk_...
Content-Type: application/json

{
  "channelIds": ["channel_id_1", "channel_id_2"],
  "title": "Deployment complete",
  "content": "production has been updated",
  "idempotencyKey": "deploy-2026-07-24-001"
}
```

The response reports success, a sanitized error, attempt count, and next retry time for each channel. One failed channel does not block the others. Reuse a stable `idempotencyKey` for retries of the same business event to avoid duplicate notifications. Titles are limited to 200 characters, bodies to 10,000 characters, and a request to 20 channels.
