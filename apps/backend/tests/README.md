# Test Structure

- `tests/unit/**/*.unit.test.ts`
  - Pure Node unit tests. All persistence and infrastructure boundaries are mocked.
- `tests/database/**/*.db.test.ts`
  - Prisma repository and persistence tests. Each worker receives an isolated MySQL database and Redis logical database.
- `tests/integration/**/*.integration.test.ts`
  - HTTP, Express, Redis, and end-to-end integration tests using the same worker isolation model.
- `tests/contract/**/*.contract.test.ts`
  - OpenAPI schema and operation contract tests. Runtime operation checks run in the database project; schema-only checks run as Node tests.
- `tests/runtime/`
  - Shared worker environment, database lifecycle, and per-file cleanup setup.
- `tests/scripts/`
  - Test runner, stale database cleanup, and taxonomy validation commands.
- `tests/util/`
  - Shared test helpers and mock plugins.

Use `test:unit` for fast local feedback, `test:runtime` for all persistence/API checks, and `test:db:clean` only after an interrupted database run.

All backend test commands run Prisma Client generation once before Vitest starts. This is a local code-generation prerequisite for modules that import Prisma types; it does not connect to MySQL, create a database, or run `db push`. Those operations remain exclusive to the database and integration projects.
