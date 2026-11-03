# Purchase a monthly pass

Choose a published plan in the **Monthly Pass Purchase Center** tab on My Monthly Passes and redeem it with your balance. After purchase, use the **View My Monthly Passes** tab to review its validity, quota, and supported usage.

## Before purchasing

- The template must be enabled, published and available for balance redemption.
- Review its price, validity, total quota, quota windows and permitted channels and models. A pass does not guarantee coverage for every request; uncovered costs can still be charged to balance. See [My monthly passes]({{DOCS_BASE_URL}}/en/my-monthly-passes).
- Your balance must cover the purchase, and you must remain within the template's per-user purchase limit.
- The balance debit is the discounted price multiplied by the server's current conversion ratio, rounded to four decimal places. The discounted price on the card can differ from the actual debit. Original price, discount, pass quota, and balance debit describe different values.
- Confirmation submits only the template ID and does not lock the card or dialog quote. The server calculates the debit under the rules in effect when it processes the request. Template or conversion-ratio changes can make the actual amount differ from the preview. Review the plan before buying, check the actual debit after success, and ask an administrator about discrepancies.

## Purchase steps

1. Open My Monthly Passes, select **Monthly Pass Purchase Center**, review a plan, and select **Redeem with Balance**.
2. Review the debit information and select **Confirm Redemption**.
3. Check the actual debit amount after success.
4. Reload the page, review the new pass under **View My Monthly Passes**, and check its ledger entry under balance history.

The pass starts immediately on purchase, with validity measured from the purchase time. The purchase page cannot schedule later activation. Buying again creates another pass rather than automatically extending an existing one.

The debit, ledger entry, and new pass succeed together. Free plans neither debit balance nor create a purchase-debit entry. Failed authorization or purchase-limit checks leave no debit or new pass from that attempt. With IAM enforcement, template or conversion-ratio changes during purchase processing can also cause refusal; this does not lock a quote displayed earlier in the page.

Purchase limits count a user's assignments for the same template over the configured number of preceding days, including disabled passes and assignments obtained without balance purchases. Free plans count too. This is a rolling window, without a shared midnight reset; retry when relevant older assignments have left the window.

## IAM permissions

When IAM enforcement is enabled, purchases use `quyan:monthly_pass:ClaimPublishedTemplate` and check all these resources:

| Resource                           | ARN                                                             |
| ---------------------------------- | --------------------------------------------------------------- |
| Current user                       | `acs:quyan:*:<accountId>:user/<userId>`                         |
| Template view for the current user | `acs:monthly-pass:*:<accountId>:template/<userId>/<templateId>` |
| Generated pass                     | `acs:monthly-pass:*:<accountId>:assignment/<userId>/<passId>`   |

Your own purchase resources have baseline self-service authorization; explicit Deny takes priority. A template ARN can restrict a user's purchase of a specific plan, while `assignment/<userId>/*` can restrict pass creation. A template-view ARN does not grant administration of a shared template.

The API is `POST /v1/monthly-passes/me/claim`, with the body `{ "templateId": "<templateId>" }`. The user and account come from the authenticated identity.

Viewing plans uses `quyan:monthly_pass:ListPublishedTemplates` and evaluates each `acs:monthly-pass:*:<accountId>:template/<userId>/<templateId>`. Your published-plan views have baseline self-service authorization. Templates covered by explicit Deny are omitted from the list. Viewing and purchasing are authorized separately: visibility does not guarantee purchase permission, and a purchase Deny does not automatically hide the plan.

## Common issues

- Request timeout or connection interruption: the outcome may be unknown. Reload the page and check **View My Monthly Passes** and balance history before retrying. The pass list loads only the first 100 records and may be filtered by permissions, so a missing pass does not prove the purchase failed. A free plan may also have no debit to check. Contact an administrator if the result remains unclear to avoid buying twice.
- Insufficient balance: check your balance and the converted purchase price.
- Purchase limit reached: wait for the configured purchase window to expire or ask an administrator to review the limit.
- Permission denied: ask an administrator to check identity, template and generated-pass policies, including explicit Deny.
- Plan changed during confirmation: reload the entire page, then review the price and conditions shown in the purchase center. The refresh button at the top updates the header balance and plan data, but does not refresh the plan cards currently shown in the purchase center.

## Related pages

- [My monthly passes]({{DOCS_BASE_URL}}/en/my-monthly-passes)
- [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history)
- [Monthly pass management]({{DOCS_BASE_URL}}/en/monthly-pass-management)
