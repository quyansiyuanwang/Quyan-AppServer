# API documentation

Use **API documentation** in the AI Relay Console to copy client endpoints, compare model prices, and open Swagger when authorized. Platform APIs, AI relay, and third-party authentication use different addresses, credentials, and response formats. Choose your integration first.

## Prerequisites

Opening this console page requires `RELAY_TOKEN_READ`. It has **API endpoints**, **Model pricing**, and **Configuration tutorial** tabs. Page access does not grant every permission to create tokens, invoke models, read the channel catalog, or access OpenAPI.

Pricing loads when that tab is first opened. Prices and the channel catalog load independently. The catalog needs its own read grant (`quyan:relay:ListChannelCatalog` under IAM). Resolve network or permission failures before selecting Refresh.

## Choose the address and credential

| Task                                 | Address source                                          | Credential and result                                                                      |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Invoke an AI model                   | Displayed universal endpoint, the Relay Base URL        | Relay Token; compatible-protocol data or an event stream                                   |
| Query the current Relay Token quota  | Displayed Relay usage endpoint                          | The same Relay Token; that token's quota and usage                                         |
| Query platform account balance       | Platform account balance endpoint, `/v1/balance/usage`  | Login access token or permitted account AccessKey; OAuth additionally needs `balance:read` |
| Call platform APIs                   | Backend API address supplied for the deployment         | Credentials, scopes, and resource grants accepted by that endpoint                         |
| Start third-party user authorization | Identity-site address in the OAuth or Auth Center guide | Registered application, callback URI, and parameters for that flow                         |

Management, identity, documentation, backend, and relay sites can use different domains. Do not infer the API address from the current browser domain or interchange Relay Tokens, OJ API Keys, OAuth tokens, and Auth Center JWTs.

Platform balance requires the current user's `quyan:balance:GetUsage` grant; its `remaining` is account balance. Relay usage describes the current token. These are not interchangeable balances. For fields, date ranges, and limits, see [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management) and [Account balance and transfers]({{DOCS_BASE_URL}}/en/balance-history).

## Copy client endpoints

1. Open **API endpoints** and check the deployment's universal endpoint.
2. Choose OpenAI, Anthropic, or Gemini for the client and select its copy button.
3. Enable **Show full endpoint** when the client expects a complete request URL; otherwise use the corresponding base address.
4. Configure your Relay Token and check channels, model, format, quota, and IP restrictions before requesting.

| Endpoint          | Default display               | Full endpoint display                         |
| ----------------- | ----------------------------- | --------------------------------------------- |
| OpenAI-compatible | Relay Base URL plus `/v1`     | Plus `/v1/chat/completions`                   |
| Anthropic         | Relay Base URL                | Plus `/v1/messages`                           |
| Gemini            | Relay Base URL plus `/v1beta` | Plus `/v1beta/models/{model}/generateContent` |

Replace `{model}` with a model ID. Clients may append paths themselves; avoid adding `/v1` twice. The displayed full OpenAI endpoint is Chat Completions. Use `/v1/responses` for Responses; this switch does not select it automatically.

**Configuration tutorial** links to token management, authentication setup, and balance queries, with a copyable ccswitch balance template. Check the endpoint and credential before enabling it. Reading the tutorial does not create a token or grant access. Account AccessKeys remain subject to deletion, account state, and service policy rather than guaranteeing permanent access.

## Compare model prices

1. Open **Model pricing** and wait for prices and channels to load. Select Refresh for updated data.
2. Filter by model name or ID, request format, pricing type, and channels.
3. Choose base price, selected-channel minimum, or all-channel minimum. With multiple channels, choose match-any or match-all.
4. For separate channel columns, choose **Comparison mode**, select at least one channel, and set the primary comparison channel.
5. Check units, ranges, and any custom multiplier before copying a model ID into your client.

| Control or state                    | Meaning and limits                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Only models with available channels | Enabled by default; disabling it can reveal prices without a matching channel                                              |
| Show automatic proxy pools          | Off by default; enable to include them in this page's candidates and comparisons                                           |
| Base price                          | Model base price, not a final charge                                                                                       |
| Selected-channel minimum            | Compares selected channels; without a selection, displays the base price                                                   |
| All-channel minimum                 | Minimum among the currently visible matching catalog entries, not a platform-wide quote or routing guarantee               |
| Primary comparison channel          | Supplies the comparison-mode price for sorting and range filters; filters do not independently apply to every column       |
| Custom multiplier                   | Local price simulation; does not change server prices, tokens, or billing rules                                            |
| M / K units                         | Per million / per thousand tokens; switching also converts input/output range filters, without changing per-request prices |

Model name or ID matching is case-insensitive substring search. Channels match the model and its supported formats. A displayed row or channel tag does not establish that the current token can execute the selected format. Requests still check authorization, state, format, quotas, and routing conditions.

Context tiers and variable-priced channels can show ranges. Their minimum is not a fixed price for every request. Actual prices, channels, and settlement records determine charges; cache, monthly passes, and other rules can also affect cost. Text or image generation can incur charges. Check settlement details in [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records) after calling.

Pagination divides the loaded, filtered entries, with 20 per page by default. Changing filters returns to page one. Reset clears filters, custom multipliers, and comparison settings, restoring M units and hidden automatic pools. A refresh failure can retain old data or update prices and channels only partially. With an error displayed, neither an empty table nor retained prices establishes a complete current result. Prices do not refresh automatically.

## Choose the relay request format

| Format                  | Request path                             | Main input             |
| ----------------------- | ---------------------------------------- | ---------------------- |
| OpenAI Chat Completions | `/v1/chat/completions`                   | `messages`             |
| OpenAI Responses        | `/v1/responses`                          | `input`                |
| Anthropic Messages      | `/v1/messages`                           | Follow Messages format |
| Gemini                  | `/v1beta/models/{model}/generateContent` | Follow Gemini format   |

The channel and model must support the format. Chat Completions and Responses are enabled independently; legacy OpenAI configuration does not enable Responses. `/v1/models` currently filters using Chat Completions capabilities, so it cannot establish that all Responses, Anthropic, Gemini, or image models are unavailable.

For token creation and the first call, follow [AI relay quick start]({{DOCS_BASE_URL}}/en/ai-relay-quickstart). Converting Chat Completions to Anthropic requires a positive `max_tokens` or `max_completion_tokens`; do not omit the output limit.

Image edits use `/v1/images/edits`. Send multiple references with repeated `image[]` form fields. The example below shows the request shape. Replace deployment, credential, model, and local files, and confirm image-edit support before running:

```bash
curl "https://relay.example.com/v1/images/edits" \
  -H "Authorization: Bearer <relay_token>" \
  -F "model=your-enabled-image-model" \
  -F "image[]=@first.png" \
  -F "image[]=@second.png" \
  -F "prompt=Combine the subjects from both reference images into a new image"
```

Let the client generate the multipart boundary instead of setting `Content-Type` yourself. Repeated legacy `image` fields can be normalized to `image[]`, without guaranteeing that the model understands or combines multiple references.

## Open Swagger and read OpenAPI

The **Open Swagger / OpenAPI** header button appears with `DEBUG_OPENAPI_READ`. Selecting it requests a temporary access link with an approximately 60-second lifetime and prefers a new tab. When a new window cannot open, navigation may use the current window. If generation fails or the link expires, return to the console, check login, grants, and replay protection, and open again.

Opening also requires temporary-link generation authorization (`quyan:reurl:Generate`). A link neither extends the original credential's validity nor grants endpoint permissions. Do not share addresses containing temporary tokens. Executing Swagger requests calls the real service; check targets and consequences before writes or paid operations.

`GET /docs/openapi.json` returns raw OpenAPI JSON without the `{ code, message, data }` envelope. Remote access requires login authentication and `DEBUG_OPENAPI_READ`. Under IAM enforcement, eligibility must come from a real deployment-wide group with:

- Action: `quyan:system:GetOpenApiSpecification`
- Resource: `acs:platform:*:platform:system/openapi-spec`

Account policies or individual additions do not replace deployment-group eligibility. Deny takes priority, role sessions use role grants, and invalidation during the read withholds the document. Query parameters and headers cannot select another specification or grant access. Local development follows trusted-local-access rules; this does not establish anonymous public access.

## Parse platform API responses

Most platform business APIs use this structure:

```json
{
  "code": 0,
  "message": "Success",
  "data": {}
}
```

Check HTTP status and JSON shape, then numeric `code === 0`, before reading `data`. HTTP 200 can still be a business failure. `message` can be localized and should not determine program branches. Fields, pagination parameters, and limits depend on each endpoint; there is no universal maximum page size.

**Do not apply this unwrapper to AI relay, OAuth/Auth Center token protocols, files, event streams, or raw OpenAPI.** Complete runnable business API wrappers are in the [Node.js example]({{DOCS_BASE_URL}}/en/node-sdk) and [Python example]({{DOCS_BASE_URL}}/en/python-sdk).

## Common errors and actions

| Business code or symptom    | What to do                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| HTML, 404, or non-JSON      | Check deployment, endpoint, and path; a frontend domain or base address is not a complete request URL                                    |
| `1001`, `1014`              | Check credential type and environment; authenticate again or use a valid credential                                                      |
| `1002`, `1003`              | Correct parameters or the resource identifier before requesting again                                                                    |
| `1004`                      | Check action, resource, OAuth scope, and explicit Deny                                                                                   |
| `1006`                      | User-state updates or similar invalidation require reauthentication                                                                      |
| `1013`                      | Refresh through the corresponding authentication flow; reauthenticate if it fails, without endless retries                               |
| `1016`, `1017`              | Check replay-protection requirements and the signing session                                                                             |
| `1018`                      | Complete the required two-factor verification                                                                                            |
| `1048`                      | Fetch the password-encryption public key and encrypt again instead of resending old ciphertext                                           |
| `1429` or HTTP 429          | Reduce frequency and follow server waiting information                                                                                   |
| Empty prices or no channels | Check loading errors and catalog grants, then clear filters or show automatic pools; this does not mean the whole platform has no models |

Treat unknown business codes as failures and retain necessary request IDs, HTTP status, and codes for diagnosis. Do not publish credentials or full responses. Bound retries and back off; after a write timeout or disconnect, query the outcome before retrying through an idempotency mechanism supported by that endpoint.

## Related pages

- [SDKs and examples]({{DOCS_BASE_URL}}/en/sdk-examples)
- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
- [OAuth authorization-code example]({{DOCS_BASE_URL}}/en/oauth-demo)
- [AccessKey management]({{DOCS_BASE_URL}}/en/access-key-management)
- [API reference]({{SWAGGER_DOCS_URL}})
