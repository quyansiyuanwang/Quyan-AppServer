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

### Routing mode

Each token uses exactly one routing mode:

- `Ordered channels`: maintains a channel order and its failover configuration.
- `Automatic proxy pool`: selects one shared automatic proxy pool and does not retain an ordered channel list. Administrators or automation maintain the pool members centrally. A token may exclude individual pool members without changing the pool's global membership.

The resolved member determines the upstream, model capabilities, and billing multiplier. Token users can view members to exclude them for their own token, but cannot edit the pool's global membership.

### Management actions

- Create token.
- Edit token (including quota windows and IP whitelist).
- Clone token (duplicates all settings into a new token).
- Refresh token value (rotates the secret; the old value is immediately invalidated).
- Enable or disable token.
- Delete token.
- **Batch operations**: import / export token list (JSON format).
- **Channel batch operations**: import / export channel configurations, or select multiple channels and append them to the ordered list in selection order.

## Common actions

1. Create a token with a recognizable name.
2. Configure channel order and failover behavior.
3. Enable quota windows and set per-window limits if rate limiting is required.
4. Fill in the IP whitelist if you want to restrict which sources can use the token.
5. Review quota usage regularly to avoid unexpected throttling.
6. Disable a token first if you want to stop traffic without losing the record.
7. Use import / export when migrating or backing up token configurations in bulk.

## Call AI after creating a token

After creation, copy the **Relay Base URL** shown at the top of the token drawer and store the new token in the caller's server-side environment. Do not commit it to source control, expose it in browser code, or use it as an admin-site login credential.

Call `Relay Base URL + /v1/models` first to confirm which models are available. For OpenAI Chat Completions, use `Relay Base URL + /v1/chat/completions` and send:

```text
Authorization: Bearer <relay_token>
Content-Type: application/json
```

The request format must be enabled for the token's channels. See `api-documentation` for complete curl examples, the Responses format, and image requests; see `relay-settings` to change channels, models, or formats.

## Notes

- Refreshing a token value immediately invalidates the old string; callers must update their configuration.
- **Quota windows vs. the overall cap**: a token has one overall lifetime `quotaLimit` that never resets (tracked against total usage since creation), separate from the rolling quota windows described above, which each reset on their own cycle (per-minute, per-hour, per-day). Both can be active on the same token at once — the overall cap stops the token permanently once reached, while a quota window only throttles until its next reset.
- Bulk import appends new entries and does not overwrite existing tokens.
- Show-all mode is useful for audits but can be heavier to scan.

## Related pages

- `api-documentation`
- `relay-settings`
- `upstream-status`
