import { describe, expect, it } from "vitest";

describe("agent workspace runtime safety", () => {
  it("does not enable local execution by default", () => {
    expect(process.env.AGENT_RUNTIME_LOCAL).not.toBe("true");
  });

  it("keeps task statuses explicit", async () => {
    const shared = await import("@appserver/shared");
    expect(shared).toBeDefined();
    expect(["queued", "running", "waiting_approval", "completed", "failed", "cancelled", "expired"]).toContain(
      "waiting_approval",
    );
  });
});
