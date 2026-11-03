# Chat

Use Chat to select a relay token and model, exchange messages, and manage conversations. The Agent controls support machine and workspace setup; this version cannot complete remote tasks through Chat.

## Before you start

After signing in, you need the relevant permissions to view, create, and send to conversations and manage messages. These operations are authorized separately; opening the page does not authorize every action.

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

- Editing or resending a user message preserves earlier messages, removes the messages after it, and requests a new reply. Press Enter to submit an edit or Esc to cancel it.
- Regenerating an assistant reply resends the immediately preceding user message, removes the messages after that user message, and generates a new reply. The previous message must be a user message.
- Deleting a message also removes every message after it. Save any content you need to keep before proceeding.
- Editing, resending, and regenerating use the **currently selected token and model** to start a new regular chat request and may incur additional usage and charges. They do not lock in the original reply's selection. Even with Agent mode enabled, these message actions do not create a remote Agent task.

## Selecting a model and billing

- Pick a relay token first, then choose one of its currently available models. Different tokens may provide access to different models.
- When switching tokens, the first model in the new token’s list is selected if the current model is unavailable. If the list is empty, you cannot send a message; check the token’s model configuration.
- Regular chat usage is billed against the selected token's pricing rules and counted toward that token's quota — this is the same usage data shown on the [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management) page.
- Your last-selected token and model are stored locally in the browser. If they are no longer available, the page selects currently available options.

## Stop output or handle failures

In regular chat, selecting **Stop**, switching to another conversation, or leaving Chat interrupts the current page's request. Reopen the original conversation to see messages saved by the server. Unfinished output does not resume automatically.

After an interruption, reopen the conversation and check its saved content before regenerating or sending again. The input is cleared when you send; a failed request does not automatically restore it. Stopped requests and upstream failures may still be billed for incurred usage. Check [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records) for charges.

## Agent mode

**Current availability: you can register remote machines and create workspaces, but Chat tasks cannot complete remote execution yet.** Submitted Agent tasks in this version show “Remote Agent runtime is not connected”. An online machine or ready workspace does not establish task execution availability. Turn off Agent mode to use regular chat and ask an administrator about feature availability instead of repeatedly recreating machines or submitting tasks.

To prepare a machine and workspace:

1. Turn on **Agent mode** in the message input and use the settings button to open **AI Agent machines**.
2. Select **Add machine** and enter a name of up to 120 characters. Save the registration token immediately after creation; the list cannot reveal it again after the dialog closes. If copying fails, copy the input field manually.
3. Prepare the remote Agent program on a machine you control, then connect using the dialog's environment variables and command. The startup command requires an installed remote Agent and does not download it. Replace the machine-ID placeholder with a unique identifier and use the reachable endpoint supplied by your deployment administrator. Keep the token secure because it authorizes machine connections.
4. On the machine page, select **Create workspace**, enter a name of up to 120 characters, and choose its machine. Check machine status, last heartbeat, and workspace status. Creation success does not establish readiness: `provisioning` means preparation or connection is pending; `failed` means preparation failed.

Viewing and creating machines or workspaces, and removing machines, require the relevant permissions. Running tasks and reading their output require separate grants. Removing a machine requires confirmation and revokes its future connections. The page has no restore action; check before removing it. Removal does not uninstall the program on the remote machine.

The workspace list loads when you enter Chat. Reopen Chat if a newly created workspace is missing. The input's **Create workspace** shortcut appears only when there are no workspaces. With exactly one visible machine it can create a workspace directly; otherwise it opens machine setup.

Before sending, make sure a workspace is selected. Without one, the send button may still be available and the input is cleared, but no task is created. Message drafts displayed for the current failed task are not saved as regular chat messages. Copy anything you need instead of relying on reopening the conversation.

In Agent mode, **Stop** only stops receiving output on the current page; it does not send a task cancellation request. Switching conversations or leaving the page also stops receiving output and does not prove cancellation. The current Chat interface has no task-approval controls either.

## Long conversations and capacity limits

Chat checks input size, context message count, total context bytes, and answer capacity. Limits depend on server configuration and storage capacity.

- If the input or context exceeds a limit, the request is rejected without silently dropping old messages. Shorten the input or start a new conversation before retrying.
- If an answer in regular chat is interrupted by a capacity limit, a partial message may be retained, but the request does not complete successfully and incurs no chat usage charge. This differs from stopping a request or an upstream failure.
- Retry later when the service is busy.

## Related pages

- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
- [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records)
- [My monthly passes]({{DOCS_BASE_URL}}/en/my-monthly-passes)
