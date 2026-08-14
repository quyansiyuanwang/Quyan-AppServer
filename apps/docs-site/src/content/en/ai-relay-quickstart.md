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

## Common issues

- `401`: confirm that the credential is a Relay Token and the header is `Bearer <relay_token>`.
- Model unavailable: request `/v1/models` again and check that the token's channels enable the model and format.
- `403`: check token status, IP allowlist, and quota limits.

Related pages: `relay-token-management`, `api-documentation`, `relay-settings`.
