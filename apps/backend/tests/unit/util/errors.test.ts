import { describe, it, expect } from "vitest";
import { PayloadTooLargeError } from "@/util/errors";
import { CustomCode } from "@/constant/custom-code";

describe("PayloadTooLargeError", () => {
  it("should return 413 status code", () => {
    const error = new PayloadTooLargeError("Request body too large");

    expect(error.statusCode).toBe(413);
    expect(error.message).toBe("Request body too large");
  });

  it("should be instance of ApiError", () => {
    const error = new PayloadTooLargeError("Test message");

    expect(error).toBeInstanceOf(PayloadTooLargeError);
  });

  it("should be instance of Error", () => {
    const error = new PayloadTooLargeError("Test");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(PayloadTooLargeError);
  });

  it("should preserve stack trace", () => {
    const error = new PayloadTooLargeError("Test");

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("PayloadTooLargeError");
  });

  it("should use validation failed as default custom code", () => {
    const error = new PayloadTooLargeError();

    expect(error.code).toBe(CustomCode.VALIDATION_FAILED);
  });
});
