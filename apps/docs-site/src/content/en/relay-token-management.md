# Relay token management

Use this page to manage relay tokens, channel routing, quotas, and failover behavior.

## Page purpose

- Create and maintain relay tokens.
- Review token usage, expiry, and quota windows.
- Control channel ordering and failover strategy.
- Enable or disable tokens without deleting them immediately.
- Bulk import and export token and channel configurations.

## What you will see

### Token list

- Token name and searchable token details.
- Request count and total token usage.
- Expiry, status, and quota usage.
- Paged or show-all display modes.

### Quota windows

Each token can have one or more rolling time-window rate limits (e.g. per-minute, per-hour, per-day):

- Master toggle to enable or disable quota windows for a token.
- Each window shows used / limit and the next reset time.
- Requests are rejected once the limit is reached until the window resets.

### IP whitelist

- Bind a token to a set of allowed IPs or CIDR ranges.
- Leaving it empty allows any source IP; adding entries restricts access to those addresses only.

### Channel and failover data

- Ordered channel list.
- Failover summary (automatic fallback when the primary channel is unavailable).
- Quota-window detail panel.

### Management actions

- Create token.
- Edit token (including quota windows and IP whitelist).
- Clone token (duplicates all settings into a new token).
- Refresh token value (rotates the secret; the old value is immediately invalidated).
- Enable or disable token.
- Delete token.
- **Batch operations**: import / export token list (JSON format).
- **Channel batch operations**: import / export channel configurations.

## Common actions

1. Create a token with a recognizable name.
2. Configure channel order and failover behavior.
3. Enable quota windows and set per-window limits if rate limiting is required.
4. Fill in the IP whitelist if you want to restrict which sources can use the token.
5. Review quota usage regularly to avoid unexpected throttling.
6. Disable a token first if you want to stop traffic without losing the record.
7. Use import / export when migrating or backing up token configurations in bulk.

## Notes

- Refreshing a token value immediately invalidates the old string; callers must update their configuration.
- Quota windows and the overall `quotaLimit` cap are independent mechanisms and can both be active.
- Bulk import appends new entries and does not overwrite existing tokens.
- Show-all mode is useful for audits but can be heavier to scan.

## Related pages

- `api-documentation`
- `relay-settings`
- `upstream-status`
