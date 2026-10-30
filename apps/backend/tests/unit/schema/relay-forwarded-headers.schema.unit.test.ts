import { describe, expect, it } from "vitest";
import { normalizeRelayForwardedHeaderNames, RELAY_FORWARDED_HEADER_LIMITS } from "@quyan/shared";
import {
  createRelayChannelBodySchema,
  updateRelayChannelBodySchema,
  relayChannelExportConfigurationSchema,
  importRelayChannelsBodySchema,
} from "@/api/schema/relay/relay-channel.schema";

describe("relay forwarded request-header configuration", () => {
  it.each([true, false])(
    "preserves the forwarding mode across create, update, export and import: %s",
    (forwardAllRequestHeaders) => {
      const input = {
        name: "fixture",
        routingConfig: { forwardAllRequestHeaders, forwardedRequestHeaders: ["X-Sdk-Custom"] },
      };
      for (const schema of [
        createRelayChannelBodySchema,
        updateRelayChannelBodySchema,
        relayChannelExportConfigurationSchema,
      ]) {
        expect(schema.parse(input).routingConfig).toMatchObject({
          forwardAllRequestHeaders,
          forwardedRequestHeaders: ["x-sdk-custom"],
        });
      }
      expect(importRelayChannelsBodySchema.parse({ channels: [input] }).channels[0]?.routingConfig).toMatchObject({
        forwardAllRequestHeaders,
        forwardedRequestHeaders: ["x-sdk-custom"],
      });
      expect(
        createRelayChannelBodySchema.parse({ name: "fixture", routingConfig: {} }).routingConfig,
      ).not.toHaveProperty("forwardAllRequestHeaders");
    },
  );

  it.each(["true", "false", 1, 0, null, [], {}])(
    "rejects non-boolean forwarding flags: %j",
    (forwardAllRequestHeaders) => {
      expect(updateRelayChannelBodySchema.safeParse({ routingConfig: { forwardAllRequestHeaders } }).success).toBe(
        false,
      );
    },
  );

  it("normalizes, deduplicates and preserves the allowlist across create, update and export contracts", () => {
    for (const schema of [
      createRelayChannelBodySchema,
      updateRelayChannelBodySchema,
      relayChannelExportConfigurationSchema,
    ]) {
      const parsed = schema.parse({
        name: "fixture",
        routingConfig: { forwardedRequestHeaders: [" X-Sdk-Custom ", "x-sdk-custom", "X-Opencode-Session"] },
      });
      expect(parsed.routingConfig?.forwardedRequestHeaders).toEqual(["x-sdk-custom", "x-opencode-session"]);
      expect(
        schema.parse({ name: "fixture", routingConfig: { forwardedRequestHeaders: [] } }).routingConfig
          ?.forwardedRequestHeaders,
      ).toEqual([]);
    }
  });

  it.each([
    "Authorization",
    "X-API-Key",
    "X-Goog-Api-Key",
    "Cookie",
    "Host",
    "Content-Length",
    "Connection",
    "HTTP2-Settings",
    "TE",
    "Forwarded",
    "X-Forwarded-For",
    "X-Internal-Control",
    "X-Quyan-User",
    "X-Relay-Channel",
    "X-Replay-Session-Id",
    "X-Sign",
    "X-Captcha-Token",
    "X-Auth-Token",
    "__proto__",
    "constructor",
    "*",
    "x-sdk-*",
    "bad name",
    "bad:header",
    "x-sdk\r\nheader",
  ])("rejects reserved or malformed names: %s", (name) => {
    expect(updateRelayChannelBodySchema.safeParse({ routingConfig: { forwardedRequestHeaders: [name] } }).success).toBe(
      false,
    );
  });

  it("enforces limits and rejects wrong types without silently dropping them", () => {
    for (const value of [
      null,
      {},
      "x-sdk",
      [123],
      [""],
      ["x".repeat(RELAY_FORWARDED_HEADER_LIMITS.maxNameLength + 1)],
      Array(RELAY_FORWARDED_HEADER_LIMITS.maxNames + 1).fill("x-sdk"),
    ]) {
      expect(normalizeRelayForwardedHeaderNames(value)).toBeUndefined();
      expect(
        updateRelayChannelBodySchema.safeParse({ routingConfig: { forwardedRequestHeaders: value } }).success,
      ).toBe(false);
    }
    expect(
      normalizeRelayForwardedHeaderNames(
        Array.from({ length: RELAY_FORWARDED_HEADER_LIMITS.maxNames }, (_, i) => `x-sdk-${i}`),
      ),
    ).toHaveLength(RELAY_FORWARDED_HEADER_LIMITS.maxNames);
    expect(normalizeRelayForwardedHeaderNames(["x".repeat(RELAY_FORWARDED_HEADER_LIMITS.maxNameLength)])).toHaveLength(
      1,
    );
  });
});
