# Chat

This section explains how to use conversations on desktop and mobile.

## Page in this section

- `ChatView.vue`

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
- Switching tokens automatically switches to the first model allowed by the new token if the currently selected model is not in its allowed list.
- Usage from sent messages is billed against the selected token's pricing rules and counted toward that token's quota — this is the same usage data shown on the `relay-token-management` page.
- Your last-selected token and model are saved locally in the browser and restored automatically next time you open the chat page.

## Mobile notes

- On small screens, the list moves into a drawer.
- The top bar provides quick create and navigation actions.

## Long conversations and capacity limits

Chat checks input size, context message count, total context bytes and answer capacity. Oversized content is rejected explicitly; old context is not silently discarded. An oversized input does not start a response stream; an oversized answer stops without a success-completion marker. Partial answers may still be saved as failed or stopped and settled for incurred usage. Limits depend on server configuration and storage capacity. Retry later when the service is busy.
