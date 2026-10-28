import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { DeveloperProductAccountAdminService } from "@/services/developer/developer-product-account-admin.service";
import { DeveloperProductPlatformService } from "@/services/developer/developer-product-platform.service";
import { PlatformDeveloperAccountWriteRepository } from "@/store/developer/platform-developer-account-write.repository";
import { PlatformDeveloperAccountWriteIamService } from "@/services/developer/platform-developer-account-write-iam.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import {
  platformDeveloperAccountArn,
  platformDeveloperAccountScopeArn,
} from "@/iam/resources/platform-developer-account-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import BusinessLogService from "@/services/system/businesslog.service";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, targetOwner: string;
const originalMode = env.security.iamAuthorizationMode,
  service = DeveloperProductAccountAdminService.getInstance(),
  repo = PlatformDeveloperAccountWriteRepository.getInstance();
const body = { dailyFreeQuota: 100, overageEnabled: true, instanceLimit: 2 };
const action = "quyan:developer:UpsertProductAccount";
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "config-write-" + randomUUID(),
        password: "fixture-only",
        userType: accountOwnerId ? "sub_user" : "root",
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
  prisma.developerProductEntitlement.create({
    data: {
      productCode: "kv",
      accountOwnerId: targetOwner,
      dailyFreeQuota: 5,
      instanceLimit: 1,
      issuedByUserId: owner,
    },
  });
async function group() {
  const row = await prisma.group.create({
    data: {
      username: "config-write-" + randomUUID(),
      name: "fixture global",
      level: 0,
      accountOwnerId: null,
      permissions: [Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE],
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
  await prisma.developerProductEntitlement.deleteMany();
  await prisma.developerProductConfig.deleteMany();
  owner = await user();
  actor = await user(owner);
  targetOwner = await user();
  await prisma.developerProductConfig.create({ data: { productCode: "kv", enabled: true } });
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
const update = (input = body, req = request()) => service.update(req, actor, "kv", targetOwner, input);
describe("platform developer product account atomic writes", () => {
  it("creates only the authorized product record with safe audit data", async () => {
    await group();
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    const result = await update();
    expect(result).toMatchObject({
      userId: targetOwner,
      account: { productCode: "kv", dailyFreeQuota: 100, instanceLimit: 2 },
    });
    expect(await prisma.developerProductEntitlement.count()).toBe(1);
    expect(await prisma.developerProductConfig.count()).toBe(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor,
        targetResourceId: result.account!.id,
        operationType: "DEVELOPER_PRODUCT_ACCOUNT_UPDATE",
      }),
    );
  });
  it("requires the specific owner/product scope before creation", async () => {
    await group();
    await deny(platformDeveloperAccountScopeArn(targetOwner, "kv"));
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductEntitlement.count()).toBe(0);
  });
  it("rolls back newly generated records denied by the actual resource pattern", async () => {
    await group();
    await deny("acs:platform:*:platform:developer-product-account/*");
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductEntitlement.count()).toBe(0);
  });
  it("checks existing record IDs and preserves original quota on Deny", async () => {
    await group();
    const row = await create();
    await deny(platformDeveloperAccountArn(row.id));
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductEntitlement.findUnique({ where: { id: row.id } })).toMatchObject({
      dailyFreeQuota: 5,
    });
  });
  it("restores the original record ID while retaining existing enablement and expiry", async () => {
    await group();
    const row = await create();
    await prisma.developerProductEntitlement.update({
      where: { id: row.id },
      data: { status: -1, enabled: false, expiresAt: new Date(0) },
    });
    await update();
    expect(await prisma.developerProductEntitlement.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 1,
      enabled: false,
      expiresAt: new Date(0),
      dailyFreeQuota: 100,
    });
    await deny(platformDeveloperAccountArn(row.id));
    await expect(update({ ...body, dailyFreeQuota: 200 })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("supports nullable per-account quota without granting new access", async () => {
    await group();
    expect(await update({ ...body, dailyFreeQuota: null } as any)).toMatchObject({
      account: { dailyFreeQuota: undefined },
    });
  });
  it("rejects changed owner, configuration and existing-record snapshots", async () => {
    await group();
    const row = await create(),
      original = repo.upsert.bind(repo);
    vi.spyOn(repo, "upsert").mockImplementation(async (...args) => {
      await prisma.user.update({
        where: { id: targetOwner },
        data: { displayName: "changed", updateTime: new Date(Date.now() + 1000) },
      });
      return original(...args);
    });
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    vi.restoreAllMocks();
    vi.spyOn(repo, "upsert").mockImplementation(async (...args) => {
      await prisma.developerProductConfig.update({
        where: { productCode: "kv" },
        data: { defaultDailyQuota: 77, updateTime: new Date(Date.now() + 1000) },
      });
      return original(...args);
    });
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    vi.restoreAllMocks();
    vi.spyOn(repo, "upsert").mockImplementation(async (...args) => {
      await prisma.developerProductEntitlement.update({
        where: { id: row.id },
        data: { dailyFreeQuota: 77, updateTime: new Date(Date.now() + 1000) },
      });
      return original(...args);
    });
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductEntitlement.findUnique({ where: { id: row.id } })).toMatchObject({
      dailyFreeQuota: 77,
    });
  });
  it("rejects a competing insert rather than overwriting it", async () => {
    await group();
    const original = repo.upsert.bind(repo);
    vi.spyOn(repo, "upsert").mockImplementation(async (...args) => {
      await create();
      return original(...args);
    });
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductEntitlement.findFirst()).toMatchObject({ dailyFreeQuota: 5 });
  });
  it("requires an active primary account and an already persisted product configuration", async () => {
    await group();
    await prisma.user.update({ where: { id: targetOwner }, data: { status: 0 } });
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({
      where: { id: targetOwner },
      data: { status: 1, accountOwnerId: owner, userType: "sub_user" },
    });
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: targetOwner }, data: { accountOwnerId: null, userType: "root" } });
    await prisma.developerProductConfig.deleteMany();
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductEntitlement.count()).toBe(0);
  });
  it("rejects revoked global eligibility before writing", async () => {
    const global = await group(),
      original = repo.upsert.bind(repo);
    vi.spyOn(repo, "upsert").mockImplementation(async (...args) => {
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return original(...args);
    });
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductEntitlement.count()).toBe(0);
  });
  it("rolls back writes when the final record evaluation is denied", async () => {
    await group();
    const row = await create(),
      iam = IamAuthorizationService.getInstance(),
      original = iam.authorize.bind(iam);
    let checks = 0;
    vi.spyOn(iam, "authorize").mockImplementation(async (input) => {
      if (input.resource === platformDeveloperAccountArn(row.id) && ++checks === 3)
        return { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
      return original(input);
    });
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerProductEntitlement.findUnique({ where: { id: row.id } })).toMatchObject({
      dailyFreeQuota: 5,
    });
  });
  it("does not manufacture platform eligibility with wildcard policy or owner status", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    const req = request();
    req.user!.userId = owner;
    req.authContext!.principalUserId = owner;
    await expect(service.update(req, owner, "kv", targetOwner, body)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("honors legacy permission removals and validates unknown fields", async () => {
    await group();
    await expect(update({ ...body, accountOwnerId: "other" } as any)).rejects.toMatchObject({ statusCode: 400 });
    await prisma.user.update({
      where: { id: actor },
      data: { permissionRemoves: [Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE] },
    });
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires both scopes on an assumed role and rejects a revoked role session", async () => {
    await group();
    const row = await create();
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "account-write-" + randomUUID() },
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
    await bind(
      {
        Version: "1",
        Statement: { Effect: "Allow", Action: action, Resource: platformDeveloperAccountScopeArn(targetOwner, "kv") },
      },
      "role",
      role.id,
    );
    await expect(update(body, req)).rejects.toMatchObject({ statusCode: 403 });
    await bind(
      { Version: "1", Statement: { Effect: "Allow", Action: action, Resource: platformDeveloperAccountArn(row.id) } },
      "role",
      role.id,
    );
    expect(await update(body, req)).toMatchObject({ account: { id: row.id, dailyFreeQuota: 100 } });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(update(body, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("uses the original account writer once in %s", async (mode) => {
    await group();
    await deny(platformDeveloperAccountScopeArn(targetOwner, "kv"));
    env.security.iamAuthorizationMode = mode;
    const legacy = vi.spyOn(DeveloperProductPlatformService.getInstance(), "updateManagedAccount"),
      native = vi.spyOn(repo, "upsert");
    expect(await update()).toMatchObject({ account: { dailyFreeQuota: 100 } });
    expect(legacy).toHaveBeenCalledOnce();
    expect(native).not.toHaveBeenCalled();
  });
  it("evaluates shadow without creating a product account", async () => {
    await group();
    expect(
      await PlatformDeveloperAccountWriteIamService.getInstance().upsert(
        "kv",
        targetOwner,
        body,
        actor,
        request(),
        false,
      ),
    ).toBeUndefined();
    expect(await prisma.developerProductEntitlement.count()).toBe(0);
  });
});
