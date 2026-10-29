# My tickets

Submit suggestions, report bugs or other issues, and use the same ticket to track progress, add information, and reply to reviewers.

## Before you begin

After signing in, open **My tickets** on the account site. Submitting, viewing your own tickets, editing, and commenting require separate permissions. If the form, list, or an action is missing, ask an administrator to check your permissions.

In IAM enforcement mode, the list and total include only your authorized tickets. Listing, reading details, editing, and commenting have separate grants: seeing a ticket in the list does not guarantee access to its details or updates. Public replies are visible to the submitter and authorized reviewers, rather than published to all users.

## Submit a ticket

1. Choose suggestion, bug, or other, and enter a title and description. For a bug, include when it occurred, the expected result, and the actual result.
2. Add contact information, the source page, and reproduction steps as needed. Include only information needed to handle the issue; do not submit passwords, Access Keys, relay tokens, or other credentials.
3. Select **Submit ticket**. On success, the form clears, the list returns to page one, and the page attempts to open the new ticket's details.
4. Check the title and content. Existing filters remain active and may exclude the new ticket; reset the filters if you cannot find it in the list.

The title and contact information can each contain up to 200 characters, and the source page up to 500. The description, reproduction steps, and each reply can each contain up to 5000 characters. Titles, descriptions, and replies cannot contain only whitespace.

## Track progress

1. Enter a keyword from the ticket ID, title, or description, then select **Search** or press Enter. Clearing the keyword also runs a search. Search does not include comment text.
2. Filter by status or type. Changing a filter immediately queries the first page; use pagination to browse other results.
3. Select **View detail**, check the title, and review the assignee, description, reproduction steps, and public comment timeline. Use **Refresh** in the list or details when needed.

| Status                        | Can you edit or reply?                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| Pending, processing, accepted | Yes, with the required permission. Accepted does not mean completed.                            |
| Rejected, completed           | No. If the issue remains, submit another ticket and explain its connection to the previous one. |

This page only operates on your own tickets. Reviewers manage status, priority, and assignment. Internal review notes are not shown to the submitter.

## Edit a ticket

1. Select edit in the list or **Load this item into the editor** in the details. Saved content loads into the ticket form.
2. Update the type, title, description, or other submission fields, then select **Save changes**. Leaving contact information, the source page, or reproduction steps blank clears the corresponding saved field.
3. To discard changes, select **Cancel edit**. While editing, **Reset** only restores default form values and does not exit editing for the current ticket. Select edit again to reload saved content.

## Add information and reply

1. Open the intended ticket's details and check the title and status.
2. Enter additional information in the reply area and select **Post reply**. On success, the reply draft clears and the page reloads details and the list.
3. Check the comment timeline to confirm the reply was saved.

Switching tickets or closing the details drawer does not clear an unsent reply. Check the current ticket and draft before every submission; use **Reset** in the reply area to clear an unwanted draft. This page has no action to edit or delete a submitted comment.

## Troubleshooting

| Situation                                                     | What to do                                                                                                                                                                          |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Searching, paging, or refreshing fails                        | The last successful list and total may remain. Refresh and wait for success before judging results for the current filters.                                                         |
| Opening details fails and the previous ticket remains visible | Close the drawer and reopen the intended ticket. Confirm that loading succeeded and the title is correct before editing or replying.                                                |
| New content is missing after creating, saving, or replying    | List or detail refresh may have failed. Refresh and check the saved result before retrying. Also check first after a timeout or interrupted request to avoid duplicate submissions. |
| A created ticket is missing from the list                     | Reset the filters and check the signed-in account. If it is still missing, ask an administrator to check read access. Creating a ticket does not grant list or detail access.       |
| Edit or reply actions are missing                             | Check whether the ticket is rejected or completed, and ask an administrator to check the relevant permissions.                                                                      |

## Related pages

- [Support assistant]({{DOCS_BASE_URL}}/en/support-assistant)
- [Settings]({{DOCS_BASE_URL}}/en/account-settings)
- [Ticket management for reviewers]({{DOCS_BASE_URL}}/en/ticket-management)
