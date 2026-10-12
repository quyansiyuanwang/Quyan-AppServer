import { describe, expect, it } from "vitest";
import { SERVER_CONFIG_SECRET_PLACEHOLDER, isSensitiveServerConfigValue } from "@quyan/shared";
import {
  setAutoProxyPoolConfigBodySchema,
  setRelayProxyConfigBodySchema,
  setSiteConfigBodySchema,
} from "@/api/schema/system/config.schema";
describe("platform configuration schema", () => {
  it("accepts a preserved proxy presence marker but rejects unsafe protocols and an enabled empty URL", () => {
    expect(
      setRelayProxyConfigBodySchema.safeParse({ enabled: true, url: SERVER_CONFIG_SECRET_PLACEHOLDER }).success,
    ).toBe(true);
    expect(setRelayProxyConfigBodySchema.safeParse({ enabled: true, url: "" }).success).toBe(false);
    expect(setRelayProxyConfigBodySchema.safeParse({ enabled: true, url: "file:///fixture" }).success).toBe(false);
    expect(
      setRelayProxyConfigBodySchema.safeParse({ enabled: true, url: "socks5h://proxy.example.test:1080" }).success,
    ).toBe(true);
  });
  it("checks numeric auto proxy limits and rejects extra caller fields", () => {
    const valid = { cacheHitRateMinSamples: 10, cacheHitRateWindowHours: 168 };
    expect(setAutoProxyPoolConfigBodySchema.safeParse(valid).success).toBe(true);
    for (const body of [
      { ...valid, cacheHitRateMinSamples: 0 },
      { ...valid, cacheHitRateMinSamples: 1001 },
      { ...valid, cacheHitRateWindowHours: Infinity },
      { ...valid, cacheHitRateWindowHours: 8761 },
      { ...valid, accountId: "foreign" },
    ])
      expect(setAutoProxyPoolConfigBodySchema.safeParse(body).success).toBe(false);
  });
  it("recognizes URL userinfo without treating ordinary URLs or output-token counts as secrets", () => {
    expect(isSensitiveServerConfigValue("url", "https://fixture:credential@example.test")).toBe(true);
    expect(isSensitiveServerConfigValue("url", "socks5://fixture@example.test")).toBe(true);
    expect(isSensitiveServerConfigValue("url", "https://example.test")).toBe(false);
    expect(isSensitiveServerConfigValue("maxOutputTokens", "2048")).toBe(false);
  });
});

it("preserves a masked site URL while continuing to reject invalid replacements", () => {
  expect(setSiteConfigBodySchema.safeParse({ backendPublicUrl: SERVER_CONFIG_SECRET_PLACEHOLDER }).success).toBe(true);
  expect(setSiteConfigBodySchema.safeParse({ backendPublicUrl: "invalid-fixture-url" }).success).toBe(false);
});
