# User manual

This is the public bilingual user manual for the site. The layout keeps the rhythm of an API docs portal, but the content is written as a screen-by-screen guide for end users.

## How this manual is organized

- One Vue page corresponds to one manual page.
- Each page explains visible sections, common actions, and practical notes.
- API-style reference content is still included as dedicated pages such as `api-documentation`.

## How to use it

1. Search from the left sidebar.
2. Open the exact page you are using in the product.
3. Switch language without losing the current manual page.
4. Copy the page link when you need to share guidance.

## Multi-site navigation

The application uses separate site addresses by responsibility: `developer` and `terminal` are product entry sites; account settings, billing, and tickets stay on the account site; `console`, `ai.console`, `developer.console`, `terminal.console`, and `ram.console` are user consoles; `management` and its product subdomains are for operations. The site switcher in the upper-left opens the full feature overview and takes each feature to its canonical address.

On desktop after signing in, a bottom-aligned quick-action icon rail appears on the right. It shows permission-aware self-service, online tools, ticket, and documentation entries; hover an icon to see its name. The final arrow hides the rail completely and leaves only an expand button at the lower-right edge; drag that button vertically or select it to restore the rail. A cross-site entry opens its canonical site address directly.

Hover the avatar in the top bar to open the account menu, which shows the account name, account ID, and current balance. Select the account name or ID to copy it, or select the balance area to open balance history.

Known legacy links, or known pages opened on the wrong site, automatically move to the correct page while retaining filters and anchors. An unrecognized address still shows the not-found page.

## What is covered

- Login, verification, and password recovery
- Home, chat, settings, and notification pages
- Balance, monthly passes, relay tokens, and relay settings
- Admin, system, logs, OJ, and API reference pages
- Reviewer and operations pages such as app review, Auth Center review, and user online monitoring

## Search tips

- Search by page name.
- Search by tags such as `balance`, `relay`, or `permission`.
- Search by a concrete task such as reset, copy, publish, or verify.

## Quick links

- App: {{APP_BASE_URL}}
- API docs: {{SWAGGER_DOCS_URL}}
- User manual: {{DOCS_BASE_URL}}

## SDK and demo entry points

- If you only need to call the API quickly, start with `Node SDK`, `Python SDK`, or `OAuth Demo` inside this docs site.
- If you want runnable projects, integration templates, or a broader example collection, start with `integrations/server-sdk` in this workspace.
- `integrations/server-sdk` provides OAuth SDKs and demos by scenario, such as `integrations/server-sdk/demos/oauth/node/` for a full browser flow and `integrations/server-sdk/sdks/oauth/*` for multi-language server-side integration templates.

## Example route

```text
{{DOCS_BASE_URL}}/zh-CN/login-register
```
