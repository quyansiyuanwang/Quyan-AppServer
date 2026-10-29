# Carpools

Carpools let you purchase deliverable monthly-pass quota with trusted friends through a **private invitation**. This is not a public marketplace: only people invited by the owner can join.

## Guided page flow

The My carpools page presents the flow as “choose a package → invite members → member confirmation → submit to depart → delivery complete”. The order list highlights its current state and next action; mobile uses stacked cards while the detail page remains the source of truth for server state.

The invitation page does not guess order details before acceptance. After signing in, accept the invitation; the server validates it and returns an order summary before you continue to the detail page.

## Before you start

- The package, quota, validity, maximum members, and formation deadline shown on the page are the current server configuration.
- When an order is created, its price, cost, quota, model and channel restrictions, monthly-pass template, and formation deadline are saved as an order snapshot. Later package edits do not change existing orders.
- Accepting an invitation does not charge you immediately. After you confirm your share, only your payable amount is reserved until the order advances or closes.

## Create and invite

1. Choose a published package in **My carpools** and create a carpool.
2. Review the formation deadline, member count, and estimated full-car equal split.
3. The owner generates an invitation link from the order detail and selects 1, 24, or 72 hours; the default is 24 hours. If the formation deadline is earlier, the link expires at that deadline.
4. Send the link to a trusted member. Each invitation can be accepted once; generate a separate link for each member. Historical invitation links are not displayed again in the order timeline. If automatic copying fails, copy the link manually from the dialog.

The invitation page explains the next action after joining. You cannot join if the link has expired or been used, or if the order is full or closed. Expired and used links may show the same invalid-invitation message.

## Allocation and confirmation

The default is an **equal split**: payment and quota ratios are recalculated for every active member by the server. When someone joins or leaves, previous confirmations are cleared and each member must confirm again.

The owner may open **advanced custom allocation** and set payment and quota ratios separately. Each set must total exactly 100%. Saving a custom allocation releases prior reservations, clears all confirmations, and asks members to reconfirm. When a member joins or leaves under custom allocation, reservations and confirmations are cleared, but ratios are not automatically redistributed; the owner should review and adjust them as needed. Switching back to equal allocation immediately recalculates the ratios, releases reservations, and clears confirmations, so members must confirm again.

Before the deadline:

- Each member confirms their own share; the system reserves that member's payable amount.
- A non-owner member who has not confirmed may leave. A confirmed member cannot leave directly; ask the owner to adjust the allocation first, resetting confirmations and releasing reservations, then leave.
- Only the owner may cancel an open carpool; cancellation releases all amounts that have not been charged.
- After the formation deadline, an unsubmitted order closes automatically and releases reservations.

## Submit and delivery

Once every active member has confirmed and both the payment and quota ratios total 100%, the owner can submit the carpool. Submission deducts each reserved share from the member’s balance. If a balance has changed and the deduction cannot be made, submission fails; follow the displayed instructions. Operations then accepts the order and purchases and delivers it; the page shows the current stage and next step.

After delivery, members can use their normal monthly-pass and Relay Token secure entry points. The carpool page shows only a channel or delivery summary; it **never displays the Relay token in plaintext**.

If delivery fails, the system records a reason and refunds through the order's funds workflow. Check the order detail for the reason and event timeline.

## Related pages

- [My monthly passes]({{DOCS_BASE_URL}}/en/my-monthly-passes)
- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
