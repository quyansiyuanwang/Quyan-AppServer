# Ticket storage migration

This migration renames the legacy physical feedback tables to match the new ticket domain naming.

## Scope

- `feedbacks` -> `tickets`
- `feedback_comments` -> `ticket_comments`
- `ticket_comments.feedbackId` -> `ticketId`

## Preconditions

- Stop backend write traffic before executing the migration.
- Create a full database backup.
- Make sure the deployed backend code already uses the updated Prisma schema.

## Execute

From `apps/backend/` run:

`pnpm run db:rename-feedback-to-ticket`

## SQL

The exact SQL lives in `prisma/sql/rename-feedback-to-ticket.sql`.

## Verify

After running the SQL:

1. Run `pnpm run db:generate`
2. Run `pnpm run type-check`
3. Start the backend and validate ticket list/detail/comment flows
4. Validate ticket review assignment and notifications

## Rollback

If rollback is required before new writes happen, reverse the rename:

- `tickets` -> `feedbacks`
- `ticket_comments` -> `feedback_comments`
- `ticket_comments.ticketId` -> `feedbackId`

If new writes already happened after deployment, restore from backup instead of partial manual rollback.
