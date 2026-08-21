import { describe, expect, it } from "vitest";
import { applyRelayTokenV1PathMode } from "@/util/relay-token-path.util";

describe("relay token v1 path mode", () => {
  it("leaves paths unchanged when disabled", () => {
    expect(applyRelayTokenV1PathMode("/responses", "off")).toBe("/responses");
    expect(applyRelayTokenV1PathMode("/v1/responses", "off")).toBe("/v1/responses");
  });

  it("automatically produces exactly one v1 prefix", () => {
    expect(applyRelayTokenV1PathMode("/responses", "auto")).toBe("/v1/responses");
    expect(applyRelayTokenV1PathMode("/v1/responses", "auto")).toBe("/v1/responses");
    expect(applyRelayTokenV1PathMode("/v1/v1/responses", "auto")).toBe("/v1/responses");
    expect(applyRelayTokenV1PathMode("/v2/images/generations", "auto")).toBe("/v2/images/generations");
    expect(applyRelayTokenV1PathMode("/v1beta/models/foo:generateContent", "auto")).toBe(
      "/v1beta/models/foo:generateContent",
    );
  });

  it("always prepends v1 without removing an existing prefix", () => {
    expect(applyRelayTokenV1PathMode("/responses", "always")).toBe("/v1/responses");
    expect(applyRelayTokenV1PathMode("/v1/responses", "always")).toBe("/v1/v1/responses");
  });

  it("removes the relay prefix before applying the policy", () => {
    expect(applyRelayTokenV1PathMode("/relay/proxy/v1/responses", "auto")).toBe("/v1/responses");
  });
});
