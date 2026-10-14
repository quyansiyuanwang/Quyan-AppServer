# Ticket management

Use this page to review, process, and respond to user-submitted tickets such as suggestions and bug reports.

## Page purpose

- Browse all user tickets.
- Filter by type, workflow status, priority, assignee, and date range.
- Update status and priority.
- Add internal review comments.
- Delete inappropriate entries.
- Maintain auto-assignment rules for incoming tickets.

## What you will see

### Ticket list

- Title, type (`suggestion` / `bug` / `other`), and submitting user.
- Workflow status: `pending`, `processing`, `accepted`, `rejected`, `completed`.
- Priority: `low` / `medium` / `high` / `urgent`.
- Assignee and submission time.
- Date-range filter (`startTime` / `endTime`).

### Ticket detail

- Original content submitted by the user.
- User follow-up comments.
- Public reviewer replies and internal notes.

### Assignment rules drawer

- Rule list with match conditions for ticket type and priority.
- Assignee pool configuration for round-robin assignment.
- Validation summary for incomplete rules before saving.

In enforcement mode, reading or updating `notification.ticketAssignmentRules` through the general configuration API also requires active global-group eligibility for `TICKET_REVIEW_UPDATE` and the corresponding `quyan:ticket:GetAssignmentRules` or `quyan:ticket:UpdateAssignmentRules` grant. A Deny on the dedicated operation also restricts the general configuration entry point. Without these permissions, the generic list hides the key; reads of the notification section and batch saves containing that key are rejected.

## Common actions

1. Filter by `pending` status to find new unprocessed submissions.
2. Open the detail view, read the content, then set priority and status.
3. Add a reviewer note to record the decision or progress.
4. Assign the item to a responsible team member or adjust auto-assignment rules.
5. Set status to `completed` when the issue is resolved.

## Permission requirements

| Action                              | Required permission    |
| ----------------------------------- | ---------------------- |
| View ticket list / detail           | `TICKET_REVIEW_READ`   |
| Update status / priority / comments | `TICKET_REVIEW_UPDATE` |
| Delete ticket                       | `TICKET_REVIEW_UPDATE` |
| Manage assignment rules             | `TICKET_REVIEW_UPDATE` |

## Resource permissions for assignment rules

In IAM enforcement mode, reading and updating assignment rules use `quyan:ticket:GetAssignmentRules` and `quyan:ticket:UpdateAssignmentRules`. Both use `acs:platform:*:platform:config-item/notification.ticketAssignmentRules`, the same resource identity as the general configuration API. A Deny with `Action: "*"` can therefore restrict both entry points. The authenticated subject must also belong to an active deployment-managed global group with `TICKET_REVIEW_UPDATE`; personal permissions, a private group, or account-owner identity cannot replace that eligibility.

Read access does not grant updates, and update access does not grant reads. Reading an unconfigured resource returns empty rules without creating configuration; the first authorized save can create it. Writes retain replay protection. Changes to configuration content, eligibility, authorization, or role sessions during a request cause rejection. Malformed stored rules are not reported as valid empty configuration.

A save can contain at most 100 rules and each rule at most 50 assignee IDs. Duplicate assignee IDs are removed. Each rule needs at least one ticket type or priority condition. Automatic assignment still selects only active reviewers with review permission; editing rules does not grant new review permissions to assignees.

## Notes

- Users can only see their own tickets and public status updates; they cannot see internal reviewer notes.
- Deletion is permanent — use it only for spam or policy violations.

## Related pages

- `user-management`
- `business-logs`
