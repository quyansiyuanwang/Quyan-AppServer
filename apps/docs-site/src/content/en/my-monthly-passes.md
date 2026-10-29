# My monthly passes

Review the monthly-pass benefits assigned to your account, or switch to **Monthly Pass Purchase Center** to purchase a published plan.

## Page purpose

- See active, pending, or expired passes.
- Review quota totals and remaining usage.
- Check validity windows and channel/model limits.

## What you will see

### Pass list

- Pass name or template name.
- Status badge.
- Validity start and end time.
- Remaining, used, and total quota.

### Limits and availability

- Daily quota.
- Allowed channels.
- Allowed models.
- Mobile-friendly card layout when space is limited.

## Common actions

1. Reload the entire page if a new pass is missing. The top refresh button updates the header balance, but does not refresh the assigned-pass list or the purchase center plan cards.
2. Filter by status to distinguish active, pending, expired, and disabled passes.
3. Compare remaining quota with recent usage before heavy workloads.
4. Check allowed channels and models before troubleshooting a request restriction.

## Notes

- A pass can be visible before it becomes active if it has a future start time.
- Quota limits can apply to both the full pass period and daily windows.
- A `-` in the header balance can mean a zero balance or a failed balance lookup. Check the actual amount in [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history).
- If something looks wrong, compare this page with balance and usage history.
- The page currently loads only the first 100 assigned passes; the status filter applies to those loaded records.
- A failed pass-list load shows an error; an initial failure may also leave the list empty. Reload the page and confirm it loads successfully before concluding there are no passes.

## IAM permissions

With IAM enforcement enabled, My Monthly Passes authorizes each `acs:monthly-pass:*:<accountId>:assignment/<userId>/<passId>` using `quyan:monthly_pass:ListMyPasses` and never reads another user's assignments. Your own assignment, template and usage children are readable by default, with explicit Deny taking precedence. Template details use `acs:monthly-pass:*:<accountId>:template/<userId>/<templateId>`. Window usage requires every related `acs:monthly-pass:*:<accountId>:usage/<userId>/<passId>/<usageId>` to be allowed. Denied template details or window counters remain empty while an allowed assignment's own quotas remain visible.

## Related pages

- [Purchase a monthly pass]({{DOCS_BASE_URL}}/en/monthly-pass-purchase)
- [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history)
- [Monthly pass management]({{DOCS_BASE_URL}}/en/monthly-pass-management)
