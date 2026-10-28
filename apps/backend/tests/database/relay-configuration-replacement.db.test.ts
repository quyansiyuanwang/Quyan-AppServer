import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { RelayConfigService } from "@/services/relay/relay-config.service";
import { RECORD_STATUS } from "@/constant/status";
let actor: string, configId: string;
const service = RelayConfigService.getInstance(),
  rate = (model: string) => ({
    model,
    inputPrice: 1,
    outputPrice: 2,
    cacheCreationMultiplier: 1.25,
    cacheReadMultiplier: 0.1,
  });
beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.relayChannel.deleteMany();
  await prisma.relayConfig.deleteMany();
  await prisma.modelPricing.deleteMany();
  actor = (
    await prisma.user.create({
      data: {
        username: "configuration-rules-" + randomUUID(),
        password: "fixture-only",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
  configId = (await prisma.relayConfig.create({ data: { maxConcurrency: 5 } })).id;
});
afterEach(() => vi.restoreAllMocks());
describe("legacy configuration replacement rules", () => {
  it("preserves prices when omitted and deletes active prices for an empty replacement", async () => {
    const row = await prisma.modelPricing.create({ data: { model: "a", inputPrice: 1, outputPrice: 2 } });
    expect((await service.updateRelayConfig({ maxConcurrency: 7 }, actor)).modelRates).toHaveLength(1);
    expect((await prisma.modelPricing.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(RECORD_STATUS.ACTIVE);
    expect((await service.updateRelayConfig({ modelRates: [] }, actor)).modelRates).toEqual([]);
    expect((await prisma.modelPricing.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(RECORD_STATUS.DELETED);
  });
  it("restores original IDs and preserves zero-cost per-request pricing", async () => {
    const old = await prisma.modelPricing.create({
      data: { model: "old", status: RECORD_STATUS.DELETED, inputPrice: 1, outputPrice: 2 },
    });
    const result = await service.updateRelayConfig(
      { modelRates: [{ ...rate("old"), pricingType: "per-request", fixedPrice: 0 }, rate("new")] },
      actor,
    );
    expect(result.modelRates.map((row) => row.model)).toEqual(["new", "old"]);
    expect((await prisma.modelPricing.findUniqueOrThrow({ where: { model: "old" } })).id).toBe(old.id);
    expect(result.modelRates.find((row) => row.model === "old")?.fixedPrice).toBe(0);
  });
  it("rolls back configuration and earlier price writes when a later insert fails", async () => {
    const row = await prisma.modelPricing.create({ data: { model: "old", inputPrice: 1, outputPrice: 2 } }),
      original = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementationOnce((async (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      original(async (tx) => {
        vi.spyOn(tx.modelPricing, "create").mockRejectedValueOnce(new Error("fixture insert failure"));
        return callback(tx);
      }, options)) as unknown as typeof prisma.$transaction);
    await expect(
      service.updateRelayConfig(
        { maxConcurrency: 7, modelRates: [{ ...rate("old"), inputPrice: 22 }, rate("new")] },
        actor,
      ),
    ).rejects.toThrow("fixture insert failure");
    expect((await prisma.relayConfig.findUniqueOrThrow({ where: { id: configId } })).maxConcurrency).toBe(5);
    expect((await prisma.modelPricing.findUniqueOrThrow({ where: { id: row.id } })).inputPrice.toNumber()).toBe(1);
    expect(await prisma.modelPricing.count({ where: { model: "new" } })).toBe(0);
  });
  it("retains the strict topology gate and logs safe monitoring summaries", async () => {
    await prisma.relayChannel.create({ data: { name: "broken member", channelType: "pooled-member" } });
    await expect(service.updateRelayConfig({ channelTopologyMode: "strict-two-tier" }, actor)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect((await prisma.relayConfig.findUniqueOrThrow({ where: { id: configId } })).channelTopologyMode).toBe(
      "legacy",
    );
    await service.updateRelayConfig(
      {
        uptimeStatusUrl: "https://example.invalid/?token=fixture-secret",
        uptimeStaticData: { password: "fixture-secret" },
      },
      actor,
    );
    const logs = await prisma.businessLog.findMany({ where: { actorUserId: actor } });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0]!.changes)).not.toContain("fixture-secret");
    expect(logs[0]!.changes).toMatchObject({ uptimeStatusConfigured: true, uptimeStaticDataProvided: true });
  });
});
