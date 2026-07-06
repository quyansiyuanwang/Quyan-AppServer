# Prisma baseline alignment

This project now includes the first formal Prisma migration baseline:

- `prisma/migrations/20260706000000_baseline/migration.sql`

## Why this exists

Historically the project relied on `prisma db push` in development and some deployed environments were never registered into `_prisma_migrations`.

That means two databases can have similar structures but Prisma treats them differently:

- local may already be reset/rebuilt from the latest schema
- server may have real tables but no migration baseline

## Decide which path applies

Run from `apps/backend/`:

`pnpm run db:migrate:status`

### Path A: empty database

If the target database is empty or brand new:

1. Run `pnpm run db:migrate:deploy`
2. Run `pnpm run db:seed` if seeding is required

### Path B: existing database, but no Prisma baseline

If the target database already contains the application tables and you want Prisma to treat the current baseline as already applied:

1. Back up the database
2. Confirm the schema already matches current `schema.prisma`
3. Run `pnpm run db:migrate:resolve:baseline`
4. Run `pnpm run db:migrate:status` again and confirm the baseline is recorded

This does not execute the baseline SQL. It only writes the migration record into `_prisma_migrations`.

## Important constraint

Do not run `pnpm run db:migrate:deploy` directly against a populated legacy database that was built outside Prisma migrate history. Prisma will try to apply the baseline DDL and can fail because the tables already exist.

For that case, use `resolve` first.

On Windows MySQL instances with `lower_case_table_names=1`, keep the database name in `DATABASE_URL` lowercase, for example `qysywdb`. Mixed-case names can make Prisma drift detection miss existing foreign keys.

## Long-term rule

- Development can still use `db push` when iterating fast
- Shared/prod environments should use `migrate deploy`
- Any future schema change intended for deployment should be added as a real Prisma migration
