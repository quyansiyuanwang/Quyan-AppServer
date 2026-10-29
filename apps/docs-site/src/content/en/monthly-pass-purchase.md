# Purchase a monthly pass

Choose a published plan in the **Monthly Pass Purchase Center** tab on My Monthly Passes and redeem it with your balance. After purchase, use the **View My Monthly Passes** tab to review its validity, quota, and supported usage.

## Before purchasing

- The template must be enabled, published and available for balance redemption.
- Review its price, validity, total quota, quota windows and permitted channels and models. A pass does not guarantee coverage for every request; uncovered costs can still be charged to balance. See [My monthly passes]({{DOCS_BASE_URL}}/en/my-monthly-passes).
- Your balance must cover the purchase, and you must remain within the template's per-user purchase limit.
- Price conversion and purchase limits follow current server rules. Template changes may require you to confirm again.

## Purchase steps

1. Open My Monthly Passes, select **Monthly Pass Purchase Center**, and choose a plan.
2. Review the debit information in the confirmation dialog and confirm.
3. Check the actual debit amount after success.
4. Reload the page, review the new pass under **View My Monthly Passes**, and check its ledger entry under balance history.

The debit, ledger entry and new pass succeed together. Failed authorization, changed quotes or purchase-limit refusal leave no debit or new pass from that attempt. Free plans remain subject to purchase limits.

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
