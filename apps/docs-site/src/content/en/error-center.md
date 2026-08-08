# Error center

The error center aggregates browser runtime errors, Vue component errors, unhandled promises, and unexpected server errors for investigation by fingerprint.

## Requirements

- The error-report read permission is required to open the page.
- Passwords, tokens, cookies, authorization headers, and secrets are redacted before storage.
- Error details are retained for 90 days and then removed automatically.

## What You Can See

- Source, last-seen time, route, message, occurrence count, and affected users.
- Error status: `open`, `acknowledged`, `resolved`, or `ignored`.
- Stack traces, request IDs, browser version, and bounded context for each fingerprint.

## Investigation Flow

1. Filter by source, status, or a search term.
2. Open a group and inspect recent occurrences and request IDs.
3. Use the request ID in System Logs to follow the request chain.
4. Update the status after the issue is handled.

The client reporting endpoint is rate limited. Dropped reports never affect the original page action.
