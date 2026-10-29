# AI Support Agent

The AI Support Agent is available from the right-hand tool bar after sign-in. It combines visible controls on the current page with published product documentation to help with navigation, configuration, and API integration. Account-specific work can still be escalated to a human ticket.

## How the Agent works

Each question can use up to the administrator-configured number of planning rounds. In a round, the assistant may:

- search documentation titles and paths;
- inspect the section outline of matched documents;
- read only a few relevant sections from that outline;
- generate the final answer from the excerpts and current-page evidence.

The full documentation corpus is never sent to the model, and the assistant cannot read an excerpt that was not authorized by both a preceding search result and a document outline. The window shows Planning, Searching, Reading, and Generating states, and lists the documentation actually cited in an answer.

## Conversation and human handoff

- Conversations are retained on the server for 1 to 7 days according to its configuration; saving messages resets the retention period. Closing the window does not delete the server record, which can be loaded when you reopen it. Select **Clear** to delete it. Administrators with the appropriate permission can also view conversations.
- When you send a question, the page also sends the current page title, address path, and up to 16,000 characters of visible text as context for the model. This can include business information displayed on the page, as well as buttons and fields. Check the page for information you do not want to share before sending. Page text is not treated as an execution instruction.
- For human work, describe your issue in the conversation, then choose **Escalate to human support** and confirm a title. The user and assistant messages currently in the window are submitted as the ticket description, together with the source page; an overly long description is truncated. Ticket reviewers can read this content, so avoid including unnecessary sensitive information in the conversation.

The assistant can provide guidance, but cannot change accounts, permissions, billing, or infrastructure for you.

## Use your own Relay quota

An administrator can enable both **Allow users to use their own platform balance** and **Allow users to use Relay Tokens they own**. The user-funded option appears in the support window only when both controls are enabled.

1. Open **Use your own Relay Token and balance**.
2. Enter the Relay Base URL shown in your console, a model name, and your own Relay Token.
3. Send the message.

The token is used for the current request only and is not stored in the support conversation. The server verifies that the token belongs to the signed-in user and that the Base URL is on a trusted platform domain. Both planning and final-answer calls use that token, so normal Relay channel, model, quota, original-client-IP allowlist, and balance rules apply. Use only a token you own and are authorized to use.

## Administrator configuration

Operators with AI Support configuration permission can configure:

- the hosted model, upstream key, and operator prompt;
- requests per rate-limit window;
- maximum Agent rounds (1–8) and final maximum output tokens (128–8192);
- retention, and estimated pricing for the platform-hosted mode;
- whether users may use their own balance and Relay Tokens.

Upstream API keys can only be written, replaced, or cleared; read APIs never return the plain value. Raising the round or output limit can increase the model calls and cost of a question.

With IAM enforcement enabled, configuration reads and updates require `quyan:support:GetConfig` and `quyan:support:UpdateConfig` respectively on `acs:platform:*:platform:config/support-ai`. Operators must also belong to an active global management group that retains AI Support configuration permission; account-created groups and wildcard policies cannot obtain platform management eligibility. Read permission does not grant updates, and explicit Deny takes precedence. All settings save together: revoked grants, concurrent configuration edits or invalid role sessions reject the entire update rather than leaving partially changed settings. Keys remain encrypted, and audit events record only the names of changed settings.

## Related pages

- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
- [AI relay quick start]({{DOCS_BASE_URL}}/en/ai-relay-quickstart)
- [My tickets]({{DOCS_BASE_URL}}/en/my-tickets)

## Service capacity and stream failures

Support AI shares server resource budgets with chat and relay requests. Busy requests may receive HTTP 429; retry later. Output limits or upstream failures can interrupt an answer without a success-completion marker. User-funded relay usage is still settled according to relay usage records; a stream failure does not imply a free request.

Input and conversation context use the live server input, message-count and byte budgets. A message count of 0 disables only the count limit. Over-budget requests are rejected without silently deleting or shortening history; clear the support conversation before trying again if needed. Agent prompts and tool results also count toward the context budget.
