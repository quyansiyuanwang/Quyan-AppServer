# Feedback management

Use this page to review, process, and respond to user-submitted feedback (suggestions, bug reports, etc.).

## Page purpose

- Browse all user feedback.
- Filter by type, workflow status, priority, assignee, and date range.
- Update status and priority.
- Add internal review comments.
- Delete inappropriate entries.

## What you will see

### Feedback list

- Title, type (suggestion / bug / other), and submitting user.
- Workflow status: `pending`, `processing`, `accepted`, `rejected`, `completed`.
- Priority: `low` / `medium` / `high` / `urgent`.
- Assignee and submission time.
- Date-range filter (`startTime` / `endTime`).

### Feedback detail

- Original content submitted by the user.
- User follow-up comments.
- **Admin comment area** — internal processing notes visible only to reviewers.

## Common actions

1. Filter by `pending` status to find new unprocessed submissions.
2. Open the detail view, read the content, then set priority and status.
3. Add an admin comment to record the decision or progress.
4. Assign the item to a responsible team member.
5. Set status to `completed` when the issue is resolved.

## Permission requirements

| Action                                  | Required permission      |
| --------------------------------------- | ------------------------ |
| View feedback list / detail             | `FEEDBACK_REVIEW_READ`   |
| Update status / priority / add comments | `FEEDBACK_REVIEW_UPDATE` |
| Delete feedback                         | `FEEDBACK_REVIEW_UPDATE` |

## Notes

- Users can only see their own feedback and its current status; they cannot see admin comments.
- Deletion is permanent — use it only for spam or policy violations.

## Related pages

- `user-management`
- `business-logs`
