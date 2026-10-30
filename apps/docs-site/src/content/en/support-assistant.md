# AI Support Agent

The AI Support Agent is available from the right-hand tool bar after sign-in. It combines visible controls on the current page with published product documentation to help with navigation, configuration, and API integration. Account-specific work can still be escalated to a human ticket.

## Ask a question and read the answer

1. Open the business page where you need help and check it for information you do not want to send to the model.
2. Open AI Support from the right-hand toolbar. Describe what you want to do, the problem, and any error message.
3. Select the confirmation button beside the input, or press Enter to send. Shift+Enter inserts a new line.
4. Wait for the answer and follow its instructions. When documentation references appear, select them to check the original articles.

While you wait, the window may show Planning, Searching, Reading, and Generating states. A question may require multiple rounds of documentation lookup, up to the limit set by the administrator.

The assistant can provide guidance, but cannot change accounts, permissions, billing, or infrastructure for you.

## Conversation history and page information

- Conversations are retained on the server for 1 to 7 days according to its configuration; saving messages resets the retention period. Closing the window does not delete the server record, which can be loaded when you reopen it. Select **Clear** to delete it. Administrators with the appropriate permission can also view conversations.
- The same user shares one support conversation across business pages. Changing pages does not start a new conversation. Save anything you need before clearing; cleared messages cannot be restored from the support window.
- When you send a question, the page also sends the current page title, address path, and up to 16,000 characters of visible text as context for the model. This can include business information displayed on the page, as well as buttons and fields. Check the page for information you do not want to share before sending. Page text is not treated as an execution instruction.

## Escalate to human support

1. Send a message describing the issue that needs human help. An empty conversation cannot create a valid ticket.
2. Select **Escalate to human support** and enter or confirm the ticket title.
3. After submitting, open [My tickets]({{DOCS_BASE_URL}}/en/my-tickets), find the ticket by its title, and check for replies. The support window does not automatically open the ticket details.

The user and assistant messages currently in the window are submitted as the ticket description, together with the source page; an overly long description is truncated. Ticket reviewers can read this content, so avoid including unnecessary sensitive information. If the submission result is uncertain, check **My tickets** before submitting again to avoid duplicates. If you cannot view your tickets, ask an administrator to check your permissions.

## Use your own Relay quota

An administrator can enable both **Allow users to use their own platform balance** and **Allow users to use Relay Tokens they own**. The user-funded option appears in the support window only when both controls are enabled.

1. Expand **Use your own Relay Token and balance** and turn on **Use my token for this conversation**.
2. Enter the Relay Base URL shown in your console, a model name, and your own Relay Token.
3. Send the message.

The token is not stored in the server-side support conversation. While the panel remains open, the token stays in the input field and is reused for later messages sent in user-funded mode. **Clear** does not empty the token field; remove the token manually when you no longer need it. The server verifies that the token belongs to the signed-in user and that the Base URL is on a trusted platform domain. Both planning and final-answer calls use that token, so normal Relay channel, model, quota, original-client-IP allowlist, and balance rules apply. Use only a token you own and are authorized to use.

## Administrator configuration

Operators with AI Support configuration permission can configure:

- the hosted model, upstream key, and operator prompt;
- requests per rate-limit window;
- maximum Agent rounds (1–8) and final maximum output tokens (128–8192);
- retention, and estimated pricing for the platform-hosted mode;
- whether users may use their own balance and Relay Tokens.

Select **Save** after changing settings. Upstream API keys are never displayed in plaintext: leave the key field empty with the clear checkbox unchecked to keep the existing key, enter a new key to replace it, or select **Clear configured key** to delete it when saving. Avoid entering a new key and selecting clear at the same time; clearing takes precedence. After a successful save, the key input is emptied. Check the **A key is configured; leave blank to retain it** placeholder to confirm its status.

Raising the round or output limit can increase the model calls and cost of a question.

With IAM enforcement enabled, configuration reads and updates require `quyan:support:GetConfig` and `quyan:support:UpdateConfig` respectively on `acs:platform:*:platform:config/support-ai`. Operators must also belong to an active global management group that retains AI Support configuration permission; account-created groups and wildcard policies cannot obtain platform management eligibility. Read permission does not grant updates, and explicit Deny takes precedence. All settings save together: revoked grants, concurrent configuration edits or invalid role sessions reject the entire update rather than leaving partially changed settings. Keys remain encrypted, and audit events record only the names of changed settings.

## Service capacity and stream failures

Support AI shares server resource budgets with chat and relay requests. Busy requests may receive HTTP 429; retry later. Output limits or upstream failures can interrupt an answer. The panel removes the incomplete answer and displays an error, while the question remains in the window. User-funded relay usage is still settled according to relay usage records; a stream failure does not imply a free request.

Input and conversation context use the live server input, message-count and byte budgets. A message count of 0 disables only the count limit. Over-budget requests are rejected without silently deleting or shortening history; clear the support conversation before trying again if needed. Agent prompts and tool results also count toward the context budget.

## Related pages

- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
- [AI relay quick start]({{DOCS_BASE_URL}}/en/ai-relay-quickstart)
- [My tickets]({{DOCS_BASE_URL}}/en/my-tickets)
