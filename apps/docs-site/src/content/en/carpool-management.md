# Carpool operations

Operators maintain purchasable packages in **Carpool package management** and use **Carpool operations workspace** to accept submitted orders, deliver resources, or refund failed orders.

## Before you start

- Opening package management requires `CARPOOL_TEMPLATE_WRITE`; querying packages also requires `CARPOOL_TEMPLATE_READ`. Creation and editing require an available monthly-pass template that you may reference.
- Opening order management requires `CARPOOL_ORDER_READ`. Acceptance, delivery-channel queries, delivery, and failure refunds also require `CARPOOL_ORDER_FULFILL`.
- With IAM enforcement enabled, each operation also needs its Action and resource grants, plus the global management group qualification configured by the deployment administrator. An account policy or account-owned group cannot grant that qualification. A visible button does not authorize an operation.

## Create and publish a package

1. Open **Carpool package management** and select **Create package**.
2. Enter the name and description and choose a **Delivery monthly-pass template**. Quota, validity, quota unit and window, and model and channel restrictions come from that template.
3. Set the total selling price, total cost, member limit, and formation deadline. Check the full-car estimate and select **Save**.
4. The new package is saved as a draft. Review it and select **Publish** in the list before users can create orders from the catalog.

| Setting                | Range or meaning                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Name and description   | Name is required, up to 100 characters; description is up to 1000 characters                                                    |
| Selling price and cost | Price must be positive; cost cannot be negative. The form accepts up to four decimal places                                     |
| Member limit           | 1–100 members; the create form defaults to two                                                                                  |
| Formation deadline     | An integer from 1–720 hours, default 72; measured from user order creation                                                      |
| Full-car estimate      | Per-seat price and cost use the member limit; total gross margin is selling price minus cost. Actual shares depend on the order |

Cost is for operator planning and is not shown to ordinary users. The monthly-pass selector loads the first batch of up to 100 permitted templates. If a template is missing, check its status, read permission, and list range before proceeding.

## Edit, copy, or stop sales

- **Edit** and save changes. Saving reads the selected monthly-pass template's current delivery configuration again. Check quota, validity, and restrictions even when changing only the price.
- **Duplicate** creates a new draft with the source package's delivery snapshot. Review and edit it as needed before publication.
- **Take offline** changes a package to “Draft / offline” and stops new orders from the catalog. It can be published again later.
- **Archive** removes the package from the management list and user catalog after confirmation. The page has no restore action; check before confirming.

Package creation or editing saves a delivery snapshot; user order creation then saves an order snapshot. Later template changes do not automatically update the package snapshot. Editing, unpublishing, or archiving a package does not change existing orders' prices, quotas, validity, or restrictions, or automatically cancel or refund them.

Package searches match name and description. Press Enter or select **Search** after entering or clearing the keyword. Changing publication status queries again from page one.

## Find orders to process

1. Open **Carpool operations workspace** and select the awaiting-acceptance or delivery-in-progress state.
2. To locate an order, search by package name, order ID, or owner username, then press Enter or select **Search**. Changing state queries immediately from page one. Clearing the keyword still requires a search.
3. Open **Details** and check the state, formation deadline, total quota and selling price, member states, payable and reserved amounts, and timeline. Failed orders also show a failure reason.

The default query includes all states, so completed orders may appear alongside pending work. Use the state filter to find work to process. State counters cover orders matching the current keyword, before the table's state filter. With IAM enforcement, records, totals, and counters include only permitted orders. List and detail access are granted separately.

A reserved amount of zero does not prove that no payment was taken: submission converts reservations into debits, and refunded amounts are no longer reserved. Check order state, events, and members' balance history to establish the funds outcome.

## Accept and deliver

1. Select **Accept** on an order awaiting acceptance and confirm. The order moves to delivery in progress. Users were charged at submission; acceptance does not charge again.
2. After completing procurement and delivery preparations, select **Complete purchase and deliver** for that order. The dialog reloads the latest order before querying channels allowed by its snapshot.
3. Search channels by name or ID and check other pages as needed. Choose an eligible channel: it must be enabled, approved, have provider service enabled, and satisfy the order's channel restrictions.
4. Check the order and selected channel, select **Complete purchase and deliver**, and confirm again. Success marks the order fulfilled and gives each participating member their own monthly pass and Relay Token. Monthly-pass validity starts at delivery.

If no channel is available, check search terms, other pages, channel status, snapshot restrictions, and permissions. Editing a package does not relax an existing order's restrictions. Order or channel changes before delivery can cause refusal; reopen and check the order before proceeding. Later disabling or unpublishing a source template does not alter the order's original delivery shares.

## Refund a failed order

Failure refunds are available only before delivery, from the awaiting-acceptance or delivery-in-progress state. They cannot reverse a fulfilled order.

1. Once you confirm that delivery is impossible, select **Fail and refund** on the target order.
2. Enter a nonblank reason of 1–1000 characters and confirm. Members can see this reason, so explain the business issue without including Relay tokens, upstream keys, or other credentials.
3. Success closes the order as failed and returns each participating member's captured payment to their own balance. Check the reason, timeline, and relevant balance history.

Waiting for processing or passing the formation deadline does not automatically refund a submitted order. Background expiry only closes unsubmitted orders and releases reservations. Disabled member accounts can still receive refunds of their captured payments.

## Operation permissions and IAM resources

Each Action below has the prefix `quyan:carpool:` and is authorized separately. Read, acceptance, or channel-query access does not automatically grant delivery or refund access.

| Operation                      | Action suffix                                             | Main resource scope                                                                                    |
| ------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Package list                   | `ListTemplates`                                           | Permitted packages                                                                                     |
| Create or edit                 | `CreateTemplate`, `UpdateTemplate`                        | Creation control or target package, source monthly-pass template; creation also checks the new package |
| Duplicate                      | `DuplicateTemplate`                                       | Source package, creation control, new package                                                          |
| Publish, unpublish, archive    | `PublishTemplate`, `UnpublishTemplate`, `ArchiveTemplate` | Target package                                                                                         |
| Order list, detail, acceptance | `ListAdminOrders`, `GetAdminOrder`, `AcceptOrder`         | Target order                                                                                           |
| Delivery-channel query         | `ListDeliveryChannels`                                    | Selected order and candidate channels                                                                  |
| Delivery                       | `FulfillOrder`                                            | Order, channel, source package and monthly-pass template, each recipient, new passes and Relay tokens  |
| Failure refund                 | `FailOrder`                                               | Order, each participating user and balance account, new refund transactions                            |

Resources share the deployment ARN prefix `acs:platform:*:platform:`. Common suffixes are `carpool-template/<templateId>`, `carpool-template-control`, `monthly-pass-template/<templateId>`, `carpool-order/<orderId>`, `relay-channel/<channelId>`, `user/<userId>`, `balance-account/<userId>`, `balance-transaction/<userId>/<transactionId>`, `monthly-pass/<userId>/<passId>`, and `relay-token/<userId>/<tokenId>`.

Member-facing detail access does not grant operator detail access. Explicit Deny takes priority. If any resource required for delivery or refund is denied, the whole attempt fails; delivery and refunds succeed for all affected members together.

## Failed operations and uncertain outcomes

Old list or detail data may remain after a refresh failure. After a timeout, a success notice followed by a refresh failure, or an order-changed warning, query the order's state and timeline again. Also check balance history for refunds. Establish the result before retrying; a refresh failure alone is not a reason to repeat delivery or refund. Contact the deployment administrator if permissions, management qualification, or channel conditions have changed.

## Related pages

- [Carpools]({{DOCS_BASE_URL}}/en/carpools)
- [Monthly pass management]({{DOCS_BASE_URL}}/en/monthly-pass-management)
- [Balance history]({{DOCS_BASE_URL}}/en/balance-history)
