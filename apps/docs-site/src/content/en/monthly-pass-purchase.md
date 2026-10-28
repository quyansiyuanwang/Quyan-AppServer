# Purchase a monthly pass

Choose a published plan on the monthly pass purchase page and redeem it with your balance. After purchase, use “My monthly passes” to review its validity, quota and supported usage.

## Before purchasing

- The template must be enabled, published and available for balance redemption.
- Review its price, validity, total quota, quota windows and permitted channels and models.
- Your balance must cover the purchase, and you must remain within the template's per-user purchase limit.
- Price conversion and purchase limits follow current server rules. Template changes may require you to confirm again.

## Purchase steps

1. Open the monthly pass purchase page and select a plan.
2. Review the debit information in the confirmation dialog and confirm.
3. Check the actual debit amount after success.
4. Review the new pass under “My monthly passes” and its ledger entry under balance history.

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

- Insufficient balance: check your balance and the converted purchase price.
- Purchase limit reached: wait for the configured purchase window to expire or ask an administrator to review the limit.
- Permission denied: ask an administrator to check identity, template and generated-pass policies, including explicit Deny.
- Plan changed during confirmation: refresh and review its current price and conditions before purchasing again.

## Related pages

- `my-monthly-passes`
- `balance-history`
- `monthly-pass-management`
