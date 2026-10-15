import { defineBackendTestProject } from "./vitest.shared";

export default defineBackendTestProject("backend-contract", [
  "tests/contract/openapi-schema.contract.test.ts",
  "tests/contract/iam-user-email.contract.test.ts",
  "tests/contract/iam-ip-error-weight.contract.test.ts",
  "tests/contract/iam-ip-blacklist-update.contract.test.ts",
  "tests/contract/iam-relay-token-read.contract.test.ts",
]);
