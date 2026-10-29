# Redemption code management

Administrators can generate codes with a fixed balance value for users to redeem from [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history). A complete code has redeemable value; share it only with the intended recipient.

## Prerequisites

Opening redemption code management requires read permission. Generation and deletion each require separate permissions. A visible button does not establish authorization. Accounts with two-factor authentication may need verification when generating or deleting codes.

This page manages administrator-issued redemption codes. Users manage gift codes funded from their own balance on their account balance page.

## Generate and distribute codes

1. Select **Generate Codes**.
2. Enter **Amount** and **Count**. Amount is the value of each code, from 0.01 to 100000. The management page generates 1–100 codes at a time.
3. Optionally set an expiry. Leaving it empty means no expiry; a supplied expiry must still be in the future when submitted.
4. Check the form, select **Confirm**, and complete any requested verification.
5. After success, the page returns to the first list page. Identify new records using creation time, creator, amount, and expiry. A batch can span multiple pages.
6. Click each code to copy it. Paste in a trusted location and verify the complete value before sharing. The success notification does not guarantee clipboard completion; manually select and copy if needed. Mobile lists can truncate long codes, so do not send only the visible fragment.

There is no bulk export or automatic distribution on this page. The creation response is not displayed as a separate results list; retrieve complete codes from the list. Create permission does not include list access.

Generation does not debit the creator's balance. Successful redemption adds the code's value to the recipient's balance and cumulative recharged amount and creates a redemption transaction. A code is not bound to a named recipient: a holder with redemption permission can claim it. Do not publish complete unused codes.

## Check status and recipient

The list is newest first, with 20 records per page initially. Desktop users can change page size and inspect recipient, usage time, and creator. Mobile cards show fewer details; use desktop for a complete check. The page has no keyword or status filter.

| Displayed status | Meaning and next step                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Unused           | No recipient is recorded and the page considers it unexpired. Actual redemption remains subject to server checks |
| Used             | A recipient is recorded. Check recipient and usage time against the user's balance transactions                  |
| Expired          | The code is unused and past its expiry; it cannot be redeemed                                                    |

Used codes remain displayed as used after their expiry. Expiry labels use the browser's clock, and the page does not continuously poll usage. Reopen the page or change pages to reload records before investigating a report. A missing record can reflect authorization filtering or deletion; an empty list alone does not prove that no code was generated.

## Delete a code

Check the complete code, amount, recipient, and expiry first. Selecting **Delete** immediately submits the operation, without an additional deletion confirmation dialog. Complete any requested verification; success reloads the current page.

An unused code cannot be redeemed after deletion. Used codes can also be deleted, but this does not reverse credited balance or delete the recipient's balance transaction. The page has no restore, amount-editing, or expiry-extension action. Deletion removes the code record without refunding or debiting the user's balance.

## Permissions and resource authorization

| Operation        | Required permission      |
| ---------------- | ------------------------ |
| View codes       | `REDEMPTION_CODE_READ`   |
| Generate a batch | `REDEMPTION_CODE_CREATE` |
| Delete           | `REDEMPTION_CODE_DELETE` |

With IAM enforcement, operators must also belong to an active deployment-managed global group eligible for the operation. Personal permissions, private groups, or account-owner identity cannot replace that eligibility.

Prefix the paths below with `acs:platform:*:platform:`. A code ID is its record ID, never the redeemable code value.

| Action                              | Required resource paths                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `quyan:redemption_code:ListCodes`   | Collection `redemption-code-control/default` and individual records `redemption-code/<id>` |
| `quyan:redemption_code:CreateCodes` | Collection `redemption-code-control/default` and new records `redemption-code/<id>`        |
| `quyan:redemption_code:DeleteCode`  | Target `redemption-code/<id>`                                                              |

The server generates record IDs; `redemption-code/*` can define creation scope. Collection access does not override a record-level Deny. Unauthorized records are excluded from records, pagination, and totals. Enforcement mode excludes disabled records.

In enforcement mode, denial of any new record rolls back the whole batch. Direct API creation supports up to 1000 codes per batch; the management page remains limited to 100. Changes to permissions, management eligibility, or target content during a request can cause failure. Recheck before retrying. Generation and deletion retain verification challenges and replay protection.

## Troubleshooting

| Symptom                                            | What to do                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Generation succeeds but some new codes are missing | Check the first and subsequent pages and read access before generating again                                         |
| Connection drops after generation                  | Reload and compare creation time, creator, amount, and count. Consult business logs if the outcome remains uncertain |
| A user receives an already-used message            | Check recipient, usage time, and balance transactions. Deleting the record does not undo redemption                  |
| A user receives a missing or expired message       | Check the complete value, expiry, and deletion. Do not send a truncated display value                                |
| Deleting the last record leaves an empty page      | Go to the previous page; pagination does not necessarily move back automatically                                     |

## Related pages

- [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history)
- [Balance management]({{DOCS_BASE_URL}}/en/balance-management)
