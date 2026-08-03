import { defineBackendTestProject } from "./vitest.shared";

export default defineBackendTestProject("backend-contract", ["tests/contract/openapi-schema.contract.test.ts"]);
