# Ticket storage migration

This migration renames the legacy physical feedback tables to match the new ticket domain naming.

## Prisma baseline prerequisite

Production environments must first align on the Prisma baseline migration in `prisma/migrations/20260706000000_baseline/`.

- If the database is empty: run `pnpm run db:migrate:deploy`
- If the database already exists and was created via `db push`: run `pnpm run db:migrate:resolve:baseline`

Check current status with `pnpm run db:migrate:status`.

Only after the baseline is aligned should you execute any physical ticket rename SQL required by your live database state.

## Scope

- `feedbacks` -> `tickets`
- `feedback_comments` -> `ticket_comments`
- `ticket_comments.feedbackId` -> `ticketId`

## Preconditions

- Stop backend write traffic before executing the migration.
- Create a full database backup.
- Make sure the deployed backend code already uses the updated Prisma schema.

## Execute

Execute the physical rename manually during a maintenance window if your production database still has legacy `feedbacks` / `feedback_comments` table names.

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
