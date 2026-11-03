# Monthly pass management

Use monthly pass management to create redeemable plans, issue allowances to users, and inspect coverage records. Choose **Template Management**, **User Assignment**, or **Usage Records** on the monthly pass management page.

## Prerequisites

Read permissions determine which tabs you can see; write permissions determine available operations. Accounts with two-factor authentication may need a verification challenge when changing templates or assignments.

A template's **Status** and **Publish Status** are independent. New and copied templates are enabled and unpublished. Manual assignment requires an enabled template, without requiring publication.

## Create or copy a template

1. In **Template Management**, select **Create Template**, or find an existing template and select **Copy Template**.
2. Enter a unique name, original price, discount, and validity. Validity is 1–3650 days, defaulting to 30. Discount is a percentage: 100 is full price, 80 means 20% off, and 0 allows free redemption.
3. Check the pricing preview. Discounted price is original price multiplied by the discount percentage; derived quota is original price multiplied by the recharge ratio at save time, measured by amount. Reducing the discount percentage does not reduce quota proportionally.
4. Optionally configure daily quota, purchase count and window days, balance redemption, allowed channels and models, and quota windows. Purchase count and window days must both be set or both left empty.
5. Select **Confirm** and complete any requested verification. Check the saved list entry, then publish the template to offer self-service redemption.

Copying opens a creation form populated from the source. It copies neither user assignments nor publication status. Saving the copy recalculates quota using the current recharge ratio.

Original price and amount quotas support up to four decimal places. Request and token quotas must be positive integers. Leaving channels or models empty means no pass restriction on that dimension; normal channel access and model availability still apply. Recheck selected models after changing channels.

## Change a template or stop redemption

Filter the template list by keyword and status, select **Search**, and choose the target row's operation.

| Operation                        | Effect on new redemption or assignment                                      | Effect on issued passes                                                     |
| -------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Unpublish                        | Stops self-service redemption; enabled templates remain manually assignable | Does not by itself stop issued passes                                       |
| Disable balance redemption       | Published plans remain visible but cannot be redeemed                       | Does not by itself stop issued passes                                       |
| Edit pricing, quota, or validity | Changes defaults for subsequent issuance                                    | Does not rewrite existing total quota, validity, or assigned quota settings |
| Edit allowed channels or models  | Changes the coverage scope for subsequent passes                            | Ordinary passes also use their current associated template's scope          |
| Disable template status          | Stops new redemption and assignment                                         | Associated passes stop providing coverage                                   |
| Delete template                  | Stops new redemption and assignment                                         | Associated passes stop providing coverage; this page has no restore action  |

Every save through the edit form recalculates derived quota using the current recharge ratio, even when only changing a name. Check pricing, quota, and publication status afterward. Deleting templates or assignments does not automatically refund purchases.

Purchase limits count new assignments for the same user and template within a rolling window, including manual issuance and disabled assignments. They do not count only paid purchases. Manual issuance itself is not blocked by the self-service purchase limit.

## Assign a pass to one user

1. In **User Assignment**, select **Assign Monthly Pass**, then **Single User**.
2. Search for the user and choose an enabled template. Selecting a template adjusts the end time using its validity, so check dates afterward.
3. Set start and end times and the quota unit. Empty total quota uses the template default. Empty daily quota on creation inherits the template's daily quota; it does not necessarily mean unlimited.
4. Add custom quota windows to this assignment if needed. A blank form does not automatically copy the template's complete set of window rules.
5. Enter a note and select **Confirm**. Search by user and template to verify the saved assignment.

Manual assignment does not debit the user's balance. Each single-user submission creates a separate pass, without merging or extending an old pass. Coverage requires the start time to have arrived, both template and assignment to be enabled, and available quota for an eligible request.

**Set Duration** recalculates the end time from the start time. **Increase Duration**, **Decrease Duration**, and end-time shifts change only the end time. End time must be later than start time.

## Issue or extend passes in a batch

1. Choose **Batch Assignment** in the assignment dialog, select an assignment mode, and check the target users.
2. To issue only to manually selected users, first choose **Clear selection**, clear keyword and group filters, search, and select the users. Keep the option to include all users in the current filtered result unchecked.
3. To issue to everyone matching a filter, set the keyword or group and check **Include all users in the current filtered result**. **Select all visible** also enables that option.
4. Set the template, dates, quotas, and note, then select **Confirm**. Inspect created, extended, and failed counts and verify successful assignments in the list.

> Keeping a keyword or group filter at submission currently adds every matching user within the management scope to the batch, even when the all-users option is unchecked. The candidate list loads only the first 100 users; the displayed count is not the server's target limit. To restrict recipients precisely, clear filters before selecting individuals, or use single-user assignment.

| Assignment mode             | Behavior                                                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create new passes           | Creates a separate pass for each target                                                                                                                                                   |
| Extend latest existing pass | Finds the non-deleted pass for the same template with the latest end time. If it ends on or after the form's start time, adds the form's duration and quota; otherwise creates a new pass |

For extension, total quota is an increment; leaving it empty uses the template default. Used quota stays unchanged, while total and remaining quotas increase. The old start time and enabled/disabled status stay unchanged, so extending a disabled pass does not enable it. A different quota unit fails extension. In an individual assignment edit, total quota instead means the new overall total.

Batches process users independently and can partially succeed. A success notification does not mean every target succeeded; failures do not undo other successes. The current result area shows counts only. Verify individual assignments before retrying failed users. Resubmitting the whole batch issues more passes or adds quota and duration again.

## Edit or delete an assignment

In **User Assignment**, search by user, template, and status, then select **Edit**. You can change dates, quotas, windows, note, and enabled status; the user and template cannot be changed.

Changing total quota preserves used quota. The new total cannot be below usage, and remaining quota becomes new total minus used quota. Switching units does not convert historical usage; avoid changing units on a consumed pass. Clearing an existing note in the form does not remove the saved note.

To pause one pass, disable its assignment status. To remove it, select **Delete** and confirm. Deletion stops coverage, has no restore action on this page, and does not automatically refund payment. An enabled status alone does not establish that dates, template status, and available quota permit use.

## Current quota-window limits

Daily quota uses a rolling window, looking back 24 hours when no duration is specified. It does not reset at midnight. Window recovery does not replenish total quota or extend validity.

**Multi-window Quotas** can save up to 20 rules, each specifying a quota, unit, and duration of 1–720 hours. The same unit and duration pair cannot repeat. Request eligibility currently checks multi-window rules, but final coverage still uses total quota and the single daily quota. Strict simultaneous settlement caps across multiple windows are not supported yet. Do not promise separately enforced hourly and daily caps; check actual usage records after configuration.

## Query usage records

1. Open **Usage Records** and optionally select a user, template, model, and time range.
2. Select **Search** to inspect coverage amount, request cost, remaining cost, and creation time.
3. Compare assigned used and remaining quotas with [Consumption records]({{DOCS_BASE_URL}}/en/consumption-records) when investigating charges.

Each record describes one pass's coverage for a request. Remaining cost can still be covered by another pass or balance; it is not necessarily the final balance debit. No record does not prove there was no request: the pass may not have matched or provided coverage.

The top refresh reloads only the current tab, without reloading all option directories. User searches initially return only the first 50 matches; narrow the keyword if needed. Missing options can also indicate insufficient read access. Do not delete or recreate a resource just because it is missing from a selector.

## Permissions and resource authorization

| Operation                                                                   | Required permission             |
| --------------------------------------------------------------------------- | ------------------------------- |
| View templates                                                              | `MONTHLY_PASS_TEMPLATE_READ`    |
| Create, copy, edit, publish, unpublish, or delete templates                 | `MONTHLY_PASS_TEMPLATE_WRITE`   |
| View assignments                                                            | `MONTHLY_PASS_ASSIGNMENT_READ`  |
| Create, edit, or delete assignments, including batch issuance and extension | `MONTHLY_PASS_ASSIGNMENT_WRITE` |
| View usage records                                                          | `MONTHLY_PASS_USAGE_READ`       |

With IAM enforcement, operators also need eligibility from a deployment-managed global group. Page visibility or read access does not grant writes. Account policies and account-owned groups cannot grant global management eligibility.

Prefix resource paths below with `acs:platform:*:platform:` and substitute actual IDs.

| Action                                                                                                             | Resource path                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `quyan:monthly_pass:ListTemplates`                                                                                 | `monthly-pass-template/<templateId>`                                                                                                           |
| `quyan:monthly_pass:CreateTemplate`, also used when saving a copy                                                  | `monthly-pass-template-control` and the generated `monthly-pass-template/<templateId>`                                                         |
| `quyan:monthly_pass:UpdateTemplate`, `PublishTemplate`, `UnpublishTemplate`, `DeleteTemplate` (same Action prefix) | Target `monthly-pass-template/<templateId>`                                                                                                    |
| `quyan:monthly_pass:ListUserPasses`                                                                                | `monthly-pass/<userId>/<passId>`                                                                                                               |
| `quyan:monthly_pass:ListUsages`                                                                                    | `monthly-pass-usage/<userId>/<passId>/<usageId>`                                                                                               |
| `quyan:monthly_pass:AssignUserPass`                                                                                | Target `user/<userId>`, `monthly-pass-template/<templateId>`, and the generated pass                                                           |
| `quyan:monthly_pass:AssignUserPassBatch`                                                                           | Each target's user, template, and created or extended pass                                                                                     |
| `quyan:monthly_pass:UpdateUserPass`, `DeleteUserPass` (same prefix)                                                | Target `monthly-pass/<userId>/<passId>`                                                                                                        |
| `quyan:monthly_pass:GetFilterOptions`                                                                              | Relevant template, model-pricing, channel, and group resources; does not replace access required by the directory APIs the page actually calls |

Lists count and paginate allowed records only. Related usernames, template details, and names require the corresponding read Action on referenced resources. Window usage is returned only when all relevant active usage records can be read; a missing field does not mean zero usage.

Assignment creation must allow the user, template, and generated pass ARN. Use `monthly-pass/<userId>/*` to scope issuance. Access to the user and template alone is insufficient. Unauthorized related details may be hidden; unauthorized users discovered by filters are omitted from batch results. Changes to permissions, templates, or concurrent consumption can reject a change. Refresh and verify before retrying.

## Troubleshooting

| Symptom                                     | What to check                                                                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| A user cannot see a redeemable plan         | Check that the template is enabled and published, then check read access. Plans with balance redemption disabled can still be displayed |
| Quota remains but a request was not covered | Check template and assignment status, dates, windows, model and channel scope, and request records                                      |
| Save fails or reports a quota conflict      | Refresh and check latest usage, units, permissions, and template status before retrying                                                 |
| Connection drops after submission           | Query the template or target assignments first. Verify batches individually before resubmitting                                         |

## Related pages

- [My monthly passes]({{DOCS_BASE_URL}}/en/my-monthly-passes)
- [Monthly pass purchase]({{DOCS_BASE_URL}}/en/monthly-pass-purchase)
- [Redemption code management]({{DOCS_BASE_URL}}/en/redemption-code-management)
