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
- If you want runnable projects, integration templates, or a broader example collection, start with the `Quyan-ServerSDK` layout in this workspace.
- `Quyan-ServerSDK` is intended to provide the most suitable SDK or demo by scenario, such as `ServerSDK/demos/oauth/node/` for a full browser flow and `ServerSDK/sdks/oauth/*` for multi-language server-side integration templates.

## Example route

```text
{{DOCS_BASE_URL}}/zh-CN/login-register
```
