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

## Related pages

- `my-monthly-passes`
- `redemption-code-management`
