# SDKs and examples

Choose an example for the task you need to complete. Confirm the deployment address, credential type, and grants before starting. Platform APIs, AI relay, and Auth Center use separate credentials.

## Choose an integration path

| Your task                                                              | Start with                              | Prepare                                                                     |
| ---------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| Read platform profiles or balance transactions from a backend          | Node.js or Python API examples below    | Backend API address, authorized credential, and target-resource grants      |
| Let users authorize third-party platform API access                    | OAuth authorization-code example        | Registered and approved application, exact callback URI, and minimal scopes |
| Authenticate users for your own system and validate Auth Center tokens | Auth Center integration                 | A separate Auth Center application and its flow configuration               |
| Use Auth Center from a browser SPA                                     | Browser single-page application example | Public client, registered callback URI, and PKCE                            |
| Invoke AI models                                                       | AI relay quick start                    | Relay Base URL, Relay Token, supported model/format, and quota              |

## Call APIs from a backend

- [Node.js API example]({{DOCS_BASE_URL}}/en/node-sdk): create files and configure credentials, then use `fetch` with HTTP/business error handling, timeouts, and request IDs.
- [Python API example]({{DOCS_BASE_URL}}/en/python-sdk): install dependencies and configure credentials, then use `requests` and distinguish connection/read timeouts.
- [API documentation]({{DOCS_BASE_URL}}/en/api-documentation): copy endpoints, compare prices, and choose authentication. Consult the API reference for fields.

Both pages provide copyable HTTP wrappers you can maintain without a platform-specific SDK package. They start with an existing credential and do not log in, refresh, or retry automatically. Verify the profile request first, then enable balance transactions when authorized. Do not test connectivity with administrative writes.

## Third-party authorization

1. Create an application, register a callback URI, and submit it for review in [OAuth app management]({{DOCS_BASE_URL}}/en/oauth-app-management). Obtain approval before integrating.
2. Follow the [OAuth authorization-code example]({{DOCS_BASE_URL}}/en/oauth-demo) to start authorization with PKCE and handle the callback safely.
3. Use the authorized token to call APIs. OAuth scopes, account permissions, and resource permissions can all affect access.

## Auth Center integration

To authenticate users for your own system, start with [Auth Center integration]({{DOCS_BASE_URL}}/en/auth-center-app-management). Create and maintain the application through [Auth Center app management]({{DOCS_BASE_URL}}/en/auth-center-client-management), then choose an example:

- [Auth Center Node SDK]({{DOCS_BASE_URL}}/en/auth-center-node-sdk)
- [Auth Center Python SDK]({{DOCS_BASE_URL}}/en/auth-center-python-sdk)
- [Browser single-page application example]({{DOCS_BASE_URL}}/en/auth-center-browser-spa-example)

Auth Center and OAuth applications are registered separately and use different issuance and verification flows. Do not treat an Auth Center JWT as a platform API login access token or expose a client secret in the browser. Public clients follow the public-client flow with PKCE.

## AI relay integration

Follow [AI relay quick start]({{DOCS_BASE_URL}}/en/ai-relay-quickstart) to create a Relay Token and configure a model client. Platform API `{ code, message, data }` unwrappers do not apply to relay protocols or event streams.

Model requests can incur charges. Check model, format, and quota before calling, then reconcile results in [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records).

## Verify the integration

- Confirm requests target the correct service in this deployment rather than a frontend or documentation site.
- Check HTTP status, response format, and the protocol's success condition; opening a page does not establish API authorization.
- Retain necessary request IDs, status, and business codes for errors. Keep credentials, refresh tokens, client secrets, and full personal profiles out of public logs and version control.
- Handle expiry and revocation through the chosen authentication flow without endlessly retrying permission refusals. After a write disconnect, check the outcome before resubmitting.
