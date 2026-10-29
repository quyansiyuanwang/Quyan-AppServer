# Chat

Use Chat to select a relay token and model, exchange messages, and manage conversations. You can also run Agent tasks on a remote machine.

## Before you start

Prepare your own token in [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management) and check that it has available models. The server calculates the model list from the token, channel, and model configuration. If no model is available, check the token's model restrictions and channel configuration, or contact an administrator.

## Start a conversation

1. Create a conversation and enter a name, or select one from the conversation list.
2. Select a relay token and model, enter your message, and select **Send**. Enter also sends the message; Shift+Enter inserts a new line.
3. Wait for the reply to appear progressively. Select **Stop** to end it early.

## Conversation list

- Select, create, rename, or delete conversations in the list. On small screens, open the list button in the top bar to select a conversation in the drawer; the plus button creates a conversation.
- If **Load more** appears at the bottom of the list, select it to see more conversations. Conversations not yet loaded do not appear in the current list.
- Deleting a conversation requires confirmation. After deletion, the conversation and its messages are no longer accessible from the chat list; save any content you need first.

## Edit or delete messages

- Editing or resending a user message uses it as the new point of continuation, removes the messages after it, and requests a new reply. Press Enter to submit an edit or Esc to cancel it.
- Regenerating an assistant reply resends the preceding user message, removes the messages after that user message, and generates a new reply. A preceding user message is required.
- Deleting a message also removes every message after it. Save any content you need to keep before proceeding.
- Editing, resending, and regenerating use the **currently selected token and model** to start a new regular chat request and may incur additional usage and charges. They do not lock in the original reply's selection. Even with Agent mode enabled, these message actions do not create a remote Agent task.

## Selecting a model and billing

- Pick a relay token first, then choose one of its currently available models. Different tokens may provide access to different models.
- When switching tokens, the first model in the new token’s list is selected if the current model is unavailable. If the list is empty, you cannot send a message; check the token’s model configuration.
- Usage from sent messages is billed against the selected token's pricing rules and counted toward that token's quota — this is the same usage data shown on the [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management) page.
- Your last-selected token and model are stored locally in the browser. If they are no longer available, the page selects currently available options.

## Stop output or handle failures

In regular chat, selecting **Stop**, switching to another conversation, or leaving Chat interrupts the current page's request. Reopen the original conversation to see messages saved by the server. Unfinished output does not resume automatically.

After an interruption, reopen the conversation and check its saved content before regenerating or sending again. The input is cleared when you send; a failed request does not automatically restore it. Stopped requests and upstream failures may still be billed for incurred usage. Check [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records) for charges.

## Agent mode

Agent mode uses a remote machine and workspace for conversation tasks. You need an available relay token, model, and workspace; the actions available depend on your account permissions and deployment configuration.

1. Turn on **Agent mode** in the message input and use the settings button to open the remote machine page.
2. Add a machine and connect the remote Agent using the environment variables and startup command shown on the page. The registration token is displayed only after creation; save it securely and do not share it.
3. Create a workspace on the machine page and select its machine. Return to chat, select the workspace, relay token, and model, then send a message.
4. If a task fails, check the error in chat and the machine's connection status and last heartbeat on the machine page.

Before sending, make sure a workspace is selected. Without one, the send button may still be available and the input is cleared, but no task is created. Create or select a workspace, then enter the message again.

In Agent mode, **Stop** stops the page from receiving output but does not guarantee that the remote task has been cancelled. Switching conversations or leaving the page also stops receiving the current output; do not assume the remote task has ended.

## Long conversations and capacity limits

Chat checks input size, context message count, total context bytes, and answer capacity. Limits depend on server configuration and storage capacity.

- If the input or context exceeds a limit, the request is rejected without silently dropping old messages. Shorten the input or start a new conversation before retrying.
- If an answer in regular chat is interrupted by a capacity limit, a partial message may be retained, but the request does not complete successfully and incurs no chat usage charge. This differs from stopping a request or an upstream failure.
- Retry later when the service is busy.

## Related pages

- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
- [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records)
- [My monthly passes]({{DOCS_BASE_URL}}/en/my-monthly-passes)
