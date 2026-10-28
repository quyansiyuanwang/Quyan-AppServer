# Redemption code management

Use this page to create, copy, and track redemption codes.

## Page purpose

- Generate redemption codes in batches.
- Review redemption-code status.
- Delete codes that are no longer needed.
- Support balance top-ups or promotional distribution.

## What you will see

### List information

- Redemption code value.
- Status such as unused, used, or expired.
- Paginated list.

### Management actions

- Batch create.
- Click to copy.
- Delete codes.

## Common actions

1. Define amount, count, and expiry before creating a batch.
2. Copy generated codes to operations staff or recipients.
3. Check the status first when a user reports that a code cannot be redeemed.
4. Remove incorrectly created or obsolete codes.

Expiry values are submitted as ISO datetime values and must be later than the current time.

## Permission requirements

| Action                | Required permission      |
| --------------------- | ------------------------ |
| View redemption codes | `REDEMPTION_CODE_READ`   |
| Create codes (batch)  | `REDEMPTION_CODE_CREATE` |
| Delete codes          | `REDEMPTION_CODE_DELETE` |

## Resource-scoped reads

In IAM enforcement mode, `GET /v1/redemption-codes/list` uses `quyan:redemption_code:ListCodes`. The authenticated subject must also belong to an active deployment-managed global group with `REDEMPTION_CODE_READ`; personal permissions, a private group, or account-owner identity cannot replace that eligibility.

The collection requires an Allow for `acs:platform:*:platform:redemption-code-control/default`; each code uses `acs:platform:*:platform:redemption-code/<redemption code ID>`. Only permitted records return their code value, amount, and usage state. A matching Deny takes precedence. Unpermitted records are excluded from records, pagination, and totals. Authorize by record ID; do not put the code value in an ARN.

In enforcement mode, `page` starts at 1 and cannot exceed 10000; `pageSize` defaults to 50 and cannot exceed 100. Legacy and shadow modes retain their original pagination default. Disabled records are excluded. Records are sorted newest first. Changes to record content, authorization, eligibility, or role sessions during reading, or conditions that cease to hold, cause the request to fail rather than return a stale snapshot.

## Resource-scoped creation and deletion

In enforcement mode, batch issuance uses `quyan:redemption_code:CreateCodes` and requires deployment-managed global group eligibility for `REDEMPTION_CODE_CREATE`. The policy must allow both `acs:platform:*:platform:redemption-code-control/default` and the new record resources `acs:platform:*:platform:redemption-code/<redemption code ID>`. The server generates new record IDs; creation scope normally uses `acs:platform:*:platform:redemption-code/*`. A collection grant does not override a record-level Deny. A batch can contain at most 1000 records. If any record is denied or authorization ceases to hold before commit, the whole batch rolls back without returning or retaining partially generated results.

Deletion uses `quyan:redemption_code:DeleteCode`, requires deployment-managed global group eligibility for `REDEMPTION_CODE_DELETE`, and needs an Allow on the target ARN. Changes to target content or authorization during deletion cause rejection. Both creation and deletion retain two-factor challenges and replay protection. Creating codes does not grant permission to read the code list.

## Notes

- Redemption codes usually affect balance or user benefits.
- If a state looks wrong, compare it with balance records and business logs.
- The user usually enters codes from [Balance and transfers]({{DOCS_BASE_URL}}/en/balance-history).

## Related pages

- [Account balance & transfers]({{DOCS_BASE_URL}}/en/balance-history)
- [Balance management]({{DOCS_BASE_URL}}/en/balance-management)
