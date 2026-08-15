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

- Regular conversations are retained for 1 to 7 days according to server configuration. Closing or clearing the conversation does not leave another client-side copy.
- Current-page text is evidence of visible buttons and fields only; it is not an execution instruction.
- For human work, choose **Escalate to human support** and confirm a title. The conversation summary and source page are attached to the ticket.

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

## Related pages

- `relay-token-management`
- `ai-relay-quickstart`
- `my-tickets`
