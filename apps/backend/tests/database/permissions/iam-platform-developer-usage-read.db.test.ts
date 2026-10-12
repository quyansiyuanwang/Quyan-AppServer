import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { DeveloperProductAccountAdminService } from "@/services/developer/developer-product-account-admin.service";
import { DeveloperProductPlatformService } from "@/services/developer/developer-product-platform.service";
import { PlatformDeveloperUsageReadRepository } from "@/store/developer/platform-developer-usage-read.repository";
import { platformDeveloperAccountArn } from "@/iam/resources/platform-developer-account-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { toDatabaseDate, toLegacyDatabaseDate } from "@/util/database-date";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode,
  service = DeveloperProductAccountAdminService.getInstance(),
  repo = PlatformDeveloperUsageReadRepository.getInstance();
const action = "quyan:developer:GetProductAccountUsage";
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "account-read-" + randomUUID(),
        displayName: "fixture account",
        password: "fixture-only",
        accountOwnerId,
        userType: accountOwnerId ? "sub_user" : "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*" },
  }) as unknown as TypedRequest;
const create = async (productCode = "kv", accountOwnerId?: string) =>
  prisma.developerProductEntitlement.create({
    data: {
      productCode,
      accountOwnerId: accountOwnerId ?? (await user()),
      dailyFreeQuota: 100,
      instanceLimit: 2,
      overageEnabled: false,
      issuedByUserId: owner,
    },
  });
async function group() {
  const row = await prisma.group.create({
    data: {
      username: "account-read-" + randomUUID(),
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
    name: "account-read-" + randomUUID(),
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
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
const config = () =>
  prisma.developerProductConfig.create({
    data: { productCode: "kv", enabled: true, defaultDailyQuota: 150, overagePrice: 1.25 },
  });
const usage = (entitlementId: string, requestCount = 30, usageDate = toDatabaseDate()) =>
  prisma.developerProductQuotaUsage.create({ data: { entitlementId, requestCount, usageDate } });
describe("platform product usage resource reads database", () => {
  it("returns identical authorized usage through account and primary-user paths", async () => {
    await group();
    const row = await create();
    await config();
    await usage(row.id);
    const result = await service.usage(request(), "kv", { accountId: row.id });
    expect(result).toEqual({
      entitlementId: row.id,
      productCode: "kv",
      requestCount: 30,
      dailyFreeQuota: 100,
      remainingFree: 70,
      unlimited: false,
      overageEnabled: false,
    });
    expect(await service.usage(request(), "kv", { userId: row.accountOwnerId })).toEqual(result);
  });
  it("denies a specific record before reading counters or pricing through either path", async () => {
    await group();
    const row = await create();
    await deny(platformDeveloperAccountArn(row.id));
    const read = vi.spyOn(repo, "read");
    for (const locator of [{ accountId: row.id }, { userId: row.accountOwnerId }])
      await expect(service.usage(request(), "kv", locator)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("does not let list permissions in an assumed role grant usage access", async () => {
    await group();
    const row = await create();
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "usage-read-" + randomUUID() } });
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
        Statement: {
          Effect: "Allow",
          Action: "quyan:developer:ListProductAccounts",
          Resource: platformDeveloperAccountArn(row.id),
        },
      },
      "role",
      role.id,
    );
    await expect(service.usage(req, "kv", { accountId: row.id })).rejects.toMatchObject({ statusCode: 403 });
    await bind(
      { Version: "1", Statement: { Effect: "Allow", Action: action, Resource: platformDeveloperAccountArn(row.id) } },
      "role",
      role.id,
    );
    expect(await service.usage(req, "kv", { accountId: row.id })).toMatchObject({ entitlementId: row.id });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.usage(req, "kv", { accountId: row.id })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses configured defaults and canonical-day counters before legacy-day counters", async () => {
    await group();
    const row = await create();
    await config();
    await prisma.developerProductEntitlement.update({ where: { id: row.id }, data: { dailyFreeQuota: null } });
    await usage(row.id, 40);
    const canonical = toDatabaseDate(),
      legacy = toLegacyDatabaseDate();
    if (canonical.getTime() !== legacy.getTime()) await usage(row.id, 70, legacy);
    expect(await service.usage(request(), "kv", { accountId: row.id })).toMatchObject({
      requestCount: 40,
      dailyFreeQuota: 150,
      remainingFree: 110,
    });
  });
  it("retains legacy daily-counter fallback without migrating or resetting it", async () => {
    await group();
    const row = await create();
    await config();
    await usage(row.id, 70, toLegacyDatabaseDate());
    expect(await service.usage(request(), "kv", { accountId: row.id })).toMatchObject({ requestCount: 70 });
    expect(await prisma.developerProductQuotaUsage.count()).toBe(1);
  });
  it("preserves zero-price unlimited and missing configuration semantics without provisioning", async () => {
    await group();
    const row = await create();
    await prisma.developerProductEntitlement.update({ where: { id: row.id }, data: { dailyFreeQuota: null } });
    expect(await service.usage(request(), "kv", { accountId: row.id })).toMatchObject({
      requestCount: 0,
      dailyFreeQuota: 0,
      unlimited: true,
      remainingFree: 0,
    });
    expect(await prisma.developerProductConfig.count()).toBe(0);
    expect(await prisma.developerProductQuotaUsage.count()).toBe(0);
  });
  it("withholds a result if the daily counter changes after initial loading", async () => {
    await group();
    const row = await create();
    const counter = await usage(row.id);
    const original = repo.read.bind(repo);
    let calls = 0;
    vi.spyOn(repo, "read").mockImplementation(async (...args) => {
      const result = await original(...args);
      if (++calls === 1)
        await prisma.developerProductQuotaUsage.update({ where: { id: counter.id }, data: { requestCount: 31 } });
      return result;
    });
    await expect(service.usage(request(), "kv", { accountId: row.id })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds a result if pricing changes after initial loading", async () => {
    await group();
    const row = await create(),
      cfg = await config(),
      original = repo.read.bind(repo);
    let calls = 0;
    vi.spyOn(repo, "read").mockImplementation(async (...args) => {
      const result = await original(...args);
      if (++calls === 1)
        await prisma.developerProductConfig.update({ where: { id: cfg.id }, data: { defaultDailyQuota: 200 } });
      return result;
    });
    await expect(service.usage(request(), "kv", { accountId: row.id })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects revoked eligibility or a new Deny after initial loading", async () => {
    const global = await group();
    const row = await create(),
      original = repo.read.bind(repo);
    vi.spyOn(repo, "read").mockImplementation(async (...args) => {
      const result = await original(...args);
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return result;
    });
    await expect(service.usage(request(), "kv", { accountId: row.id })).rejects.toMatchObject({ statusCode: 403 });
    vi.restoreAllMocks();
    await prisma.group.update({
      where: { id: global.id },
      data: { permissions: [Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE] },
    });
    vi.spyOn(repo, "read").mockImplementation(async (...args) => {
      const result = await original(...args);
      await deny(platformDeveloperAccountArn(row.id));
      return result;
    });
    await expect(service.usage(request(), "kv", { accountId: row.id })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects inactive primary accounts, product mismatches and deleted product records", async () => {
    await group();
    const row = await create();
    await expect(service.usage(request(), "push", { accountId: row.id })).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: row.accountOwnerId }, data: { status: 0 } });
    await expect(service.usage(request(), "kv", { accountId: row.id })).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: row.accountOwnerId }, data: { status: 1 } });
    await prisma.developerProductEntitlement.update({ where: { id: row.id }, data: { status: -1 } });
    await expect(service.usage(request(), "kv", { accountId: row.id })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires actual global eligibility despite wildcard grants", async () => {
    const row = await create();
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.usage(request(), "kv", { accountId: row.id })).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("uses the original usage path once in %s", async (mode) => {
    await group();
    const row = await create();
    await deny(platformDeveloperAccountArn(row.id));
    env.security.iamAuthorizationMode = mode;
    const display = vi.spyOn(DeveloperProductPlatformService.getInstance(), "getUsageForProduct"),
      read = vi.spyOn(repo, "read");
    expect(await service.usage(request(), "kv", { accountId: row.id })).toMatchObject({ entitlementId: row.id });
    expect(display).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });
});
