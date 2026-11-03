# Ticket management

Reviewers use this page to handle suggestions, bugs, and other tickets, maintain status and assignment, and record progress in public replies or internal notes. To submit your own issue, use [My tickets]({{DOCS_BASE_URL}}/en/my-tickets).

## Before you begin

Open **Ticket Reviews** on the **Developer Operations** site. Listing tickets and reading details require `TICKET_REVIEW_READ`. Updating, replying, deleting, and managing assignment rules require `TICKET_REVIEW_UPDATE`.

In IAM enforcement mode, you must also belong to an active deployment-managed global group with the relevant permission and be authorized for the specific operation. Personal permissions, private groups, or account-owner identity cannot replace global-group eligibility. See Permission scope below for actions and resources.

## Find and review tickets

1. Enter a keyword from the ticket ID, title, description, or submitter username, then select **Search** or press Enter. Clearing the keyword also runs a search. Comment text is not searched.
2. Filter by status, type, priority, or assignee. Changing a filter queries the first page. Select **Reset** to clear all filters.
3. Select **View detail**, check the title and submitter, and read the original description, reproduction steps, contact information, and comment timeline.

Types include suggestion, bug, and other; priorities include low, medium, high, and urgent. Pages can contain 10, 20, 50, or 100 items. The page has no time-range control; API queries support `startTime` and `endTime`.

In IAM enforcement mode, the list and total include only authorized tickets, ordered by last reply. List and detail grants are separate: a visible entry does not guarantee access to its details.

## Update status and assignment

1. In the detail's review form, change the type, status, priority, or assignee.
2. Clear the assignee to remove the assignment. **Reset** restores values from the currently loaded detail.
3. Select **Save review changes** and check the returned status and assignee. Form changes are not saved automatically, and replies must be submitted separately.

Status affects the submitter's actions as follows:

| Status                        | Can the submitter edit or reply?                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| Pending, processing, accepted | Yes, with the required permission. Accepted does not mean the issue has been resolved.          |
| Rejected, completed           | No. To continue the discussion, a reviewer can change the status back to pending or processing. |

Reviewers can still add replies or internal notes to rejected or completed tickets. Assigning a user does not grant review access. A manually selected assignee must be active and still needs the relevant permissions to handle the ticket.

## Send a reply or internal note

1. Choose public or internal visibility in the detail's reply form.
2. Enter up to 5000 characters. Whitespace alone is not accepted.
3. Select **Post reply** and check the content and visibility in the timeline.

Public replies are visible to the submitter and authorized reviewers. Internal notes are hidden from the submitter. The page does not provide editing, deletion, or visibility changes for submitted comments, so check before sending.

An unsent reply and its visibility may remain when switching tickets or closing the details. Before each submission, check the current ticket, content, and visibility. Resetting the reply form or submitting successfully clears its content and restores public visibility. Select internal visibility again before writing another internal note.

## Configure automatic assignment for new tickets

1. Open the assignment rules drawer from the top of the page and wait for a successful load.
2. Add a rule, choose at least a type or priority, and select assignees. If both conditions are set, both must match.
3. Check the validation summary and select **Save**. If you confirm saving incomplete rules, rules missing match conditions or assignees are excluded. **Reset** reloads saved rules and discards your edits.
4. Create a matching ticket and check its assignee. Saving rules does not reassign existing tickets. Later changes to a ticket's type or priority do not automatically reassign it either.

Matching prefers a rule with both type and priority, then type alone, then priority alone. The first rule within a matching category wins. New tickets start as pending with medium priority; rules restricted to high or urgent priority do not match these new tickets.

The system filters the selected rule's assignees to active users with review-update permission and assigns among them in rotation. If there is no matching rule or the selected rule has no eligible assignee, the ticket remains unassigned; it does not try the next rule. Each save supports up to 100 rules and each rule up to 50 assignee IDs. Duplicate IDs are removed.

The user selector supports keyword search and loads at most 50 results per request, rather than a complete directory. A failed search can show an empty list; check user-query permissions and connectivity, then retry. Rules do not grant review access to assignees.

## Delete a ticket

Find the ticket in the list, select **Delete**, and confirm. On success, it leaves active lists and the submitter can no longer access it through active ticket views. This page has no restore action. Use a status update to complete ordinary handling; deletion is unnecessary for that task.

## Permission scope

In IAM enforcement mode, the following operations can be authorized independently. Explicit Deny takes precedence.

| Operation                     | IAM Action                           | Required global-group permission |
| ----------------------------- | ------------------------------------ | -------------------------------- |
| Review queue                  | `quyan:ticket:ListReviewTickets`     | `TICKET_REVIEW_READ`             |
| Review details                | `quyan:ticket:GetReviewTicket`       | `TICKET_REVIEW_READ`             |
| Save review                   | `quyan:ticket:UpdateReviewTicket`    | `TICKET_REVIEW_UPDATE`           |
| Send a reviewer reply or note | `quyan:ticket:AddReviewComment`      | `TICKET_REVIEW_UPDATE`           |
| Delete ticket                 | `quyan:ticket:DeleteReviewTicket`    | `TICKET_REVIEW_UPDATE`           |
| Read assignment rules         | `quyan:ticket:GetAssignmentRules`    | `TICKET_REVIEW_UPDATE`           |
| Save assignment rules         | `quyan:ticket:UpdateAssignmentRules` | `TICKET_REVIEW_UPDATE`           |

Review resources use `acs:platform:*:platform:ticket-review/<submitterUserId>/<ticketId>`. The stored ticket determines the submitter; supplying another user cannot change the target. Policies can restrict access to individual tickets. Listing, detail, update, reply, and deletion grants do not imply one another. Submitter access to their own tickets uses separate permissions.

Assignment rules use `acs:platform:*:platform:config-item/notification.ticketAssignmentRules`. An authorized read of unconfigured rules returns an empty list; the first authorized save can create them. Reads and saves require separate grants. Reading or updating the same key through general configuration also requires the dedicated operation grant and global-group eligibility. Without access, the generic list hides the key, and section reads or batch saves containing it are rejected. A Deny with `Action: "*"` on this resource can restrict both entry points.

Changes to identity, role session, group eligibility, authorization, or ticket content during an operation can cause rejection. Refresh and check the latest state before retrying instead of continuing from old details.

## Troubleshooting

| Situation                                                    | What to do                                                                                                                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Searching, paging, or refreshing fails                       | The old list and total may remain. Refresh and wait for success before judging the results.                                                                          |
| Details fail to load and the previous ticket remains visible | Close and reopen the intended ticket. Confirm a successful load and the correct title and submitter before saving or replying.                                       |
| Assignment rules fail to load                                | Old rules may remain. Close and reopen the drawer and wait for success before editing to avoid overwriting another reviewer's changes.                               |
| Saving, replying, or deleting produces an unexpected result  | The operation may have succeeded while refresh failed. A timeout can also leave the result uncertain. Reload and check before retrying or posting a duplicate reply. |
| Deleting the last item leaves an empty page                  | Move to the previous page. The refresh after deletion does not do this automatically.                                                                                |
| An assigned user cannot review the ticket                    | Assignment names a responsible person but grants no permissions. Check their global-group eligibility and authorization for that ticket.                             |

## Related pages

- [My tickets]({{DOCS_BASE_URL}}/en/my-tickets)
- [User management]({{DOCS_BASE_URL}}/en/user-management)
- [Business logs]({{DOCS_BASE_URL}}/en/business-logs)
