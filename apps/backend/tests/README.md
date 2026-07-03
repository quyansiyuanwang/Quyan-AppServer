# Test Structure

- tests/contract
  - OpenAPI contract and schema consistency checks.
- tests/integration
  - End-to-end API and database integration tests.
  - tests/integration/api contains endpoint-focused API integration scenarios.
- tests/unit
  - Isolated unit tests grouped by domain:
  - services
  - permissions
  - utils
- tests/util
  - Shared test helpers and mock plugins used by integration/contract suites.

Global bootstrap files:

- tests/globalSetup.ts
- tests/setup.ts
