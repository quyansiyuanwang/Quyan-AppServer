# Debug

The debug page provides build information and troubleshooting tools, primarily for users with debug access. Viewing backend build information requires `DEBUG_ACCESS`. Check the active environment and account before using the tools.

## Inspect information and authentication

- Build information shows frontend and backend versions, branches, commits, and build times to help identify a deployment.
- The authentication test fetches the current user again. Loading permissions refreshes the current user's permissions, and displaying them opens the loaded list. Clearing permissions removes the browser's permission state; it does not change server-side grants.
- **Clear trusted window** appears only in development mode. It clears the current two-factor trusted window and related device cookie; a later sensitive action may require verification again.
- The OpenAPI buttons use the backend address and documentation path entered on the page to open the API reference or JSON description.

## Test a relay request

Enter a compatible Base URL, API key, model, and message. The test sends a real request from the browser to `Base URL + /chat/completions` and displays the response or error. It sends the key as a Bearer credential to the entered destination and may consume quota or incur charges. Verify the destination is trusted and avoid sending sensitive content. Browser cross-origin restrictions can also cause a request to fail.

## April preview

The preview button enables local preview and opens the home page; simulate starts the preview sequence; close disables the local preview switch. These controls can be used to inspect the interface outside April.

## Related pages

- [Script manager]({{DOCS_BASE_URL}}/en/script-manager)
- [Two-factor authentication]({{DOCS_BASE_URL}}/en/two-factor-authentication)
- [API documentation]({{DOCS_BASE_URL}}/en/api-documentation)
