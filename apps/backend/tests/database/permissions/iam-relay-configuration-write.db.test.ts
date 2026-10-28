import { DEFAULT_RELAY_CONFIG } from "@/constant/relay-config";
import * as conditionContext from "@/iam/request/condition-context";
import { RECORD_STATUS } from "@/constant/status";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformRelayConfigurationWriteIamService } from "@/services/relay/platform-relay-configuration-write-iam.service";
import { PlatformRelayConfigurationWriteRepository } from "@/store/relay/platform-relay-configuration-write.repository";
import { RelayConfigService } from "@/services/relay/relay-config.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { platformRelayConfigurationArn } from "@/iam/resources/platform-relay-configuration-resources";
import {
  platformModelPricingArn,
  platformModelPricingCollectionArn,
} from "@/iam/resources/platform-model-pricing-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
import type { UpdateRelayConfigRequest } from "@/api/dto/relay/relay-config.dto";
let owner: string, actor: string, configId: string;
const action = "quyan:relay:UpdateConfiguration",
  originalMode = env.security.iamAuthorizationMode,
  service = PlatformRelayConfigurationWriteIamService.getInstance(),
  repo = PlatformRelayConfigurationWriteRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "relay-config-write-" + randomUUID(),
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
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const rate = (model = "fixture/model") => ({
  model,
  inputPrice: 1.25,
  outputPrice: 2.5,
  cacheCreationMultiplier: 1.75,
  cacheReadMultiplier: 0.25,
});
const price = (model = "fixture/model", status = 1) =>
  prisma.modelPricing.create({
    data: { model, status, inputPrice: 1.25, outputPrice: 2.5, pricingType: "token-based", provider: "fixture" },
  });
async function group(accountOwnerId: string | null = null, permission = Permission.MODEL_PRICING_UPDATE) {
  const row = await prisma.group.create({
    data: {
      username: "relay-config-write-" + randomUUID(),
      name: "fixture global",
      level: 0,
      accountOwnerId,
      permissions: [permission],
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function bind(
  effect: "Allow" | "Deny",
  resources: string[],
  operation = action,
  principalType = "user",
  principalId = actor,
  condition?: Record<string, Record<string, string>>,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: {
      Effect: effect,
      Action: operation,
      Resource: resources,
      ...(condition ? { Condition: condition } : {}),
    },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "relay-config-write-" + randomUUID(),
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
async function roleRequest(resources: string[]) {
  const role = await prisma.ramRole.create({
    data: { accountOwnerId: owner, name: "relay-config-write-" + randomUUID() },
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
  await bind("Allow", resources, action, "role", role.id);
  const req = request();
  Object.assign(req.authContext!, { assumedRoleId: role.id, roleSessionId: session.id });
  return { req, role, session };
}
const savedConfig = () => prisma.relayConfig.findUniqueOrThrow({ where: { id: configId } });
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  await prisma.relayChannel.deleteMany();
  await prisma.modelPricing.deleteMany();
  await prisma.relayConfig.deleteMany();
  owner = await user();
  actor = await user(owner);
  configId = (await prisma.relayConfig.create({ data: { maxConcurrency: 5 } })).id;
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
describe("atomic relay configuration writes", () => {
  it("updates, restores, creates and deletes prices together with configuration", async () => {
    await group();
    const active = await price("a"),
      archived = await price("b", -1),
      omitted = await price("omitted"),
      inactive = await price("inactive", 0);
    const result = await service.write(
      {
        maxConcurrency: 7,
        modelRates: [rate("a"), { ...rate("b"), pricingType: "per-request", fixedPrice: 0 }, rate("new")],
      },
      request(),
    );
    expect(result.maxConcurrency).toBe(7);
    expect(result.modelRates.map((item) => item.model)).toEqual(["a", "b", "new"]);
    expect(
      (await prisma.modelPricing.findUniqueOrThrow({ where: { id: active.id } })).cacheCreationMultiplier.toNumber(),
    ).toBe(1.75);
    expect(await prisma.modelPricing.findUniqueOrThrow({ where: { id: archived.id } })).toMatchObject({ status: 1 });
    expect((await prisma.modelPricing.findUniqueOrThrow({ where: { id: archived.id } })).fixedPrice!.toNumber()).toBe(
      0,
    );
    expect(await prisma.modelPricing.findUniqueOrThrow({ where: { id: omitted.id } })).toMatchObject({
      status: RECORD_STATUS.DELETED,
    });
    expect(await prisma.modelPricing.findUniqueOrThrow({ where: { id: inactive.id } })).toMatchObject({ status: 0 });
  });
  it.each(["input", "omitted", "archived"])("rolls back the whole operation on a denied %s record", async (kind) => {
    await group();
    const first = await price("a"),
      second = await price("b", kind === "archived" ? -1 : 1);
    await bind("Deny", [platformModelPricingArn(second.id)]);
    const input = { maxConcurrency: 7, modelRates: kind === "omitted" ? [rate("a")] : [rate("a"), rate("b")] };
    await expect(service.write(input, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await savedConfig()).maxConcurrency).toBe(5);
    expect(
      (await prisma.modelPricing.findUniqueOrThrow({ where: { id: first.id } })).cacheCreationMultiplier.toNumber(),
    ).toBe(1.25);
    expect((await prisma.modelPricing.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
      kind === "archived" ? -1 : 1,
    );
  });
  it("requires the creation boundary in addition to a new price ARN", async () => {
    await group();
    await bind("Deny", [platformModelPricingCollectionArn()]);
    await expect(service.write({ maxConcurrency: 7, modelRates: [rate("new")] }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await savedConfig()).maxConcurrency).toBe(5);
    expect(await prisma.modelPricing.count()).toBe(0);
  });
  it("checks generated actual IDs before commit and rolls back a denied new record", async () => {
    await group();
    await bind("Deny", ["acs:platform:*:platform:model-pricing/*"]);
    const decisions = vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany");
    await expect(service.write({ maxConcurrency: 7, modelRates: [rate("new")] }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(
      decisions.mock.calls
        .flatMap(([input]) => input.resources)
        .some((resource) => resource.startsWith("acs:platform:*:platform:model-pricing/")),
    ).toBe(true);
    expect((await savedConfig()).maxConcurrency).toBe(5);
    expect(await prisma.modelPricing.count()).toBe(0);
  });
  it("leaves prices unchanged when omitted and filters response prices through read grants", async () => {
    await group();
    const allowed = await price("a"),
      denied = await price("b");
    await bind("Deny", ["acs:platform:*:platform:model-pricing/*"]);
    await bind("Deny", [platformModelPricingArn(denied.id)], "quyan:relay:GetConfiguration");
    const result = await service.write({ maxConcurrency: 7 }, request());
    expect(result.modelRates.map((item) => item.model)).toEqual(["a"]);
    expect((await savedConfig()).maxConcurrency).toBe(7);
    expect((await prisma.modelPricing.findUniqueOrThrow({ where: { id: allowed.id } })).status).toBe(1);
    expect((await prisma.modelPricing.findUniqueOrThrow({ where: { id: denied.id } })).status).toBe(1);
  });
  it("treats an empty price list as a checked deletion of every active price", async () => {
    await group();
    const row = await price(),
      inactive = await price("inactive", -1);
    expect((await service.write({ modelRates: [] }, request())).modelRates).toEqual([]);
    expect((await prisma.modelPricing.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(RECORD_STATUS.DELETED);
    expect((await prisma.modelPricing.findUniqueOrThrow({ where: { id: inactive.id } })).status).toBe(-1);
  });
  it("can save with a write-only role without failing on a post-commit read", async () => {
    await group();
    const row = await price(),
      { req } = await roleRequest([platformRelayConfigurationArn(), platformModelPricingArn(row.id)]);
    const result = await service.write({ maxConcurrency: 7, modelRates: [rate()] }, req);
    expect(result.maxConcurrency).toBe(7);
    expect(result.modelRates).toEqual([]);
    expect((await savedConfig()).maxConcurrency).toBe(7);
  });
  it("does not restore inherited user grants in a role session", async () => {
    await group();
    const row = await price(),
      { req } = await roleRequest([platformRelayConfigurationArn()]);
    await expect(service.write({ maxConcurrency: 7, modelRates: [rate()] }, req)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await savedConfig()).maxConcurrency).toBe(5);
    expect((await prisma.modelPricing.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(1);
  });
  it.each(["root", "additions", "private-group", "read-only-group"])(
    "cannot manufacture write eligibility using %s",
    async (kind) => {
      await bind("Allow", ["*"]);
      const req = request();
      if (kind === "root") {
        req.user!.userId = owner;
        req.authContext!.principalUserId = owner;
      }
      if (kind === "additions")
        await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.MODEL_PRICING_UPDATE] } });
      if (kind === "private-group") await group(owner);
      if (kind === "read-only-group") await group(null, Permission.MODEL_PRICING_READ);
      await expect(service.write({ maxConcurrency: 7 }, req)).rejects.toMatchObject({ statusCode: 403 });
      expect((await savedConfig()).maxConcurrency).toBe(5);
    },
  );
  it.each(["root", "access-key"])("supports a qualified %s without bypassing an explicit deny", async (kind) => {
    const global = await group();
    if (kind === "root") {
      actor = owner;
      await prisma.user.update({ where: { id: owner }, data: { groupId: global.id } });
    }
    const req = request();
    if (kind === "access-key") Object.assign(req.authContext!, { subjectType: "access_key" });
    await bind("Deny", [platformRelayConfigurationArn()]);
    await expect(service.write({ maxConcurrency: 7 }, req)).rejects.toMatchObject({ statusCode: 403 });
    expect((await savedConfig()).maxConcurrency).toBe(5);
  });
  it("initializes a missing configuration only through an explicit authorized save", async () => {
    await group();
    await prisma.relayConfig.deleteMany();
    const result = await service.write({ maxConcurrency: 7 }, request());
    expect(result.maxConcurrency).toBe(7);
    expect(result.queueTimeout).toBe(DEFAULT_RELAY_CONFIG.queueTimeout);
    expect(result.id).toBeTruthy();
    expect(await prisma.relayConfig.count({ where: { status: 1 } })).toBe(1);
  });
  it("rejects a concurrent first save without overwriting its configuration", async () => {
    await group();
    await prisma.relayConfig.deleteMany();
    const original = repo.write.bind(repo);
    vi.spyOn(repo, "write").mockImplementationOnce(async (...args) => {
      await prisma.relayConfig.create({ data: { ...DEFAULT_RELAY_CONFIG, maxConcurrency: 11 } });
      return original(...args);
    });
    await expect(service.write({ maxConcurrency: 7 }, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.relayConfig.count({ where: { status: 1 } })).toBe(1);
    expect((await prisma.relayConfig.findFirstOrThrow({ where: { status: 1 } })).maxConcurrency).toBe(11);
  });
  it("cannot bootstrap a missing configuration when its exact resource is denied", async () => {
    await group();
    await prisma.relayConfig.deleteMany();
    await bind("Deny", [platformRelayConfigurationArn()]);
    await expect(service.write({ maxConcurrency: 7 }, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.relayConfig.count()).toBe(0);
  });
  it.each(["config", "pricing"] as const)(
    "rejects %s changes preserving updateTime before its transaction",
    async (source) => {
      await group();
      const config = await savedConfig(),
        row = await price(),
        original = repo.write.bind(repo);
      vi.spyOn(repo, "write").mockImplementation(async (...args) => {
        if (source === "config")
          await prisma.relayConfig.update({
            where: { id: configId },
            data: { maxConcurrency: 11, updateTime: config.updateTime },
          });
        else
          await prisma.modelPricing.update({
            where: { id: row.id },
            data: { inputPrice: 99, updateTime: row.updateTime },
          });
        return original(...args);
      });
      await expect(service.write({ maxConcurrency: 7, modelRates: [rate()] }, request())).rejects.toMatchObject({
        statusCode: 403,
      });
      expect((await savedConfig()).maxConcurrency).toBe(source === "config" ? 11 : 5);
    },
  );
  it("rejects a concurrently inserted requested archived model instead of restoring an unchecked ID", async () => {
    await group();
    const original = repo.write.bind(repo);
    vi.spyOn(repo, "write").mockImplementation(async (...args) => {
      await price("new", -1);
      return original(...args);
    });
    await expect(service.write({ maxConcurrency: 7, modelRates: [rate("new")] }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await savedConfig()).maxConcurrency).toBe(5);
    expect((await prisma.modelPricing.findUniqueOrThrow({ where: { model: "new" } })).status).toBe(-1);
  });
  it.each(["deny", "group", "session"])(
    "refuses a %s change after admission and before its transaction",
    async (kind) => {
      const global = await group(),
        original = repo.write.bind(repo);
      let req = request(),
        sessionId: string | undefined;
      if (kind === "session") {
        const session = await roleRequest([platformRelayConfigurationArn()]);
        req = session.req;
        sessionId = session.session.id;
      }
      vi.spyOn(repo, "write").mockImplementation(async (...args) => {
        if (kind === "deny") await bind("Deny", [platformRelayConfigurationArn()]);
        if (kind === "group") await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
        if (kind === "session")
          await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
        return original(...args);
      });
      await expect(service.write({ maxConcurrency: 7 }, req)).rejects.toMatchObject({ statusCode: 403 });
      expect((await savedConfig()).maxConcurrency).toBe(5);
    },
  );
  it("withholds response prices when a real Date condition expires without denying the write", async () => {
    await group();
    const row = await price(),
      original = repo.write.bind(repo),
      expiresAt = new Date(Date.now() + 60000);
    let now = new Date(expiresAt.getTime() - 30000);
    await bind("Deny", [platformModelPricingArn(row.id)], "quyan:relay:GetConfiguration", "user", actor, {
      DateGreaterThanEquals: { "acs:CurrentTime": expiresAt.toISOString() },
    });
    const originalContext = conditionContext.requestConditionContext;
    vi.spyOn(conditionContext, "requestConditionContext").mockImplementation((req, principal) => ({
      ...originalContext(req, principal),
      "acs:CurrentTime": now.toISOString(),
      "quyan:EpochTime": now.getTime() / 1000,
    }));
    vi.spyOn(repo, "write").mockImplementation(async (target, data, rates, guard) => {
      const readable = guard.readablePricingIds;
      return original(target, data, rates, {
        ...guard,
        readablePricingIds: async (ids) => {
          const allowed = await readable(ids);
          now = new Date(expiresAt.getTime() + 1);
          return allowed;
        },
      });
    });
    const result = await service.write({ maxConcurrency: 7 }, request());
    expect(result.maxConcurrency).toBe(7);
    expect(result.modelRates).toEqual([]);
    expect((await savedConfig()).maxConcurrency).toBe(7);
    expect((await prisma.modelPricing.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(1);
  });
  it("rolls back successful SQL writes if the final decision denies", async () => {
    await group();
    const original = repo.write.bind(repo);
    vi.spyOn(repo, "write").mockImplementation(async (target, data, rates, guard) => {
      let evaluations = 0;
      const require = guard.requireResources;
      return original(target, data, rates, {
        ...guard,
        requireResources: async (resources) => {
          await require(resources);
          if (++evaluations === 2) throw new Error("fixture final denial");
        },
      });
    });
    await expect(service.write({ maxConcurrency: 7, modelRates: [rate("new")] }, request())).rejects.toThrow(
      "fixture final denial",
    );
    expect((await savedConfig()).maxConcurrency).toBe(5);
    expect(await prisma.modelPricing.count()).toBe(0);
  });
  // Real 500+ resource reads/writes and authorization rechecks need a bounded CI database budget.
  it("batches and admits every one of more than 500 omitted prices", { timeout: 30_000 }, async () => {
    await group();
    await prisma.modelPricing.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        id: "price-" + index,
        model: "model-" + index,
        inputPrice: 1,
        outputPrice: 2,
      })),
    });
    const decisions = vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany");
    expect((await service.write({ modelRates: [] }, request())).modelRates).toEqual([]);
    expect(await prisma.modelPricing.count({ where: { status: 1 } })).toBe(0);
    expect(decisions.mock.calls.every(([input]) => input.resources.length <= 500)).toBe(true);
  });
  it("retains the strict topology gate inside the transaction", async () => {
    await group();
    await prisma.relayChannel.create({ data: { name: "invalid member", channelType: "pooled-member" } });
    const row = await price();
    await expect(
      service.write({ maxConcurrency: 7, channelTopologyMode: "strict-two-tier", modelRates: [] }, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect((await savedConfig()).channelTopologyMode).toBe("legacy");
    expect((await savedConfig()).maxConcurrency).toBe(5);
    expect((await prisma.modelPricing.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(1);
  });
  it("accepts a real pooled-parent topology and nullable monitoring settings", async () => {
    await group();
    const parent = await prisma.relayChannel.create({ data: { name: "logical pool", channelType: "pooled" } });
    await prisma.relayChannel.create({
      data: { name: "member", channelType: "pooled-member", pooledParentId: parent.id },
    });
    expect(
      (await service.write({ channelTopologyMode: "strict-two-tier", monitorNameMapping: null }, request()))
        .channelTopologyMode,
    ).toBe("strict-two-tier");
    expect((await savedConfig()).monitorNameMapping).toBeNull();
  });
  it("keeps endpoint secrets and arbitrary monitoring JSON out of the business audit", async () => {
    await group();
    await service.write(
      {
        uptimeStatusUrl: "https://example.invalid/?token=fixture-url-secret",
        monitorNameMapping: { "2": "fixture-map-secret" },
        uptimeStaticData: { password: "fixture-json-secret" },
      },
      request(),
    );
    const logs = await prisma.businessLog.findMany({ where: { actorUserId: actor, targetResourceId: configId } });
    expect(logs).toHaveLength(1);
    const text = JSON.stringify(logs[0]!.changes);
    for (const secret of ["fixture-url-secret", "fixture-map-secret", "fixture-json-secret"])
      expect(text).not.toContain(secret);
    expect(logs[0]!.changes).toMatchObject({
      uptimeStatusConfigured: true,
      monitorNameMappingCount: 1,
      uptimeStaticDataProvided: true,
    });
  });
  it.each(["duplicates", "fixed", "formats"])("rejects %s input without saving any configuration", async (kind) => {
    await group();
    const input: UpdateRelayConfigRequest = {
      maxConcurrency: 7,
      modelRates:
        kind === "duplicates"
          ? [rate("a"), rate(" a ")]
          : kind === "fixed"
            ? [{ ...rate(), pricingType: "per-request" }]
            : [{ ...rate(), supportedFormats: "invalid" }],
    };
    await expect(service.write(input, request())).rejects.toMatchObject({ statusCode: 400 });
    expect((await savedConfig()).maxConcurrency).toBe(5);
    expect(await prisma.modelPricing.count()).toBe(0);
  });
  it.each(["legacy", "shadow"] as const)("retains the legacy save and reply once in %s", async (mode) => {
    await group();
    await bind("Deny", [platformRelayConfigurationArn()]);
    env.security.iamAuthorizationMode = mode;
    const legacy = vi.spyOn(RelayConfigService.getInstance(), "updateRelayConfig"),
      native = vi.spyOn(repo, "write");
    const result = await service.write({ maxConcurrency: 7, modelRates: [rate("new")] }, request());
    expect(result.maxConcurrency).toBe(7);
    expect(result.modelRates.map((item) => item.model)).toEqual(["new"]);
    expect(legacy).toHaveBeenCalledOnce();
    expect(native).not.toHaveBeenCalled();
  });
  it("holds the policy-version ranges against revocation while saving", async () => {
    await group();
    const binding = await bind("Allow", [platformRelayConfigurationArn()]);
    const version = await prisma.ramPolicyVersion.findFirstOrThrow({ where: { policyId: binding.policyId } }),
      original = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementationOnce((async (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number },
    ) =>
      original(async (tx) => {
        const update = tx.relayConfig.update.bind(tx.relayConfig);
        vi.spyOn(tx.relayConfig, "update").mockImplementationOnce((async (args: Prisma.RelayConfigUpdateArgs) => {
          await expect(
            original(async (writer) => {
              await writer.$executeRaw`SET SESSION innodb_lock_wait_timeout=1`;
              try {
                await writer.$executeRaw(Prisma.sql`UPDATE ram_policy_versions SET status=0 WHERE id=${version.id}`);
              } finally {
                await writer.$executeRaw`SET SESSION innodb_lock_wait_timeout=50`;
              }
            }),
          ).rejects.toMatchObject({
            code: "P2010",
            meta: { code: "1205", message: expect.stringContaining("Lock wait timeout") },
          });
          return update(args);
        }) as unknown as typeof tx.relayConfig.update);
        return callback(tx);
      }, options)) as unknown as typeof prisma.$transaction);
    expect((await service.write({ maxConcurrency: 7 }, request())).maxConcurrency).toBe(7);
  });
});
