# AI relay quick start

Make your first AI request with a Relay Token, then verify the response and consumption records. Generation requests below can incur charges. Check model prices, token quota, and supported formats first.

## Before you start

Prepare a valid Relay Token that permits the target model and format, and the deployment's Relay Base URL. If you already have both, start at step three.

To create a token yourself, sign in to the AI Relay Console. Token management and API documentation require `RELAY_TOKEN_READ`; the create entry requires `RELAY_TOKEN_CREATE`. Actual creation, channel selection, reading, and credential disclosure have separate server authorization. Complete prompted two-factor verification and replay protection. Successful creation does not guarantee access to the full credential.

A Relay Token authenticates relay calls rather than management-site login. Account AccessKeys, OJ API Keys, and third-party authentication tokens are not substitutes.

## Step 1: Create and save a token

1. Open **Relay token management** and select **Create token**.
2. Select channels or an automatic proxy pool you can use. For composite tokens and other advanced options, see [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management).
3. Set a name, expiry, quota, and IP allowlist as needed. Check model and format availability before saving.
4. After creation, find the token in the list and use the credential-copy action. If it is masked or unavailable, check read and disclosure grants rather than repeatedly creating tokens.

Keep the credential in the caller's server-side environment or secure storage. Do not commit it, place it in public logs, or expose it in browser code.

## Step 2: Copy the Relay Base URL

Open **API documentation → API endpoints** and copy the deployment's **Universal endpoint** as the Relay Base URL. The full-endpoint switch changes the client address format without changing the deployment.

Relay, backend, management, and identity sites can use separate domains. Clients may append `/v1` themselves; check their base-address requirements to avoid duplicate paths. Replace `https://relay.example.com`, `<relay_token>`, and model IDs below before running. Commands use Bash-style line continuation and quoting.

## Step 3: Check Chat Completions models

```bash
curl "https://relay.example.com/v1/models" \
  -H "Authorization: Bearer <relay_token>"
```

A successful response is a model list. Choose an `id` from the `data` array. This endpoint calculates availability for the **Chat Completions entry point**, including configured token format conversions. It is not a complete catalog for every protocol or image capability.

A token that only supports Responses, Anthropic, or Gemini may not pass this query. Check its format-specific models and channel configuration instead of treating an empty list or query error as proof that other formats are unavailable. A listed model also does not guarantee quota, balance, concurrency, or upstream availability for the next request.

## Step 4: Send a generation request

Start with a small output limit and a non-streaming Chat Completions request:

```bash
curl "https://relay.example.com/v1/chat/completions" \
  -H "Authorization: Bearer <relay_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-enabled-model",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 256
  }'
```

The example limits output with `max_tokens`; use `max_completion_tokens` instead if your model requires it. When the token converts Chat Completions to Anthropic, one of these fields must contain a positive number.

For Responses, first confirm that the channel and model enable that format, then use its separate path and fields:

```bash
curl "https://relay.example.com/v1/responses" \
  -H "Authorization: Bearer <relay_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-enabled-responses-model",
    "input": "Hello",
    "max_output_tokens": 256
  }'
```

Chat Completions and Responses do not interoperate automatically just because both are OpenAI-compatible. See [API documentation]({{DOCS_BASE_URL}}/en/api-documentation) for Anthropic, Gemini, and image addresses and fields.

## Verify the response and charges

Non-streaming Chat Completions normally returns compatible JSON with a reply in `choices`. Responses uses its own output structure. Check HTTP status and protocol errors rather than applying platform business API `code === 0` unwrapping.

After the first request succeeds, enable streaming if the client needs it. Read events in the selected protocol and wait for complete termination. Partial output does not establish full success.

Review actual usage, charges, and applicable monthly-pass coverage in [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records). Keep a request ID when diagnosis is needed. Network timeouts, interrupted streams, or a missing local settlement record do not independently prove that the upstream did not process the request or incur usage.

## Common issues

| Symptom                                               | What to check                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Creation succeeds but the credential cannot be copied | Check list/read and disclosure grants; creation does not grant disclosure                                                |
| `401`, `404`, or invalid token                        | Check Relay Base URL, credential type and full value, and whether the token was disabled or deleted                      |
| `400`, expired token, or unsupported format           | Check expiry, request fields, model, and format; `/v1/models` only checks the Chat Completions entry point               |
| `403` or disallowed IP                                | Check the caller's actual egress IP and allowlist; custom origin headers do not replace this check                       |
| `429` or quota/concurrency errors                     | Check token quota windows, concurrency, and queue limits; wait and use bounded backoff rather than parallel resubmission |
| A listed model fails generation                       | Also check account balance, quota, channel state, routing, and the upstream error                                        |
| HTML or a missing path                                | Check for a frontend domain or a client appending `/v1` twice                                                            |

Use error content and request IDs rather than HTTP status alone. Prices, windows, available models, and capacity follow the deployment and actual request configuration.

## Resource limits and retries

The server can limit concurrency, queue time, uploads, and upstream response size. Capacity, timeout, and response-size failures can reject requests or interrupt an active stream. Do not treat partial output as a complete successful result.

Manual retries submit another request and can generate and charge again. Check the original outcome first, then use bounded backoff according to server information if retrying is needed. Forwarding `Idempotency-Key` does not establish platform-wide deduplication or guaranteed upstream idempotency.

## Request header forwarding

Use this reference when customizing a client or troubleshooting upstream compatibility. A first call does not require changing forwarding allowlists.

The relay uses a default protocol allowlist plus channel-specific additions rather than forwarding every field unchanged. Regular, streaming, and image requests follow the same rules:

- Common fields: `Content-Type`, `Accept`, `Accept-Encoding`, `User-Agent`, `X-Request-Id`, `X-Client-Request-Id`, and `Idempotency-Key`.
- All formats preserve `X-Opencode-Session` by default for compatible upstreams that require a session identifier.
- OpenAI formats additionally preserve `OpenAI-Organization`, `OpenAI-Project`, and `OpenAI-Beta`.
- Anthropic additionally preserves `anthropic-version` and `anthropic-beta`. The default version `2023-06-01` is supplied only when omitted; an explicitly requested version is not overwritten.
- Gemini additionally preserves `X-Goog-Api-Client`.

Acceptance of these fields, their features, and idempotency semantics depend on the upstream provider. During format conversion, protocol-specific headers are selected for the actual upstream format, not forwarded across unrelated protocols.

Credentials such as `Authorization` and `X-Api-Key` used to authenticate to this platform are replaced with the selected channel's credentials, not passed through as upstream credentials. `Cookie`, `Host`, hop-by-hop fields, fields named by `Connection`, proxy-origin fields, and custom headers not on an allowlist are not forwarded. `Content-Length` is recalculated from the actual outgoing body. Do not use custom request headers to control channels, billing, or platform permissions.

### Configure extra forwarded headers

Administrators with channel-edit permission can open **AI relay settings → Channel management → Create/edit physical channel → Extra forwarded request headers**, enter a name, and press Enter to add it, for example `x-stainless-retry-count` or `x-opencode-session`. Settings are saved per channel without restarting the service. Standalone and physical member channels are supported; pools use the selected physical channel's configuration, and failover uses each new channel's own list.

- Enter exact header names only, without values. Wildcards and prefix patterns are not supported. Names are case-insensitive and deduplicated.
- Up to 64 extra names, each at most 128 characters. Invalid, sensitive or reserved names cause a save error rather than silently enabling forwarding.
- Default protocol headers remain enabled. Clearing the extra list removes only additional forwarding.
- Add specific SDK metadata names as needed, such as `x-stainless-retry-count`; other unlisted `X-Stainless-*` fields remain filtered.
- Authorization, API keys, cookies, internal/replay/proxy-origin and hop-by-hop headers cannot be added. Headers named by `Connection` remain filtered even when allowlisted.
- Only valid values actually present in the caller's request are copied. Configuration does not generate or override values. Do not put secrets in custom metadata: these values are sent to the selected upstream.

## Related pages

- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
- [API documentation]({{DOCS_BASE_URL}}/en/api-documentation)
- [Relay settings]({{DOCS_BASE_URL}}/en/relay-settings)
- [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records)
