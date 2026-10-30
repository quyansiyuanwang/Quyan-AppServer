# Carpools

Carpools let you purchase deliverable monthly-pass quota with trusted friends through a **private invitation**. This is not a public marketplace: only people invited by the owner can join.

## Guided page flow

In **My carpools**, follow “choose a package → invite members → member confirmation → submit to depart → delivery complete”. The order list shows the current state and next action. Open the order details to check member shares, confirmations, and the event timeline.

The invitation page does not guess order details before acceptance. After signing in, accept the invitation; the server validates it and returns an order summary before you continue to the detail page.

## Before you start

- The package, quota, validity, maximum members, and formation deadline shown on the page are the current server configuration.
- When an order is created, its price, quota, validity, model and channel restrictions, monthly-pass template, and formation deadline are saved as an order snapshot. Later package edits do not change existing orders.
- Accepting an invitation does not charge you immediately. After you confirm your share, only your payable amount is reserved until the order advances or closes.
- After signing in, you still need the relevant package, order, and operation permissions. An invitation lets you join a specific order; it does not grant account permissions. Seeing an order or button does not authorize every action. Contact an administrator if permission is denied.

## Create and invite

1. Choose a published package in **My carpools** and create a carpool.
2. Review the formation deadline, member count, and estimated full-car equal split.
3. The owner generates an invitation link from the order detail and selects 1, 24, or 72 hours; the default is 24 hours. If the formation deadline is earlier, the link expires at that deadline.
4. Send the link to a trusted member. Each invitation can be accepted once; generate a separate link for each member. Historical invitation links are not displayed again in the order timeline. If automatic copying fails, copy the link manually from the dialog.

The invitation page explains the next action after joining. You cannot join if the link has expired or been used, or if the order is full or closed. Expired and used links may show the same invalid-invitation message. If the acceptance request is interrupted or its result is uncertain, return to **My carpools** and refresh the order list. Check the state filter, search terms, and other pages to see whether you already joined before asking the owner for another invitation.

## Allocation and confirmation

The default is an **equal split**: payment and quota ratios are recalculated for every active member by the server. The per-person price on a package card assumes the maximum member count; check your share in the order details for the actual payable amount. For example, a package priced at 100 with up to four members shows an estimate of 25 per person. With only two current members, each pays 50 under an equal split. When someone joins or leaves, previous confirmations are cleared and each member must confirm again.

The owner may open **advanced custom allocation** and set payment and quota ratios separately. Each set must total exactly 100%. Saving a custom allocation releases prior reservations, clears all confirmations, and asks members to reconfirm. When a member joins or leaves under custom allocation, reservations and confirmations are cleared, but ratios are not automatically redistributed; the owner should review and adjust them as needed. Switching back to equal allocation immediately recalculates the ratios, releases reservations, and clears confirmations, so members must confirm again.

After entering custom mode and editing the ratios, select **Save allocation** to submit the changes. Until then, the payable amounts and quotas shown are the previously saved results. After saving and reloading successfully, check each member’s amount, quota, and confirmation status before asking members to confirm. If saving or reloading fails, reopen the order details and check the server state before continuing.

Before the deadline:

- Each member confirms their own share; the system reserves that member's payable amount.
- A non-owner member who has not confirmed may leave. A confirmed member cannot leave directly; ask the owner to adjust the allocation first, resetting confirmations and releasing reservations, then leave.
- Only the owner may cancel an open carpool; cancellation releases all amounts that have not been charged.
- After the formation deadline, an unsubmitted order no longer accepts invitations, confirmations, or submission. A background process periodically closes expired orders and releases reservations, so the status and amounts may update later. Refresh to check them; contact an administrator if reservations remain unreleased.

## Submit and delivery

Once every active member has confirmed and both the payment and quota ratios total 100%, the owner can submit the carpool without waiting to reach the maximum member count. Submission deducts each reserved share from the member’s balance. If a balance has changed and the deduction cannot be made, submission fails; follow the displayed instructions. Operations then accepts the order and purchases and delivers it; the page shows the current stage and next step.

After delivery, each participating member receives their own monthly pass and Relay Token, with quota based on their confirmed share. The monthly pass validity starts at delivery, rather than order creation, share confirmation, or submission. Use the monthly-pass and Relay Token links in the order details to view these resources. The carpool page shows only a channel or delivery summary; it **never displays the Relay token in plaintext**.

After submission, neither members nor the owner can leave, cancel the order, or request a refund themselves. Waiting for acceptance or delivery does not trigger an automatic refund. If operations confirms that delivery is impossible, an authorized operator must mark the order as failed and refund each member's captured payment to their own balance. Check the failure reason and timeline in the order details and verify the refund in balance history. Delivered orders cannot use this failure-refund flow.

## When an operation has an uncertain outcome

The detail page reloads after confirming a share, leaving, cancelling, or submitting. If the request is interrupted, or the detail reload fails after a success message, the page may still show the old state. Reopen the order and check its status, member confirmations, and reserved amounts; if a debit was involved, also check the balance and transaction history. Decide whether to retry only after checking the result. If it remains unclear, contact an administrator to avoid repeating the operation.

## Related pages

- [My monthly passes]({{DOCS_BASE_URL}}/en/my-monthly-passes)
- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
