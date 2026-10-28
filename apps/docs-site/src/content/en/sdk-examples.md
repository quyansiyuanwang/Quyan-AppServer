# SDKs and examples

Choose an example for your integration. Before starting, confirm your deployment's API address, authentication method, and required permissions.

## Call APIs from a backend

- [Node SDK](/en/node-sdk): call APIs from Node.js and handle responses and errors.
- [Python SDK](/en/python-sdk): call APIs from Python and handle responses and errors.
- [API documentation](/en/api-documentation): learn about addresses, authentication, requests, and error handling. Use the API reference for endpoint fields.

These pages provide integration code examples. Keep tokens in server-side environment variables or other secure storage and out of version control.

## Third-party authorization

1. Create an application, register a callback URI, and submit it for review in [OAuth app management](/en/oauth-app-management).
2. Follow the [OAuth authorization-code example](/en/oauth-demo) to start authorization with PKCE and handle the callback safely.
3. Use the authorized token to call APIs. OAuth scopes, account permissions, and resource permissions can all affect access.

## Auth Center integration

To use this platform as an authentication center for a third-party system, start with [Auth Center integration](/en/auth-center-app-management), then choose an example:

- [Auth Center Node SDK](/en/auth-center-node-sdk)
- [Auth Center Python SDK](/en/auth-center-python-sdk)
- [Browser single-page application example](/en/auth-center-browser-spa-example)

Auth Center and OAuth integrations use different token and verification flows; follow the guide for your chosen integration.
