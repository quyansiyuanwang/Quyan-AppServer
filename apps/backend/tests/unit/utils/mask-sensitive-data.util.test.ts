import { describe, expect, it } from "vitest";
import { maskSensitiveData } from "@/util/mask-sensitive-data";

describe("mask-sensitive-data util", () => {
  it("returns null and undefined as-is", () => {
    expect(maskSensitiveData(null)).toBeNull();
    expect(maskSensitiveData(undefined)).toBeUndefined();
  });

  it("masks JWT-like strings", () => {
    const masked = maskSensitiveData("header.payload.signature");

    expect(masked).toBe("***TOKEN_MASKED***");
  });

  it("keeps non-sensitive plain strings untouched", () => {
    const value = "normal-text";
    expect(maskSensitiveData(value)).toBe(value);
  });

  it("masks sensitive keys recursively", () => {
    const input = {
      username: "alice",
      password: "secret-password",
      nested: {
        access_token: "abc.def.ghi",
        refreshToken: "refresh-token",
        apiKey: "k-123",
      },
    };

    const output = maskSensitiveData(input);

    expect(output.username).toBe("alice");
    expect(output.password).toBe("***MASKED***");
    expect(output.nested.access_token).toBe("***MASKED***");
    expect(output.nested.refreshToken).toBe("***MASKED***");
    expect(output.nested.apiKey).toBe("***MASKED***");
  });

  it("masks keys containing sensitive substrings", () => {
    const output = maskSensitiveData({ userPassword: "123", authorizationHeader: "token" });

    expect(output.userPassword).toBe("***MASKED***");
    expect(output.authorizationHeader).toBe("***MASKED***");
  });

  it("handles arrays and nested values", () => {
    const input = [{ token: "x" }, { profile: { email: "user@test.com", password: "p" } }, "plain", 1];

    const output = maskSensitiveData(input);

    expect(output[0].token).toBe("***MASKED***");
    expect(output[1].profile.email).toBe("user@test.com");
    expect(output[1].profile.password).toBe("***MASKED***");
    expect(output[2]).toBe("plain");
    expect(output[3]).toBe(1);
  });
});
