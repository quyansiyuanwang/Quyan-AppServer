import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { DeveloperProductConfigAdminService } from "@/services/developer/developer-product-config-admin.service";
import { DeveloperProductPlatformService } from "@/services/developer/developer-product-platform.service";
import { PlatformDeveloperConfigWriteRepository } from "@/store/developer/platform-developer-config-write.repository";
import { PlatformDeveloperConfigWriteIamService } from "@/services/developer/platform-developer-config-write-iam.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import {
  platformDeveloperConfigArn,
  platformDeveloperConfigControlArn,
} from "@/iam/resources/platform-developer-config-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import BusinessLogService from "@/services/system/businesslog.service";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode,
  service = DeveloperProductConfigAdminService.getInstance(),
  repo = PlatformDeveloperConfigWriteRepository.getInstance();
const body = {
  enabled: true,
  defaultDailyQuota: 100,
  overagePrice: 1.25,
  defaultInstanceLimit: 2,
  retentionDays: 30,
  settings: { fixture: "not-a-real-secret" },
  resourceLimits: { maxKeys: 100 },
};
const action = "quyan:developer:UpsertProductConfiguration";
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "config-write-" + randomUUID(),
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
    headers: { "x-action": "quyan:developer:ListProductConfigurations" },
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as TypedRequest;
const create = () =>
  prisma.developerProductConfig.create({
    data: { productCode: "kv", enabled: false, defaultDailyQuota: 5, settings: { fixture: "old" } },
  });
async function group() {
  const row = await prisma.group.create({
    data: {
      username: "config-write-" + randomUUID(),
      name: "fixture global",
      level: 0,
      accountOwnerId: null,
      permissions: [Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE],
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function bind(document: unknown, principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy(document);
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "config-write-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
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
const deny = (resource: string) =>
  bind({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: resource } });
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  await prisma.developerProductConfig.deleteMany();
  owner = await user();
  actor = await user(owner);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
describe("platform developer configuration atomic writes", () => {
  it("creates one authorized product without initializing unrelated products and audits safely", async () => {
    await group();
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    expect(await service.update("kv", body, actor, request())).toMatchObject({
      productCode: "kv",
      overagePrice: 1.25,
      settings: body.settings,
    });
    const rows = await prisma.developerProductConfig.findMany();
    expect(rows).toHaveLength(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor,
        targetResourceId: rows[0].id,
        operationType: "DEVELOPER_PRODUCT_CONFIG_UPDATE",
      }),
    );
    expect(JSON.stringify(audit.mock.calls)).not.toContain("not-a-real-secret");
  });
  it("rejects a denied product creation scope", async () => {
    await group();
    await deny(platformDeveloperConfigControlArn("kv"));
    await expect(service.update("kv", body, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductConfig.count()).toBe(0);
  });
  it("rolls back when the newly generated configuration record is denied", async () => {
    await group();
    await deny("acs:platform:*:platform:developer-product-config/*");
    await expect(service.update("kv", body, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductConfig.count()).toBe(0);
  });
  it("preserves an existing record and checks its specific Deny", async () => {
    await group();
    const row = await create();
    await deny(platformDeveloperConfigArn(row.id));
    await expect(service.update("kv", body, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductConfig.findUnique({ where: { id: row.id } })).toMatchObject({
      enabled: false,
      defaultDailyQuota: 5,
    });
  });
  it("restores the original configuration ID and does not bypass its Deny", async () => {
    await group();
    const row = await create();
    await prisma.developerProductConfig.update({ where: { id: row.id }, data: { status: -1 } });
    await service.update("kv", body, actor, request());
    expect(await prisma.developerProductConfig.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 1,
      defaultDailyQuota: 100,
    });
    await deny(platformDeveloperConfigArn(row.id));
    await expect(service.update("kv", { ...body, enabled: false }, actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("preserves optional JSON fields when they are omitted", async () => {
    await group();
    const row = await create();
    const { settings, resourceLimits, ...input } = body;
    expect(settings).toBeDefined();
    expect(resourceLimits).toBeDefined();
    await service.update("kv", input, actor, request());
    expect(await prisma.developerProductConfig.findUnique({ where: { id: row.id } })).toMatchObject({
      settings: { fixture: "old" },
      resourceLimits: null,
    });
  });
  it("rejects a concurrent configuration update before the transaction", async () => {
    await group();
    const row = await create(),
      original = repo.upsert.bind(repo);
    vi.spyOn(repo, "upsert").mockImplementation(async (...args) => {
      await prisma.developerProductConfig.update({
        where: { id: row.id },
        data: { defaultDailyQuota: 77, updateTime: new Date(Date.now() + 1000) },
      });
      return original(...args);
    });
    await expect(service.update("kv", body, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductConfig.findUnique({ where: { id: row.id } })).toMatchObject({
      defaultDailyQuota: 77,
      enabled: false,
    });
  });
  it("rejects a competing insert instead of overwriting it", async () => {
    await group();
    const original = repo.upsert.bind(repo);
    vi.spyOn(repo, "upsert").mockImplementation(async (...args) => {
      await create();
      return original(...args);
    });
    await expect(service.update("kv", body, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductConfig.findFirst()).toMatchObject({ defaultDailyQuota: 5 });
  });
  it("rejects revoked global eligibility before writing", async () => {
    const global = await group(),
      original = repo.upsert.bind(repo);
    vi.spyOn(repo, "upsert").mockImplementation(async (...args) => {
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return original(...args);
    });
    await expect(service.update("kv", body, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductConfig.count()).toBe(0);
  });
  it("rechecks a newly introduced Deny before mutation", async () => {
    await group();
    const original = repo.upsert.bind(repo);
    vi.spyOn(repo, "upsert").mockImplementation(async (...args) => {
      await deny(platformDeveloperConfigControlArn("kv"));
      return original(...args);
    });
    await expect(service.update("kv", body, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductConfig.count()).toBe(0);
  });
  it("rolls back a write if final policy evaluation fails", async () => {
    await group();
    const row = await create(),
      iam = IamAuthorizationService.getInstance(),
      original = iam.authorize.bind(iam);
    let count = 0;
    vi.spyOn(iam, "authorize").mockImplementation(async (input) => {
      if (input.resource === platformDeveloperConfigArn(row.id) && ++count === 3)
        return { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
      return original(input);
    });
    await expect(service.update("kv", body, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductConfig.findUnique({ where: { id: row.id } })).toMatchObject({
      defaultDailyQuota: 5,
      enabled: false,
    });
  });
  it("requires real platform eligibility rather than account ownership or wildcard grants", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.update("kv", body, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    const req = request();
    req.user!.userId = owner;
    req.authContext!.principalUserId = owner;
    await expect(service.update("kv", body, owner, req)).rejects.toMatchObject({ statusCode: 403 });
    const global = await group();
    await prisma.group.update({ where: { id: global.id }, data: { accountOwnerId: owner } });
    await expect(service.update("kv", body, actor, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("honors legacy permission removals as Deny", async () => {
    await group();
    await prisma.user.update({
      where: { id: actor },
      data: { permissionRemoves: [Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE] },
    });
    await expect(service.update("kv", body, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductConfig.count()).toBe(0);
  });
  it("requires both scopes in an assumed role and rejects revoked sessions", async () => {
    await group();
    const row = await create();
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "config-write-" + randomUUID() } });
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
    await bind(
      {
        Version: "1",
        Statement: { Effect: "Allow", Action: action, Resource: platformDeveloperConfigControlArn("kv") },
      },
      "role",
      role.id,
    );
    await expect(service.update("kv", body, actor, req)).rejects.toMatchObject({ statusCode: 403 });
    await bind(
      { Version: "1", Statement: { Effect: "Allow", Action: action, Resource: platformDeveloperConfigArn(row.id) } },
      "role",
      role.id,
    );
    expect(await service.update("kv", body, actor, req)).toMatchObject({ defaultDailyQuota: 100 });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.update("kv", body, actor, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects invalid products and forged body fields before saving", async () => {
    await group();
    await expect(service.update("unknown" as any, body, actor, request())).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.update("kv", { ...body, accountOwnerId: "other" } as any, actor, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.developerProductConfig.count()).toBe(0);
  });
  it.each(["legacy", "shadow"] as const)("uses the original writer exactly once in %s", async (mode) => {
    await group();
    await deny(platformDeveloperConfigControlArn("kv"));
    env.security.iamAuthorizationMode = mode;
    const legacy = vi.spyOn(DeveloperProductPlatformService.getInstance(), "updateConfig"),
      native = vi.spyOn(repo, "upsert");
    expect(await service.update("kv", body, actor, request())).toMatchObject({ defaultDailyQuota: 100 });
    expect(legacy).toHaveBeenCalledOnce();
    expect(native).not.toHaveBeenCalled();
    expect(await prisma.developerProductConfig.count()).toBe(1);
  });
  it("evaluates shadow directly without persisting a draft", async () => {
    await group();
    expect(
      await PlatformDeveloperConfigWriteIamService.getInstance().upsert("kv", body, actor, request(), false),
    ).toBeUndefined();
    expect(await prisma.developerProductConfig.count()).toBe(0);
  });
});
