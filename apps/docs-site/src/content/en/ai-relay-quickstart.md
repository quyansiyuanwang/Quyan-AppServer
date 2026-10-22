# AI relay quick start

This page explains how to call an enabled AI model with a Relay Token.

## Before you start

Sign in to the AI Relay Console and make sure you have an available channel or automatic proxy pool. A Relay Token is for API requests only, not for signing in to the admin site.

## Call AI in four steps

1. Open Relay token management and select Create token.
2. Choose channels or an automatic proxy pool, save the token, then copy the **Relay Base URL** and token value shown in the creation drawer.
3. Store the token in the caller's server-side environment. Do not commit it or expose it in browser code.
4. Request `Relay Base URL + /v1/models`, choose a model from the response, then use a request format enabled for that model.

## Minimal request

Replace the example domain with the Relay Base URL displayed by your console:

```bash
curl "https://relay.example.com/v1/chat/completions" \
  -H "Authorization: Bearer <relay_token>" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-enabled-model","messages":[{"role":"user","content":"Hello"}]}'
```

OpenAI Responses uses `/v1/responses` and an `input` field. Channels, models, request formats, token status, quota windows, and IP allowlists can affect whether a request succeeds.

## Request header forwarding

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

## Common issues

- `401`: confirm that the credential is a Relay Token and the header is `Bearer <relay_token>`.
- Model unavailable: request `/v1/models` again and check that the token's channels enable the model and format.
- `403`: check token status, IP allowlist, and quota limits.

Related pages: `relay-token-management`, `api-documentation`, `relay-settings`.

## Resource protection and retries

The server may limit total concurrency, queue time, uploads and upstream response size. On HTTP 429, retry with backoff rather than immediately issuing parallel retries. Oversized responses abort the upstream instead of returning truncated success. A stream failure does not imply zero upstream usage; consult usage records. Budgets depend on the deployment configuration.
