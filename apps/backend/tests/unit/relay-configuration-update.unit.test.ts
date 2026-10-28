import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prepareRelayConfigurationUpdate, isRelayConfigurationModelName } from "@/util/relay-configuration-update";
import { assertRelayConfigurationTopology } from "@/util/relay-configuration-topology";
import { writeRelayConfigurationModelRates } from "@/store/relay/relay-configuration-model-rates";
import { RECORD_STATUS } from "@/constant/status";
import { DEFAULT_MODEL_PRICING_SUPPORTED_FORMATS } from "@/constant/pricing";
const rate = {
  model: " a ",
  modelId: " alias ",
  inputPrice: 1,
  outputPrice: 2,
  cacheCreationMultiplier: 1.25,
  cacheReadMultiplier: 0.1,
};
const channel = (id: string, channelType = "standalone", pooledParentId: string | null = null) => ({
  id,
  name: id,
  channelType,
  pooledParentId,
});
describe("shared relay configuration write rules", () => {
  it("keeps a missing pricing list distinct from an explicitly empty replacement", () => {
    expect(prepareRelayConfigurationUpdate({ maxConcurrency: 7 }).modelRates).toBeUndefined();
    expect(prepareRelayConfigurationUpdate({ modelRates: [] }).modelRates).toEqual([]);
  });
  it("normalizes model aliases without mutating the caller", () => {
    expect(prepareRelayConfigurationUpdate({ modelRates: [rate] }).modelRates).toEqual([
      {
        ...rate,
        model: "a",
        modelId: "alias",
        pricingType: "token-based",
        fixedPrice: undefined,
        supportedFormats: undefined,
      },
    ]);
    expect(rate.model).toBe(" a ");
    expect(rate.modelId).toBe(" alias ");
  });
  it("keeps nullable mapping semantics and leaves unrelated fields untouched", () => {
    const result = prepareRelayConfigurationUpdate({ monitorNameMapping: null, maxConcurrency: 7 });
    expect(result.configData.monitorNameMapping).toBe(Prisma.DbNull);
    expect(result.configData.maxConcurrency).toBe(7);
    expect(result.configData.channelTopologyMode).toBeUndefined();
  });
  it("accepts zero-cost per-request pricing and rejects missing fixed prices", () => {
    expect(
      prepareRelayConfigurationUpdate({ modelRates: [{ ...rate, pricingType: "per-request", fixedPrice: 0 }] })
        .modelRates?.[0]?.fixedPrice,
    ).toBe(0);
    expect(() => prepareRelayConfigurationUpdate({ modelRates: [{ ...rate, pricingType: "per-request" }] })).toThrow();
  });
  it.each(["", " a ", "a".repeat(201)])("refuses an invalid normalized model name %j", (model) => {
    expect(isRelayConfigurationModelName(model)).toBe(false);
  });
  it("accepts a parent and its actual child in the same topology", () => {
    expect(() =>
      assertRelayConfigurationTopology([
        channel("pool", "pooled"),
        channel("member", "pooled-member", "pool"),
        channel("ordinary"),
      ]),
    ).not.toThrow();
  });
  it.each(["missing", "wrong-kind"])("refuses a %s parent", (kind) => {
    const rows = [channel("member", "pooled-member", "parent")];
    if (kind === "wrong-kind") rows.push(channel("parent"));
    expect(() => assertRelayConfigurationTopology(rows)).toThrow();
  });
  it("refuses leftover legacy members without silently converting them", () => {
    expect(() =>
      assertRelayConfigurationTopology([
        { ...channel("pool", "pooled"), poolMembers: [{ memberChannelId: "ordinary" }] },
        channel("ordinary"),
      ]),
    ).toThrow();
  });
  it("checks automatic-pool members against their actual referenced channel", () => {
    const automatic = { ...channel("automatic", "automatic-proxy-pool"), poolMembers: [{ memberChannelId: "pool" }] };
    expect(() => assertRelayConfigurationTopology([automatic, channel("pool", "pooled")])).not.toThrow();
    expect(() =>
      assertRelayConfigurationTopology([
        automatic,
        channel("pool", "pooled-member", "parent"),
        channel("parent", "pooled"),
      ]),
    ).toThrow();
  });
  it("returns actual IDs for every write including omitted deletion targets", async () => {
    const modelPricing = {
      update: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({ id: "generated" }),
    };
    const ids = await writeRelayConfigurationModelRates(
      { modelPricing } as unknown as Prisma.TransactionClient,
      [
        { ...rate, model: "active", modelId: "alias", pricingType: "token-based" },
        { ...rate, model: "archived", modelId: undefined, pricingType: "per-request", fixedPrice: 0 },
        { ...rate, model: "new", modelId: undefined, pricingType: "token-based" },
      ],
      [
        { id: "old", model: "active", status: RECORD_STATUS.ACTIVE },
        { id: "restore", model: "archived", status: RECORD_STATUS.DELETED },
        { id: "delete", model: "omitted", status: RECORD_STATUS.ACTIVE },
      ],
    );
    expect(ids).toEqual(["old", "restore", "generated", "delete"]);
    expect(modelPricing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "restore" },
        data: expect.objectContaining({ status: RECORD_STATUS.ACTIVE, fixedPrice: 0 }),
      }),
    );
    expect(modelPricing.update).toHaveBeenCalledWith({
      where: { id: "delete" },
      data: { status: RECORD_STATUS.DELETED },
    });
    expect(modelPricing.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: "new", supportedFormats: DEFAULT_MODEL_PRICING_SUPPORTED_FORMATS }),
      }),
    );
  });
});
