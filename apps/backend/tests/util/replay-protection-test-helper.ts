import type { Test } from "supertest";
import { ReplayProtectionClient } from "../../src/util/replay-protection-client";
import { TEST_REPLAY_CLIENT_FINGERPRINT } from "../../src/util/replay-signing-session";

export function withReplayProtection(requestBuilder: Test, body: unknown, path: string): Test {
  if (path === "/auth/login" && body && typeof body === "object" && !Array.isArray(body)) {
    const loginBody = body as Record<string, unknown>;
    if (!("agreedToLegalPolicies" in loginBody)) loginBody.agreedToLegalPolicies = true;
  }

  const headers = ReplayProtectionClient.generateHeaders(body, path);

  for (const [key, value] of Object.entries(headers)) requestBuilder.set(key, value);
  requestBuilder.set("X-Client-Fingerprint", TEST_REPLAY_CLIENT_FINGERPRINT);

  return requestBuilder;
}
