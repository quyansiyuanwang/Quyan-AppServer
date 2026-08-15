import { afterEach, describe, expect, it } from "vitest";
import { env } from "../../../src/config/env";
import {
  createSupportRelayAuthorization,
  resolveSupportRelayClientIp,
} from "../../../src/util/support-relay-authorization";

const originalMasterSecret = env.security.replayProtection.masterSecret;

afterEach(() => {
  env.security.replayProtection.masterSecret = originalMasterSecret;
});

describe("support Relay authorization", () => {
  it("accepts only a current server-signed client IP bound to the same Relay Token", () => {
    env.security.replayProtection.masterSecret = "a".repeat(64);
    const token = "rlt_user_owned_token";
    const authorization = createSupportRelayAuthorization(token, "198.51.100.23", 1_000_000);

    expect(resolveSupportRelayClientIp(authorization, token, 1_000_100)).toBe("198.51.100.23");
    expect(resolveSupportRelayClientIp(authorization, "rlt_another_token", 1_000_100)).toBeUndefined();
    expect(resolveSupportRelayClientIp(authorization, token, 1_060_001)).toBeUndefined();
  });
});
