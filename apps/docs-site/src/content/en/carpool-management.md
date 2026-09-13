# Carpool operations

This page is for operators with carpool permissions. Use it to maintain carpool packages, accept submitted orders, and complete delivery or failure refunds.

## Package management

A package defines the deliverable monthly-pass template, quota, validity, member limit, formation deadline, selling price, and cost. You can:

- create, edit, or duplicate a package;
- publish a package so users can create carpools;
- unpublish a package to stop new orders;
- softly archive a package that is no longer used.

The list shows the full-car per-seat selling price, per-seat cost, total cost, and estimated gross margin to support pricing review. Edits, publishing changes, and archival affect **new orders only**. Existing orders continue settlement and delivery using their creation snapshot.

## Order workbench

The workbench prioritizes pending work by default and provides state, keyword, and paginated filters. Open an order to review:

- package and delivery snapshots;
- member allocation, confirmations, and reserved/charged/refunded funds;
- current state, failure reason, and immutable event timeline;
- the selected delivery-channel summary.

Users invite, allocate, and confirm while an order is open. The owner submits the carpool only after all required conditions are met; operations then continues the workflow.

## Accept, deliver, and fail with refund

1. **Accept** a submitted order.
2. Choose an eligible Relay channel within that order and confirm delivery. The channel picker only shows channels the server considers deliverable, and the server checks eligibility again during delivery; a browser cannot bypass this by forging a channel ID.
3. If delivery fails, choose **Fail and refund** and provide a clear failure reason. The reason is stored in the order event history for user and operator review.

Every sensitive operation requires confirmation. Never put Relay tokens, upstream keys, or other credentials in notes, event descriptions, or external tickets.

## Required permissions

| Action                                                           | Required permission      |
| ---------------------------------------------------------------- | ------------------------ |
| View and filter packages                                         | `CARPOOL_TEMPLATE_READ`  |
| Create, edit, duplicate, publish, unpublish, or archive packages | `CARPOOL_TEMPLATE_WRITE` |
| View carpool orders and details                                  | `CARPOOL_ORDER_READ`     |
| Accept, deliver, or fail with refund                             | `CARPOOL_ORDER_FULFILL`  |

## Notes

- The formation deadline is configured per package and defaults to 72 hours. Expiry closes only orders that have not been submitted and releases reserved funds.
- A delivery-failure refund is allowed only from `submitted` or `accepted`, and must retain a failure reason.
- Package cost is an operator-only planning value; the ordinary user experience does not expose upstream cost.
