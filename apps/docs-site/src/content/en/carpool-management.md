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

The operations list uses `quyan:carpool:ListAdminOrders`; operations details use the separate `quyan:carpool:GetAdminOrder`. Both evaluate `acs:platform:*:platform:carpool-order/<orderId>` and require the deployment's global management group qualification for order reads.

Records, pagination totals and state counters include only permitted orders. A selected state filters the table; counters still cover all permitted orders matching the current keyword. Denied orders reveal no names, costs, members or events and do not contribute to counts. List authorization does not grant detail access, and the member-facing `quyan:carpool:GetOrder` does not grant operations details. Refresh and retry if identity or authorization changes during a read.

Accepting an order uses `quyan:carpool:AcceptOrder` against the same order ARN and requires the global management group's order-processing qualification. Only a submitted order can be accepted. Listing, details and acceptance are authorized independently. Changes to identity, policies, qualification or order contents during acceptance refuse the operation and roll back both the state transition and its event. Concurrent acceptance of one order succeeds once.

## Delivery dialog and order changes

When an operator opens the delivery dialog, the page reloads the latest detail by order ID before loading channels allowed by that order snapshot. Confirmation and post-delivery refresh use the same order ID. If the order was already processed, deleted, or changed state, the dialog closes, the list refreshes, and the page asks the operator to refresh and retry. The server still validates existence, the accepted state, the channel snapshot, and channel eligibility.

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

## IAM package authorization

When IAM enforcement is enabled, package administration uses these distinct operations:

| Operation                 | Action                            | Evaluated resources                                         |
| ------------------------- | --------------------------------- | ----------------------------------------------------------- |
| List management templates | `quyan:carpool:ListTemplates`     | Each package template                                       |
| Create                    | `quyan:carpool:CreateTemplate`    | Creation control, source monthly-pass template, new package |
| Edit                      | `quyan:carpool:UpdateTemplate`    | Target package, source monthly-pass template                |
| Duplicate                 | `quyan:carpool:DuplicateTemplate` | Source package, creation control, new package               |
| Publish                   | `quyan:carpool:PublishTemplate`   | Target package                                              |
| Unpublish                 | `quyan:carpool:UnpublishTemplate` | Target package                                              |
| Archive                   | `quyan:carpool:ArchiveTemplate`   | Target package                                              |

Package ARNs use `acs:platform:*:platform:carpool-template/<templateId>`. Source monthly-pass templates use `acs:platform:*:platform:monthly-pass-template/<templateId>`; creation control uses `acs:platform:*:platform:carpool-template-control`. Copies preserve their source package's delivery snapshot. Creation and editing use the currently authorized monthly-pass template.

Page records and totals include only permitted packages. Denied packages expose no names, costs or delivery snapshots. Viewing does not grant editing; updating does not grant publication or archival. Explicit Deny takes priority. Denying the generated resource rolls back creation or duplication.

These templates are shared deployment resources. IAM grants also require the global management group qualification configured by the deployment administrator. An account policy or account-owned group cannot grant that qualification. Refresh and retry if authorization, qualification or source terms change during the operation. Existing orders continue to use their original snapshots.

## Notes

- The formation deadline is configured per package and defaults to 72 hours. Expiry closes only orders that have not been submitted and releases reserved funds.
- A delivery-failure refund is allowed only from `submitted` or `accepted`, and must retain a failure reason.
- Package cost is an operator-only planning value; the ordinary user experience does not expose upstream cost.
