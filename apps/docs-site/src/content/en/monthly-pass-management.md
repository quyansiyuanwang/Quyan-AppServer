# Monthly pass management

Use this page to manage monthly-pass templates and user assignments.

With IAM enforcement enabled, the management template list uses `quyan:monthly_pass:ListTemplates` against each `acs:platform:*:platform:monthly-pass-template/<templateId>`. Page records and totals include only permitted templates, and quota windows are returned only with an admitted template. Monthly pass templates are shared deployment resources, so IAM grants also require the global management group ceiling configured by the deployment administrator. An account policy or account-owned group cannot grant that management eligibility. This read permission does not grant template editing, publication, or pass assignment.

With IAM enforcement enabled, usage records use `quyan:monthly_pass:ListUsages` against each `acs:platform:*:platform:monthly-pass-usage/<userId>/<passId>/<usageId>`. Counts and pages include only allowed records. Showing a template name additionally requires the same Action to allow its `acs:platform:*:platform:monthly-pass-template/<templateId>`; otherwise the name is empty. Historical model and channel names are returned as part of the authorized usage record and do not grant access to current channel configuration. This operation also requires monthly-pass usage read eligibility in a deployment-managed global group.

Assignment updates and deletes use `quyan:monthly_pass:UpdateUserPass` and `quyan:monthly_pass:DeleteUserPass` on `acs:platform:*:platform:monthly-pass/<userId>/<passId>`. Setting the deleted status through an update also requires DeleteUserPass. The transaction rechecks assignment quotas and quota windows; a concurrent consumption, revoked policy or changed management eligibility rejects the entire change. Usernames and template details in an update response additionally require UpdateUserPass to allow the relevant `platform/user` and `platform/monthly-pass-template` resources. Without that read scope, the response contains only the assignment itself.

The assignment list uses `quyan:monthly_pass:ListUserPasses` to authorize each `acs:platform:*:platform:monthly-pass/<userId>/<passId>` before counting and pagination. Usernames and template details separately require this Action to allow the relevant `platform/user` and `platform/monthly-pass-template` resources. The assignment's stored used and remaining quotas are returned with the record. Window usage is returned only if ListUserPasses allows every relevant active usage record, preventing partial visibility from producing misleading zero or underestimated usage. Template access includes allowed channel identifiers and does not grant current channel names or configuration.

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

## Related pages

- `my-monthly-passes`
- `redemption-code-management`
