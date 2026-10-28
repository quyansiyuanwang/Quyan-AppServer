import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformRelayConfigurationReadIamService } from "@/services/relay/platform-relay-configuration-read-iam.service";
import { PlatformRelayConfigurationReadRepository } from "@/store/relay/platform-relay-configuration-read.repository";
import { RelayConfigService } from "@/services/relay/relay-config.service";
import { RelayConfigRepository } from "@/store/relay/relay-config.repository";
import { projectRelayConfiguration, projectRelayModelRates } from "@/services/relay/relay-configuration-projection";
import { platformRelayConfigurationArn } from "@/iam/resources/platform-relay-configuration-resources";
import { platformModelPricingArn } from "@/iam/resources/platform-model-pricing-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const action = "quyan:relay:GetConfiguration",
  originalMode = env.security.iamAuthorizationMode,
  service = PlatformRelayConfigurationReadIamService.getInstance(),
  repo = PlatformRelayConfigurationReadRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "relay-config-read-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
const price = (model = "fixture/model") =>
  prisma.modelPricing.create({
    data: {
      model,
      pricingType: "per-request",
      inputPrice: 1.25,
      outputPrice: 2.5,
      fixedPrice: 0,
      cacheCreationMultiplier: 1.75,
      cacheReadMultiplier: 0.25,
      supportedFormats: "openai",
      provider: "fixture",
    },
  });
async function group(accountOwnerId: string | null = null, permission = Permission.MODEL_PRICING_UPDATE) {
  const row = await prisma.group.create({
    data: {
      username: "relay-config-read-" + randomUUID(),
      name: "fixture global",
      level: 0,
      accountOwnerId,
      permissions: [permission],
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function bind(effect: "Allow" | "Deny", resources: string[], principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: effect, Action: action, Resource: resources } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "relay-config-read-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  return prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType,
      principalId,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  await prisma.relayConfig.deleteMany();
  await prisma.modelPricing.deleteMany();
  owner = await user();
  actor = await user(owner);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
describe("resource-scoped relay configuration reads", () => {
  it("filters denied prices before loading payloads and retains the wire projection", async () => {
    await group();
    const allowed = await price("a/model"),
      denied = await price("b/model");
    const config = await prisma.relayConfig.create({
      data: {
        globalMultiplier: 1.123456,
        enableQueue: false,
        monitorNameMapping: { "2": "fixture monitor" },
        showOnlyConfigured: false,
        uptimeStaticData: [{ id: "2" }],
        channelTopologyMode: "strict-two-tier",
      },
    });
    await bind("Deny", [platformModelPricingArn(denied.id)]);
    const hydrate = vi.spyOn(repo, "hydratePricing");
    expect(await service.read(request())).toEqual(projectRelayConfiguration(config, projectRelayModelRates([allowed])));
    expect(hydrate.mock.calls.flatMap(([targets]) => targets.map((target) => target.recordId))).toEqual([allowed.id]);
    expect((await service.read(request())).modelRates[0]).toMatchObject({
      fixedPrice: 0,
      inputPrice: 1.25,
      cacheReadMultiplier: 0.25,
    });
  });
  it("allows the configuration independently of any price", async () => {
    await group();
    await price();
    await bind("Deny", ["acs:platform:*:platform:model-pricing/*"]);
    expect((await service.read(request())).modelRates).toEqual([]);
  });
  it("cannot read configuration through pricing-only grants", async () => {
    await group();
    await price();
    await bind("Deny", [platformRelayConfigurationArn()]);
    const hydrate = vi.spyOn(repo, "hydratePricing");
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("returns authorized defaults without creating a configuration in enforce", async () => {
    await group();
    await price();
    const create = vi.spyOn(RelayConfigRepository.getInstance(), "create");
    expect((await service.read(request())).id).toBe("");
    expect(await prisma.relayConfig.count()).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
  it.each(["root", "subuser", "additions", "private-group", "wrong-global-permission"])(
    "cannot manufacture platform eligibility through %s",
    async (kind) => {
      const req = request();
      await bind("Allow", ["*"]);
      if (kind === "root") {
        req.user!.userId = owner;
        req.authContext!.principalUserId = owner;
      }
      if (kind === "additions")
        await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.MODEL_PRICING_UPDATE] } });
      if (kind === "private-group") await group(owner);
      if (kind === "wrong-global-permission") await group(null, Permission.MODEL_PRICING_READ);
      await expect(service.read(req)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it.each(["root", "access-key"])("allows qualified %s while retaining resource denies", async (kind) => {
    const global = await group(),
      row = await price();
    let req = request();
    if (kind === "root") {
      actor = owner;
      await prisma.user.update({ where: { id: owner }, data: { groupId: global.id } });
      req = request();
    } else Object.assign(req.authContext!, { subjectType: "access_key" });
    await bind("Deny", [platformModelPricingArn(row.id)]);
    expect((await service.read(req)).modelRates).toEqual([]);
  });
  it.each(["oauth", "impersonation", "missing"])("rejects %s context", async (kind) => {
    await group();
    const req = request();
    if (kind === "oauth") req.oauthAccessToken = {} as never;
    if (kind === "impersonation") req.authContext!.principalUserId = owner;
    if (kind === "missing") req.authContext = undefined;
    await expect(service.read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses only role grants and rejects a revoked session", async () => {
    await group();
    const row = await price(),
      role = await prisma.ramRole.create({
        data: { accountOwnerId: owner, name: "relay-config-read-" + randomUUID() },
      });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    Object.assign(req.authContext!, { assumedRoleId: role.id, roleSessionId: session.id });
    await expect(service.read(req)).rejects.toMatchObject({ statusCode: 403 });
    await bind("Allow", [platformRelayConfigurationArn(), platformModelPricingArn(row.id)], "role", role.id);
    expect((await service.read(req)).modelRates.map((item) => item.model)).toEqual([row.model]);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not fall back on database failures in enforce", async () => {
    await group();
    const legacy = vi.spyOn(RelayConfigService.getInstance(), "getRelayConfig");
    vi.spyOn(repo, "scan").mockRejectedValue(new Error("fixture unavailable"));
    await expect(service.read(request())).rejects.toThrow();
    expect(legacy).not.toHaveBeenCalled();
    expect(await prisma.relayConfig.count()).toBe(0);
  });
  it.each(["config", "pricing"] as const)(
    "rejects a %s content change preserving its updateTime before hydration",
    async (source) => {
      await group();
      const config = await prisma.relayConfig.create({ data: {} }),
        row = await price();
      if (source === "config") {
        const original = repo.hydrateConfiguration.bind(repo);
        vi.spyOn(repo, "hydrateConfiguration").mockImplementation(async (target) => {
          await prisma.relayConfig.update({
            where: { id: config.id },
            data: { monitorNameMapping: { changed: "fixture" }, updateTime: config.updateTime },
          });
          return original(target);
        });
      } else {
        const original = repo.hydratePricing.bind(repo);
        vi.spyOn(repo, "hydratePricing").mockImplementation(async (targets) => {
          await prisma.modelPricing.update({
            where: { id: row.id },
            data: { inputPrice: 99, updateTime: row.updateTime },
          });
          return original(targets);
        });
      }
      await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it.each(["config", "pricing"] as const)(
    "discards %s changes after hydration even with unchanged updateTime",
    async (source) => {
      await group();
      const config = await prisma.relayConfig.create({ data: {} }),
        row = await price(),
        original = repo.hydratePricing.bind(repo);
      vi.spyOn(repo, "hydratePricing").mockImplementation(async (targets) => {
        const result = await original(targets);
        if (source === "config")
          await prisma.relayConfig.update({
            where: { id: config.id },
            data: { enableQueue: false, updateTime: config.updateTime },
          });
        else
          await prisma.modelPricing.update({
            where: { id: row.id },
            data: { fixedPrice: 12, updateTime: row.updateTime },
          });
        return result;
      });
      await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it.each(["deny", "group", "binding"])("discards a projected response after %s revocation", async (kind) => {
    const global = await group(),
      row = await price(),
      original = repo.hydratePricing.bind(repo);
    // The native role grant lets the binding case verify detachment rather than legacy group grants.
    let req = request(),
      bindingId: string | undefined;
    if (kind === "binding") {
      const role = await prisma.ramRole.create({
        data: { accountOwnerId: owner, name: "relay-config-read-" + randomUUID() },
      });
      const session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          roleId: role.id,
          subjectUserId: actor,
          sessionName: "fixture",
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      Object.assign(req.authContext!, { assumedRoleId: role.id, roleSessionId: session.id });
      bindingId = (
        await bind("Allow", [platformRelayConfigurationArn(), platformModelPricingArn(row.id)], "role", role.id)
      ).id;
    }
    vi.spyOn(repo, "hydratePricing").mockImplementation(async (targets) => {
      const result = await original(targets);
      if (kind === "deny") await bind("Deny", [platformModelPricingArn(row.id)]);
      if (kind === "group") await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      if (kind === "binding") await prisma.ramAuthorization.delete({ where: { id: bindingId } });
      return result;
    });
    await expect(service.read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("paginates more than 500 same-timestamp prices and includes a configuration tie", async () => {
    await group();
    const time = new Date(Date.now() - 60000);
    await prisma.relayConfig.create({ data: { createTime: time, updateTime: time } });
    await prisma.modelPricing.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        id: "price-" + String(index).padStart(4, "0"),
        model: "model-" + String(index).padStart(4, "0"),
        inputPrice: 1,
        outputPrice: 2,
        createTime: time,
        updateTime: time,
      })),
    });
    const result = await service.read(request());
    expect(result.modelRates).toHaveLength(501);
    expect(result.modelRates[0]!.model).toBe("model-0000");
    expect(result.modelRates[500]!.model).toBe("model-0500");
  });
  it("chooses the latest active configuration and rejects replacement of a missing default", async () => {
    await group();
    const old = await prisma.relayConfig.create({ data: { maxConcurrency: 10, updateTime: new Date(1000) } });
    const current = await prisma.relayConfig.create({ data: { maxConcurrency: 20, updateTime: new Date(2000) } });
    await prisma.relayConfig.create({ data: { status: 0, maxConcurrency: 99 } });
    expect((await service.read(request())).id).toBe(current.id);
    await prisma.relayConfig.deleteMany();
    const original = repo.hydrateConfiguration.bind(repo);
    vi.spyOn(repo, "hydrateConfiguration").mockImplementation(async (target) => {
      await prisma.relayConfig.create({ data: { id: old.id } });
      return original(target);
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("retains legacy bootstrap exactly once in %s", async (mode) => {
    await group();
    await price();
    await bind("Deny", [platformRelayConfigurationArn()]);
    env.security.iamAuthorizationMode = mode;
    const legacy = vi.spyOn(RelayConfigService.getInstance(), "getRelayConfig"),
      native = vi.spyOn(repo, "hydrateConfiguration");
    expect((await service.read(request())).id).not.toBe("");
    expect(legacy).toHaveBeenCalledOnce();
    expect(native).not.toHaveBeenCalled();
    expect(await prisma.relayConfig.count()).toBe(1);
  });
  it("retains the legacy unavailable-store fallback independently of native IAM", async () => {
    await group();
    await price();
    env.security.iamAuthorizationMode = "legacy";
    vi.spyOn(RelayConfigRepository.getInstance(), "findLatestActive").mockRejectedValue(
      new Error("fixture unavailable"),
    );
    expect((await service.read(request())).id).toBe("");
  });
  it.each(["config", "pricing"] as const)(
    "holds a revision lock through Prisma %s payload hydration",
    async (source) => {
      const config = await prisma.relayConfig.create({ data: {} }),
        row = await price(),
        targets = await repo.scan({ cutoff: new Date() });
      const original = prisma.$transaction.bind(prisma);
      const probe = async () => {
        await expect(
          original(async (writer) => {
            await writer.$executeRaw`SET SESSION innodb_lock_wait_timeout=1`;
            try {
              if (source === "config")
                await writer.$executeRaw(Prisma.sql`UPDATE relay_configs SET maxConcurrency=99 WHERE id=${config.id}`);
              else await writer.$executeRaw(Prisma.sql`UPDATE model_pricing SET inputPrice=99 WHERE id=${row.id}`);
            } finally {
              await writer.$executeRaw`SET SESSION innodb_lock_wait_timeout=50`;
            }
          }),
        ).rejects.toMatchObject({
          code: "P2010",
          meta: { code: "1205", message: expect.stringContaining("Lock wait timeout") },
        });
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce((async (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
      ) =>
        original(async (tx) => {
          if (source === "config") {
            const find = tx.relayConfig.findFirst.bind(tx.relayConfig);
            vi.spyOn(tx.relayConfig, "findFirst").mockImplementationOnce((async (
              args?: Prisma.RelayConfigFindFirstArgs,
            ) => {
              await probe();
              return find(args);
            }) as unknown as typeof tx.relayConfig.findFirst);
          } else {
            const find = tx.modelPricing.findMany.bind(tx.modelPricing);
            vi.spyOn(tx.modelPricing, "findMany").mockImplementationOnce((async (
              args?: Prisma.ModelPricingFindManyArgs,
            ) => {
              await probe();
              return find(args);
            }) as unknown as typeof tx.modelPricing.findMany);
          }
          return callback(tx);
        }, options)) as unknown as typeof prisma.$transaction);
      if (source === "config")
        expect(
          (await repo.hydrateConfiguration(targets.find((target) => target.source === source)!))!.maxConcurrency,
        ).toBe(config.maxConcurrency);
      else
        expect(
          (await repo.hydratePricing(targets.filter((target) => target.source === source)))[0]!.inputPrice.toNumber(),
        ).toBe(1.25);
    },
  );
});
