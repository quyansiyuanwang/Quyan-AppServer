# Chat

This section explains how to use conversations on desktop and mobile.

## Start a conversation

1. Create a conversation and enter a name, or select one from the conversation list.
2. Select an available relay token and model, then enter and send your message.
3. You can stop a response while it is generating. The conversation list also lets you rename or delete conversations.

## Conversation list

### Main purpose

- Switch between conversations and manage history.

### What users can do

- Create a new conversation.
- Rename or delete an existing conversation.
- Select a conversation from the list or mobile drawer.

## Message area

### Main purpose

- Send messages and review replies.

### What users can do

- Send a message with a selected model or token.
- Edit, resend, regenerate, or delete messages.
- Start from the empty state when no conversation exists.

### Selecting a model and billing

- Pick a relay token first; the available model list is automatically filtered to that token's "allowed models" configuration — different tokens can be scoped to different models.
- When switching tokens, the first model in the new token’s list is selected if the current model is unavailable. If the list is empty, you cannot send a message; check the token’s model configuration.
- Usage from sent messages is billed against the selected token's pricing rules and counted toward that token's quota — this is the same usage data shown on the [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management) page.
- Your last-selected token and model are stored locally in the browser. If they are no longer available, the page selects currently available options.

## Mobile notes

- On small screens, the list moves into a drawer.
- The top bar provides quick create and navigation actions.

## Long conversations and capacity limits

Chat checks input size, context message count, total context bytes and answer capacity. Oversized content is rejected explicitly; old context is not silently discarded. An oversized input does not start a response stream; an oversized answer stops without a success-completion marker. Partial answers may still be saved as failed or stopped and settled for incurred usage. Limits depend on server configuration and storage capacity. Retry later when the service is busy.
