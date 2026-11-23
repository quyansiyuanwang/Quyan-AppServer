import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { RelayTokenModelMappingRule } from "@quyan/shared";
import {
  createRelayTokenBodySchema,
  importRelayTokensBodySchema,
  updateRelayTokenBodySchema,
} from "@/api/schema/relay/relay.schema";
import {
  prepareRelayTokenModelMapping,
  prepareRelayTokenUpdate,
  type RelayTokenUpdatePreparation,
} from "@/services/relay/relay-token-update-preparation";
import { RelayTokenUpdateRepository } from "@/store/relay/relay-token-update.repository";
import { projectRelayTokenConfiguration } from "@/services/relay/relay-token-configuration-projection";

vi.mock("@/config/database", () => ({ prisma: {} }));

const rules: RelayTokenModelMappingRule[] = [
  { source: "model-*", target: "upstream", channelIds: ["channel"], preference: "original-first" },
];

describe("token mapping lifecycle persistence", () => {
  it("preserves omission and makes new rules replace the legacy representation", () => {
    expect(prepareRelayTokenModelMapping({})).toEqual({});
    expect(prepareRelayTokenModelMapping({ modelMappingRules: rules })).toEqual({
      modelMapping: null,
      modelMappingRules: rules,
    });
    expect(prepareRelayTokenModelMapping({ modelMapping: { before: "after" } })).toEqual({
      modelMapping: { before: "after" },
      modelMappingRules: null,
    });
  });

  it.each([{ modelMappingRules: null }, { modelMappingRules: [] }, { modelMapping: null }])(
    "clears both representations explicitly: %j",
    (patch) => {
      expect(prepareRelayTokenModelMapping(patch, { modelMappingRules: rules as unknown as Prisma.JsonValue })).toEqual(
        {
          modelMapping: null,
          modelMappingRules: null,
        },
      );
    },
  );

  it("rejects legacy overwrites of saved advanced rules with a localized error", () => {
    try {
      prepareRelayTokenModelMapping(
        { modelMapping: { replacement: "legacy" } },
        { modelMappingRules: rules as unknown as Prisma.JsonValue },
      );
      expect.fail("legacy overwrite must be rejected");
    } catch (error) {
      expect(error).toMatchObject({ messageKey: "relayToken.modelMappingRulesLegacyOverwrite" });
    }
    expect(() => prepareRelayTokenModelMapping({ modelMapping: {}, modelMappingRules: rules })).toThrow();
  });

  it("allows independent scope duplicates and rejects duplicates in overlapping equal-priority scopes", () => {
    const other = { ...rules[0], channelIds: ["other"] };
    expect(prepareRelayTokenModelMapping({ modelMappingRules: [rules[0], other] }).modelMappingRules).toHaveLength(2);
    expect(() => prepareRelayTokenModelMapping({ modelMappingRules: [rules[0], rules[0]] })).toThrow();
  });

  it("leaves existing composites immutable even for mapping-only patches", async () => {
    const source = Object.freeze({ routingMode: "composite", channelId: null });
    await expect(
      prepareRelayTokenUpdate(source, { modelMappingRules: rules }, {} as RelayTokenUpdatePreparation),
    ).rejects.toThrow();
    expect(source).toEqual({ routingMode: "composite", channelId: null });
  });

  it("stores SQL NULL for cleared JSON, leaves omission untouched and never writes members", async () => {
    const update = vi.fn().mockResolvedValue({ id: "token", channelId: "channel" });
    const tx = { relayToken: { update } } as unknown as Prisma.TransactionClient;
    const repository = RelayTokenUpdateRepository.getInstance();
    await repository.apply(tx, "token", prepareRelayTokenModelMapping({ modelMappingRules: rules }));
    expect(update.mock.calls[0][0].data).toMatchObject({ modelMapping: Prisma.DbNull, modelMappingRules: rules });
    await repository.apply(tx, "token", prepareRelayTokenModelMapping({ modelMappingRules: [] }));
    expect(update.mock.calls[1][0].data).toMatchObject({
      modelMapping: Prisma.DbNull,
      modelMappingRules: Prisma.DbNull,
    });
    await repository.apply(tx, "token", {});
    expect(update.mock.calls[2][0].data).not.toHaveProperty("modelMapping");
    expect(update.mock.calls[2][0].data).not.toHaveProperty("modelMappingRules");
  });

  it("projects advanced rules for both copy and export without emitting a competing legacy field", () => {
    const projected = projectRelayTokenConfiguration(
      {
        name: "rules",
        expiresAt: null,
        routingMode: "ordered",
        automaticProxyPoolChannelId: null,
        blockedAutomaticProxyPoolChannelIds: null,
        channelId: "channel",
        quotaLimit: null,
        allowedModels: null,
        ipWhitelist: null,
        modelMapping: null,
        modelMappingRules: rules as unknown as Prisma.JsonValue,
        requestFormatTransforms: null,
        normalizerConfig: null,
        streamConfig: {},
        contentSafetyConfig: null,
        status: 1,
        channelConfigs: [{ channelId: "channel", priority: 0 }],
        quotaWindows: [],
        failoverConfig: null,
      },
      {
        blockedChannelIds: () => [],
        quotaUnit: () => "amount",
        requestFormatTransforms: () => null,
        normalizerConfig: () => ({
          enabled: false,
          thinkingSignature: false,
          thinkingBudget: false,
          unsupportedImage: false,
          textOnlyModelIds: [],
          v1PathMode: "auto",
        }),
      },
    );
    expect(projected).not.toHaveProperty("modelMapping");
    expect(projected.modelMappingRules).toEqual(rules);
    const serialized = JSON.parse(JSON.stringify(projected));
    expect(serialized).not.toHaveProperty("modelMapping");
    expect(createRelayTokenBodySchema.safeParse(serialized).success).toBe(true);
    expect(importRelayTokensBodySchema.safeParse({ tokens: [serialized] }).success).toBe(true);
  });
});

describe("token mapping save contracts", () => {
  it("preserves rules across create, update and import parsing", () => {
    expect(
      createRelayTokenBodySchema.parse({ channelId: "channel", modelMappingRules: rules }).modelMappingRules,
    ).toEqual(rules);
    expect(updateRelayTokenBodySchema.parse({ modelMappingRules: rules }).modelMappingRules).toEqual(rules);
    expect(
      importRelayTokensBodySchema.parse({ tokens: [{ channelId: "channel", modelMappingRules: rules }] }).tokens[0]
        .modelMappingRules,
    ).toEqual(rules);
  });

  it.each([
    { modelMapping: {}, modelMappingRules: rules },
    { modelMapping: null, modelMappingRules: null },
    { modelMappingRules: Array.from({ length: 101 }, () => rules[0]) },
    { modelMappingRules: [{ ...rules[0], source: "x".repeat(201) }] },
    { modelMappingRules: [{ ...rules[0], target: "x".repeat(201) }] },
    { modelMappingRules: [{ ...rules[0], source: "   " }] },
    { modelMappingRules: [{ ...rules[0], channelIds: Array.from({ length: 101 }, (_, i) => String(i)) }] },
    { modelMappingRules: [rules[0], rules[0]] },
  ])("rejects invalid save payload %j", (patch) => {
    expect(createRelayTokenBodySchema.safeParse({ channelId: "channel", ...patch }).success).toBe(false);
    expect(updateRelayTokenBodySchema.safeParse(patch).success).toBe(false);
    expect(importRelayTokensBodySchema.safeParse({ tokens: [{ channelId: "channel", ...patch }] }).success).toBe(false);
  });

  it("accepts priority-resolved scopes and advisory wildcard overlaps", () => {
    const modelMappingRules = [
      { ...rules[0], channelIds: undefined },
      rules[0],
      { ...rules[0], source: "*-suffix" },
      { ...rules[0], channelIds: ["other"] },
    ];
    expect(updateRelayTokenBodySchema.safeParse({ modelMappingRules }).success).toBe(true);
  });
});
