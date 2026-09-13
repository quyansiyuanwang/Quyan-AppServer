# Carpools

Carpools let you purchase deliverable monthly-pass quota with trusted friends through a **private invitation**. This is not a public marketplace: only people invited by the owner can join.

## Before you start

- The package, quota, validity, maximum members, and formation deadline shown on the page are the current server configuration.
- When an order is created, its price, cost, quota, model and channel restrictions, monthly-pass template, and formation deadline are saved as an order snapshot. Later package edits do not change existing orders.
- Accepting an invitation does not charge you immediately. After you confirm your share, only your payable amount is reserved until the order advances or closes.

## Create and invite

1. Choose a published package in **My carpools** and create a carpool.
2. Review the formation deadline, member count, and estimated full-car equal split.
3. The owner generates an invitation link from the order detail and chooses how long the link remains valid. An invitation cannot outlive the order formation deadline.
4. Send the link to trusted members. Historical invitation links are never displayed again in the order timeline.

The invitation page explains the next action after joining. It also explains why joining is unavailable when a link is expired or used, the order is full, or the order is closed.

## Allocation and confirmation

The default is an **equal split**: payment and quota ratios are recalculated for every active member by the server. When someone joins or leaves, previous confirmations are cleared and each member must confirm again.

The owner may open **advanced custom allocation** and set payment and quota ratios separately. Each set must total exactly 100%. Saving a custom allocation releases prior reservations, clears all confirmations, and asks members to reconfirm.

Before the deadline:

- Each member confirms their own share; the system reserves that member's payable amount.
- An unconfirmed member may leave, which releases their reservation.
- Only the owner may cancel an open carpool; cancellation releases all amounts that have not been charged.
- After the formation deadline, an unsubmitted order closes automatically and releases reservations.

## Submit and delivery

Once every active member has confirmed and the package member requirement is met, the owner can submit the carpool. Operations then accepts the order and purchases and delivers it; the page shows the current stage and next step.

After delivery, members can use their normal monthly-pass and Relay Token secure entry points. The carpool page shows only a channel or delivery summary; it **never displays the Relay token in plaintext**.

If delivery fails, the system records a reason and refunds through the order's funds workflow. Check the order detail for the reason and event timeline.

## Related pages

- `my-monthly-passes`
- `relay-token-management`
