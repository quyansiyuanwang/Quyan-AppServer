# SDK & Examples

This hub page helps integrators pick the right template without mixing all examples into one long document.

## How to choose

### `Quyan-ServerSDK` layout

Best for:

- integrators who want a runnable sample project first
- teams that want to choose the right SDK or demo by integration style
- workflows where a full example is easier to start from than a small snippet

Includes:

- scenario-based SDK or demo selections
- more complete project samples than the short snippets in this docs site
- integration templates that can be used as a starting point
- current OAuth paths such as `ServerSDK/demos/oauth/node/`, `ServerSDK/sdks/oauth/node/`, `ServerSDK/sdks/oauth/python/`, `ServerSDK/sdks/oauth/java/`, and `ServerSDK/sdks/oauth/go/`

### `Node SDK`

Best for:

- Node.js backends
- TypeScript / JavaScript API integrations
- Server-side business API calls

Includes:

- Minimal direct API example for Node
- Suggested environment variables
- Small server-side calling patterns

### `Python SDK`

Best for:

- Python backends
- automation scripts
- internal integration services

Includes:

- Minimal direct API example for Python
- `requests` template
- timeout and error-handling suggestions

### `OAuth Demo`

Best for:

- third-party login
- OAuth account linking
- teams that need a full authorization-code demo

Includes:

- OAuth sequence diagram
- OAuth flowchart
- minimal Node OAuth demo
- minimal Python OAuth demo

### `Auth Center App Management`

Best for:

- teams exposing this platform as their authentication center
- JWT + JWKS verification designs
- dual-token access + refresh flows
- review and app-registration workflows

Includes:

- Auth Center vs OAuth differences
- short-token and refresh-token behavior
- `client_credentials` no-refresh-token rule
- app registration and review guidance

### `Auth Center Node SDK`

Best for:

- Node.js backends verifying JWT access tokens locally
- code exchange and refresh handling on a trusted server
- machine-to-machine integrations using `client_credentials`

### `Auth Center Python SDK`

Best for:

- Python services verifying JWT access tokens locally
- automation and backend integrations
- refresh-token exchange from server-side code

### `Auth Center Browser / SPA Example`

Best for:

- browser-first applications
- public clients using PKCE
- teams deciding where refresh tokens should be stored

Includes:

- PKCE helper code
- callback handling example
- backend exchange recommendation
- browser security boundaries

## Suggested reading order

0. If you prefer starting from a full runnable project, start with the `Quyan-ServerSDK` layout and choose the matching SDK or demo there.
1. Start with `OAuth App Management` to create the app and register redirect URIs.
2. Continue with `OAuth Demo` to run the authorization-code flow end to end.
3. If you only need business API access, go directly to `Node SDK` or `Python SDK`.
4. Use `API Documentation` and Swagger for exact field-level details.
5. If you are building an authentication-center integration, read `Auth Center App Management` first, then choose the Node, Python, or Browser example.

## Minimum integration checklist

1. Confirm the environment base URL and Swagger URL.
2. Choose the auth method: JWT, Access Key, or OAuth.
3. Test one endpoint with `curl` first.
4. Then implement the matching language template.
5. If using third-party login, create the OAuth app and register the redirect URI first.
6. If using the auth center mode, confirm whether your app is `public` or `confidential`, then implement JWKS verification before going live.

## Recommended follow-up reading

- `Quyan-ServerSDK`
- `Node SDK`
- `Python SDK`
- `OAuth Demo`
- `API Documentation`
- `OAuth App Management`
- `Auth Center App Management`
- `Auth Center Node SDK`
- `Auth Center Python SDK`
- `Auth Center Browser / SPA Example`
