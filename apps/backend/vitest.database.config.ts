import { defineBackendTestProject } from "./vitest.shared";

export default defineBackendTestProject(
  "backend-database",
  [
    "tests/database/**/*.test.ts",
    "tests/integration/**/*.test.ts",
    "tests/contract/openapi-operations.contract.test.ts",
  ],
  true,
);
