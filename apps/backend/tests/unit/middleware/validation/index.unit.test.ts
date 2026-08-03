import { describe, expect, it } from "vitest";
import * as validationIndex from "@/middleware/validation";
import * as zodValidator from "@/middleware/validation/zod-validator.middleware";

describe("middleware/validation index", () => {
  it("re-exports zod validator helpers", () => {
    expect(validationIndex.validateBody).toBe(zodValidator.validateBody);
    expect(validationIndex.validateQuery).toBe(zodValidator.validateQuery);
    expect(validationIndex.validateParams).toBe(zodValidator.validateParams);
  });
});
