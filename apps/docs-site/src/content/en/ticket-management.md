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

## Notes

- Users can only see their own tickets and public status updates; they cannot see internal reviewer notes.
- Deletion is permanent — use it only for spam or policy violations.

## Related pages

- `user-management`
- `business-logs`
