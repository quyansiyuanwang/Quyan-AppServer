# Monthly pass management

Use this page to manage monthly-pass templates and user assignments.

## Page purpose

- Maintain monthly-pass templates.
- Publish or unpublish templates.
- Copy existing templates to create new plans faster.
- Assign passes to users and review assignment status.

## What you will see

### Template management

- Template list.
- Search and filters.
- Create, copy, edit, publish, unpublish, and delete actions.

### Assignment management

- Filters by user, template, and status.
- Create assignment.
- Assignment state and validity period.

## Common actions

1. Create or copy the closest template for your need.
2. Configure validity, quotas, usage windows, channels, and models.
3. Publish the template when it is ready.
4. Create assignments for target users.
5. Unpublish or adjust assignments when a plan should stop.

## What "quota", "channel", and "model" mean here

- **Quota** is the usage allowance a template grants (e.g. a fixed amount of relay usage per pass), separate from a user's regular balance.
- **Channel** restricts which relay channels (routing/provider destinations) a pass can be used against — see the `channel` glossary term for the general concept.
- **Model** restricts which AI models a pass covers. A pass with no model restriction can be used with any model available on its allowed channels.

## Notes

- Templates define the rules, while assignments decide who can use them and when.
- A template's validity sets the default duration for new claims and assignments. Administrators can still override start and end times for an individual or batch assignment. Changing template validity does not alter already-issued passes.
- If a user reports a pass issue, inspect template status, assignment status, and the user-facing page together.
- The user-facing equivalent is `my-monthly-passes`.

## Permission requirements

| Action                                            | Required permission             |
| ------------------------------------------------- | ------------------------------- |
| View templates                                    | `MONTHLY_PASS_TEMPLATE_READ`    |
| Create, edit, publish, unpublish, delete template | `MONTHLY_PASS_TEMPLATE_WRITE`   |
| View assignments                                  | `MONTHLY_PASS_ASSIGNMENT_READ`  |
| Create, edit, delete assignment (single or batch) | `MONTHLY_PASS_ASSIGNMENT_WRITE` |
| View usage records                                | `MONTHLY_PASS_USAGE_READ`       |

## Resource-level authorization

When IAM enforcement is enabled, monthly pass management uses the server Actions below. Templates and management assignments are deployment-wide resources. Operators also need eligibility from a deployment-managed global group; account policies and account-owned groups cannot grant that eligibility.

All resource paths below use the prefix `acs:platform:*:platform:`. Replace identifiers such as `userId` and `passId` with actual resource IDs.

| Operation              | Action                                   | Resource path                                                                                                   |
| ---------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| View templates         | `quyan:monthly_pass:ListTemplates`       | `monthly-pass-template/<templateId>`                                                                            |
| View assignments       | `quyan:monthly_pass:ListUserPasses`      | `monthly-pass/<userId>/<passId>`                                                                                |
| View usage             | `quyan:monthly_pass:ListUsages`          | `monthly-pass-usage/<userId>/<passId>/<usageId>`                                                                |
| Create an assignment   | `quyan:monthly_pass:AssignUserPass`      | The target `user/<userId>`, `monthly-pass-template/<templateId>` and generated `monthly-pass/<userId>/<passId>` |
| Batch create or extend | `quyan:monthly_pass:AssignUserPassBatch` | Each target's user, template and created or extended pass                                                       |
| Update an assignment   | `quyan:monthly_pass:UpdateUserPass`      | `monthly-pass/<userId>/<passId>`                                                                                |
| Delete an assignment   | `quyan:monthly_pass:DeleteUserPass`      | `monthly-pass/<userId>/<passId>`                                                                                |
| Fetch filter options   | `quyan:monthly_pass:GetFilterOptions`    | The relevant `monthly-pass-template`, `model-pricing`, `relay-channel` and `group` resources                    |

Lists authorize resources before counting and pagination. Usernames and template details in assignment lists require `ListUserPasses` on the related user and template. Template names in usage lists require `ListUsages` on the template. Related details in update results are controlled by `UpdateUserPass`. Stored consumed and remaining quota belong to the authorized pass. Quota-window usage is returned only when every relevant active usage record is allowed, avoiding misleading zeroes or understated usage from a partially visible set.

Creating an assignment requires its target user, template and generated pass ARN. Use `monthly-pass/<userId>/*` to limit creation to that user. Access to only the user and template is insufficient. Changing an assignment's status to deleted also requires `DeleteUserPass`. Changes to permissions, customer ownership, templates or quota windows, or concurrent consumption, reject an operation and preserve the existing quota. Batches process each target independently: a failed target rolls back while other authorized targets can succeed. Failed results omit unauthorized usernames, and unauthorized users discovered by filters are omitted from the results.

Unauthorized filter options are omitted. Existing hidden, private and whitelist channel rules still apply. Groups include only global groups visible at the current management level, excluding account-owned groups. Filter access returns names and identifiers without granting channel credentials, group permission settings or full template details. Historical model and channel information belong to an authorized usage record; channel identifiers in templates do not grant access to current channel configuration.

## Related pages

- `my-monthly-passes`
- `redemption-code-management`
