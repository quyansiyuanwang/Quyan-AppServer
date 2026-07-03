import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as crypto from "crypto";
import { ReplayProtectionClient } from "@/util/replay-protection-client";
import { createTestReplaySigningMaterial } from "@/util/replay-signing-session";

describe("ReplayProtectionClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates deterministic headers from nonce timestamp path and body", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-05-10T00:00:00.000Z").getTime());

    const body = { hello: "world", count: 2 };
    const material = createTestReplaySigningMaterial();
    const headers = ReplayProtectionClient.generateHeaders(body, "/relay/proxy/chat/completions", material);
    const expectedTimestamp = "1778371200";
    const expectedSign = crypto
      .createHmac("sha256", material.signingKey)
      .update(`${headers["X-Nonce"]}${expectedTimestamp}/relay/proxy/chat/completions${JSON.stringify(body)}`)
      .digest("hex");

    expect(headers).toEqual({
      "X-Nonce": expect.stringMatching(/^[a-f0-9]{32}$/),
      "X-Timestamp": expectedTimestamp,
      "X-Sign": expectedSign,
      "X-Replay-Session-Id": material.sessionId,
    });
  });

  it("uses an empty string payload when body is nullish", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-05-10T00:00:01.000Z").getTime());

    const material = createTestReplaySigningMaterial();
    const headers = ReplayProtectionClient.generateHeaders(undefined, "/ping", material);
    const expectedTimestamp = "1778371201";

    expect(headers["X-Nonce"]).toMatch(/^[a-f0-9]{32}$/);
    expect(headers["X-Timestamp"]).toBe(expectedTimestamp);
    expect(headers["X-Sign"]).toBe(
      crypto
        .createHmac("sha256", material.signingKey)
        .update(`${headers["X-Nonce"]}${expectedTimestamp}/ping`)
        .digest("hex"),
    );
    expect(headers["X-Replay-Session-Id"]).toBe(material.sessionId);
  });
});
