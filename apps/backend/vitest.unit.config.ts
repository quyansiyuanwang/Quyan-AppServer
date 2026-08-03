import { defineBackendTestProject } from "./vitest.shared";

export default defineBackendTestProject("backend-unit", ["tests/unit/**/*.unit.test.ts"]);
