# My monthly passes

Use this page to review monthly-pass benefits already assigned to your account.

With IAM enforcement enabled, My Monthly Passes authorizes each `acs:monthly-pass:*:<accountId>:assignment/<userId>/<passId>` using `quyan:monthly_pass:ListMyPasses` and never reads another user's assignments. Your own assignment, template and usage children are readable by default, with explicit Deny taking precedence. Template details use `acs:monthly-pass:*:<accountId>:template/<userId>/<templateId>`. Window usage requires every related `acs:monthly-pass:*:<accountId>:usage/<userId>/<passId>/<usageId>` to be allowed. Denied template details or window counters remain empty while an allowed assignment's own quotas remain visible.

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

1. Refresh the list when a new pass should have appeared.
2. Filter by status to separate active and expired passes.
3. Compare remaining quota with recent usage before heavy workloads.
4. Check allowed channels and models before troubleshooting a request restriction.

## Notes

- A pass can be visible before it becomes active if it has a future start time.
- Quota limits can apply to both the full pass period and daily windows.
- If something looks wrong, compare this page with balance and usage history.

## Related pages

- `balance-history`
- `monthly-pass-management`
