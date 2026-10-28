# Business logs

Use this page to inspect business-level audit records.

## Page purpose

- Review who performed a business action.
- Filter operations by type, actor, target, or status.
- Inspect change details, metadata, and errors.

## What you will see

### Filter area

- Operation type and category.
- Actor, target, status, and IP filters.
- Date range.

### Log list

- Description.
- Success or failure tags.
- Pagination.
- Mobile-friendly card layout where needed.

### Detail area

- Expanded changes.
- Metadata.
- Error details when present.

## Common actions

1. Filter by operation type or actor first.
2. Open failed records to inspect the error details.
3. Expand changes when you need to see before-and-after values.
4. Use the date range to isolate incidents or audit windows.

## Notes

- This page is closer to audit and business activity than raw infrastructure logging.
- Use it when you need to know who changed something, not only whether a request happened.
- Combine it with user, permission, or balance pages for complete incident tracing.

## Related pages

- [User management]({{DOCS_BASE_URL}}/en/user-management)
- [Balance management]({{DOCS_BASE_URL}}/en/balance-management)
- [System logs]({{DOCS_BASE_URL}}/en/system-logs)

## Filter catalog permissions

IAM `enforce` mode uses the independent `quyan:system:business_log:GetFilterOptions` Action on `acs:platform:*:platform:system/business-log-options` for the operation type and category selectors. The endpoint returns the existing static catalog; it does not read business log records or grant list or statistics access.

The current user must hold `SYSTEM_BUSINESS_LOG_READ` in an active global group. Account policies, private groups and user additions cannot replace that deployment qualification. A matching explicit Deny blocks the operation; lost qualification or a matching policy denial during a read prevents the response from being returned. `legacy` and `shadow` retain the previous effective permission, with IAM decisions also recorded in `shadow`.

## List resource permissions

In IAM `enforce` mode, lists use the independent `quyan:system:business_log:ListLogs` Action and check each `acs:platform:*:platform:business-log/<log ID>`. You must also hold `SYSTEM_BUSINESS_LOG_READ` in an active global group; account policies, private groups and user additions cannot replace this qualification.

Only allowed records enter the list, and `total` and pagination reflect those records. A matching explicit Deny overrides Allow; records without a matching Allow are omitted. Queries without a date range can still include historical logs. Each query fixes its cutoff time; if policies, qualification or records contributing to the result change during the read, the request is denied and must be retried.

List access does not grant statistics or filter catalog access. Change details and metadata continue to hide sensitive credentials. `legacy` and `shadow` retain the previous list behavior, with additional IAM decisions recorded in `shadow`.

## Statistics resource permissions

In IAM `enforce` mode, statistics use the independent `quyan:system:business_log:GetLogStatistics` Action, authorizing each `acs:platform:*:platform:business-log/<log ID>` before including it. The list's `ListLogs` permission cannot replace statistics access; statistics also require `SYSTEM_BUSINESS_LOG_READ` in an active global group.

Totals, successes/failures, distinct actors, targets and IPs, and daily/operation/category distributions include only allowed records. Explicit Deny takes precedence; without a matching Allow, the aggregate is empty. Queries without a date filter can include historical records; requested date ranges retain the existing boundaries and percentage calculations. If authorization or contributing records change during the read, the result is denied. `legacy` and `shadow` retain the previous statistics behavior, with additional IAM decisions recorded in `shadow`.
