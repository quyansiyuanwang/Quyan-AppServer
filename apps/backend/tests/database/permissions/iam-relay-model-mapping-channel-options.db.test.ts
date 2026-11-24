import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { relayChannelSelectionArn } from "@/iam/resources/relay-channel-selection-resources";
import { RelayChannelCatalogIamService } from "@/services/relay/relay-channel-catalog-iam.service";
import { RelayTokenModelMappingService } from "@/services/relay/relay-token-model-mapping.service";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";
import { RelayChannelCatalogReadRepository } from "@/store/relay/relay-channel-catalog-read.repository";
import { RelayCatalogGraphCache } from "@/store/relay/relay-catalog-graph-cache";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { relayCatalogSourceSelect } from "@/store/relay/relay-catalog-source";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";

let owner: string, standalone: string, automatic: string, pool: string, leaf: string;
const request = () =>
  ({
    user: { userId: owner },
    authContext: { principalUserId: owner, accountOwnerId: owner },
    headers: {},
    secure: true,
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const options = (channelId = standalone, selectedIds: string[] = []) =>
  RelayTokenModelMappingService.getInstance().channelOptions(owner, { draft: { channelId }, selectedIds }, request());
const scoped = (rootIds: string[], includeModelCatalog = false) =>
  RelayChannelCatalogIamService.getInstance().withRoutingSnapshot(
    owner,
    owner,
    request(),
    async (snapshot) => ({
      ids: snapshot.sources.map((row) => row.id).sort(),
      modelCount: snapshot.context.modelCatalog.length,
    }),
    { rootIds, includeModelCatalog },
  );

beforeEach(async () => {
  vi.restoreAllMocks();
  owner = (
    await prisma.user.create({
      data: {
        username: "mapping-options-fixture-" + randomUUID(),
        password: "fixture-only",
        permissionAdds: [Permission.RELAY_TOKEN_READ, Permission.RELAY_CHANNEL_READ],
        permissionRemoves: [],
      },
    })
  ).id;
  const channel = async (channelType: string, pooledParentId?: string) =>
    (
      await prisma.relayChannel.create({
        data: {
          name: "mapping-options-" + channelType,
          channelType,
          pooledParentId,
          allowedFormats: "openai-chat-completions",
          allowedModels: '["fixture-model"]',
        },
      })
    ).id;
  standalone = await channel("standalone");
  automatic = await channel("automatic-proxy-pool");
  pool = await channel("pooled");
  leaf = await channel("pooled-member", pool);
  await prisma.relayChannelMember.create({ data: { relayChannelId: automatic, memberChannelId: pool, priority: 0 } });
  await prisma.modelPricing.create({ data: { model: "fixture-model", inputPrice: 0, outputPrice: 0 } });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.relayChannel.deleteMany({ where: { name: { startsWith: "mapping-options-" } } });
  await prisma.relayChannel.deleteMany({ where: { name: { startsWith: "unrelated fixture channel " } } });
  await prisma.modelPricing.deleteMany({ where: { model: "fixture-model" } });
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.user.deleteMany({ where: { id: owner } });
});

describe("scoped model mapping channel inspection", () => {
  it("checks permissions and visibility again after warming the graph cache", async () => {
    expect((await options()).items).toHaveLength(1);
    await prisma.relayChannel.update({ where: { id: standalone }, data: { visibilityMode: "hidden" } });
    expect((await options()).items).toEqual([]);
    await prisma.relayChannel.update({ where: { id: standalone }, data: { visibilityMode: "public" } });
    expect((await options()).items).toHaveLength(1);
    await prisma.user.update({
      where: { id: owner },
      data: { permissionRemoves: [Permission.RELAY_CHANNEL_READ, Permission.RELAY_TOKEN_READ] },
    });
    await expect(options()).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rebuilds changed graph data even when the write came from another process", async () => {
    const cache = RelayCatalogGraphCache.getInstance();
    const sources = () =>
      prisma.relayChannel.findMany({
        where: { id: { in: [pool, leaf] } },
        select: relayCatalogSourceSelect,
        orderBy: { id: "asc" },
      });
    const first = await cache.get(await sources());
    expect(first.get(pool)?.poolMembers[0]?.enabled).toBe(true);
    first.get(pool)!.poolMembers.length = 0;
    expect((await cache.get(await sources())).get(pool)?.poolMembers).toHaveLength(1);
    await prisma.relayChannel.update({ where: { id: leaf }, data: { pooledMemberEnabled: false } });
    expect((await cache.get(await sources())).get(pool)?.poolMembers[0]?.enabled).toBe(false);
  });

  it("invalidates after committed repository writes and preserves a rolled-back graph", async () => {
    const repository = RelayChannelRepository.getInstance();
    const derive = vi.spyOn(RelayPoolResolverService.getInstance(), "resolveCapabilityLeafCandidates");
    expect((await options()).items[0]?.name).toBe("mapping-options-standalone");
    expect(derive).toHaveBeenCalledOnce();
    expect((await options()).items[0]?.name).toBe("mapping-options-standalone");
    expect(derive).toHaveBeenCalledOnce();
    await repository.updateById(standalone, { name: "mapping-options-renamed" });
    expect((await options()).items[0]?.name).toBe("mapping-options-renamed");
    expect(derive).toHaveBeenCalledTimes(2);
    await expect(
      repository.withTransaction(async (tx) => {
        await repository.updateById(standalone, { name: "mapping-options-rolled-back" }, tx);
        throw new Error("fixture rollback");
      }),
    ).rejects.toThrow("fixture rollback");
    expect((await options()).items[0]?.name).toBe("mapping-options-renamed");
    expect(derive).toHaveBeenCalledTimes(2);
  });

  it("authorizes only reachable channels and leaves unrelated catalogs out of the response", async () => {
    await prisma.relayChannel.createMany({
      data: Array.from({ length: 600 }, (_, index) => ({
        name: "unrelated fixture channel " + index,
      })),
    });
    const decide = vi.spyOn(IamAuthorizationService.getInstance(), "evaluateLoadedPolicies");
    const result = await options();
    expect(result).toMatchObject({ items: [{ id: standalone, name: "mapping-options-standalone" }], total: 1 });
    const channelResources = decide.mock.calls
      .filter(([input]) => input.action === "quyan:relay:ListChannelRoutingCatalog")
      .flatMap(([input]) => input.resources);
    expect(new Set(channelResources)).toEqual(new Set([relayChannelSelectionArn(owner, standalone)]));
    expect(await scoped([standalone])).toEqual({ ids: [standalone], modelCount: 0 });
    expect(await scoped([standalone], true)).toEqual({ ids: [standalone], modelCount: 1 });
  });
  it("expands nested legacy members and strict children without exposing physical members", async () => {
    expect(await scoped([automatic])).toEqual({ ids: [automatic, pool, leaf].sort(), modelCount: 0 });
    const result = await RelayTokenModelMappingService.getInstance().channelOptions(
      owner,
      {
        draft: { routingMode: "automatic-pool", automaticProxyPoolChannelId: automatic },
      },
      request(),
    );
    expect(result.items.map((row) => row.id).sort()).toEqual([automatic, pool].sort());
    expect(JSON.stringify(result)).not.toContain(leaf);
    await expect(options(standalone, [pool])).rejects.toMatchObject({ statusCode: 403 });
  });
  it("retains strict-member overrides over a disabled legacy edge", async () => {
    await prisma.relayChannelMember.create({
      data: { relayChannelId: pool, memberChannelId: leaf, priority: 0, enabled: false },
    });
    const result = await options(pool);
    expect(result.items.map((row) => row.id)).toEqual([pool]);
  });
  it.each(["hidden", "disabled", "provider-disabled"])("does not expose a %s execution leaf", async (kind) => {
    await prisma.relayChannel.update({
      where: { id: leaf },
      data:
        kind === "hidden"
          ? { visibilityMode: "hidden" }
          : kind === "disabled"
            ? { status: 0 }
            : { providerServiceEnabled: false },
    });
    expect((await options(pool)).items).toEqual([]);
  });
  it("rechecks policy changes before releasing a scoped projection", async () => {
    const repository = RelayChannelCatalogReadRepository.getInstance(),
      read = repository.read.bind(repository);
    vi.spyOn(repository, "read").mockImplementation(async (...args) => {
      const result = await read(...args);
      await prisma.user.update({ where: { id: owner }, data: { permissionRemoves: [Permission.RELAY_CHANNEL_READ] } });
      return result;
    });
    await expect(options()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not traverse a pool denied by a resource-specific policy", async () => {
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:relay:ListChannelRoutingCatalog",
        Resource: relayChannelSelectionArn(owner, pool),
      },
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "fixture-pool-deny",
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: owner,
        principalType: "user",
        principalId: owner,
        policyId: policy.id,
        scopeType: "account",
        scopeKey: "account",
        createdBy: owner,
      },
    });
    expect(await scoped([automatic])).toEqual({ ids: [automatic], modelCount: 0 });
    expect((await options(pool)).items).toEqual([]);
  });
  it("matches the original full catalog projection for the same automatic route", async () => {
    const input = { draft: { routingMode: "automatic-pool" as const, automaticProxyPoolChannelId: automatic } };
    const service = RelayTokenModelMappingService.getInstance();
    const optimized = await service.channelOptions(owner, input, request());
    const catalog = RelayChannelCatalogIamService.getInstance(),
      read = catalog.withRoutingSnapshot.bind(catalog);
    vi.spyOn(catalog, "withRoutingSnapshot").mockImplementation(async (actor, target, req, project) =>
      read(actor, target, req, project),
    );
    expect(await service.channelOptions(owner, input, request())).toEqual(optimized);
  });
});
