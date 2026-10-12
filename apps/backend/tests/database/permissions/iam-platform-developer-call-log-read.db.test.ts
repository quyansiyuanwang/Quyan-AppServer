import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { DeveloperProductAccountAdminService } from "@/services/developer/developer-product-account-admin.service";
import { DeveloperProductPlatformService } from "@/services/developer/developer-product-platform.service";
import { PlatformDeveloperCallLogReadRepository } from "@/store/developer/platform-developer-call-log-read.repository";
import { platformDeveloperCallLogArn } from "@/iam/resources/platform-developer-call-log-resources";
import { DEVELOPER_PRODUCT_CALL_LOG_LIMIT } from "@/constant/developer-product-read";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode,
  service = DeveloperProductAccountAdminService.getInstance(),
  repo = PlatformDeveloperCallLogReadRepository.getInstance();
const action = "quyan:developer:ListProductAccountCalls";
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
  owner = await user();
  actor = await user(owner);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
const log = (entitlementId: string, index = 0) =>
  prisma.developerProductCallLog.create({
    data: {
      entitlementId,
      action: "product:read",
      success: true,
      chargeAmount: 1.25,
      createTime: new Date(1000000 + index),
      details: { fixtureSecret: "not-a-real-secret" },
    },
  });
describe("platform product call log row authorization database", () => {
  it("returns only permitted log records through either lookup path without sensitive details", async () => {
    await group();
    const account = await create(),
      allowed = await log(account.id, 1),
      hidden = await log(account.id, 2);
    await deny(platformDeveloperCallLogArn(hidden.id));
    const hydrate = vi.spyOn(repo, "hydrate");
    const result = await service.calls(request(), "kv", { accountId: account.id });
    expect(result).toEqual([
      expect.objectContaining({ id: allowed.id, entitlementId: account.id, chargeAmount: 1.25 }),
    ]);
    expect(JSON.stringify(result)).not.toContain("not-a-real-secret");
    expect(hydrate.mock.calls.flatMap((c) => c[2].map((t) => t.id))).not.toContain(hidden.id);
    expect(await service.calls(request(), "kv", { userId: account.accountOwnerId })).toEqual(result);
  });
  it("applies the 200-row limit after filtering rather than dropping authorized older logs", async () => {
    await group();
    const account = await create();
    await prisma.developerProductCallLog.createMany({
      data: Array.from({ length: DEVELOPER_PRODUCT_CALL_LOG_LIMIT + 20 }, (_, i) => ({
        entitlementId: account.id,
        action: "product:read",
        success: true,
        createTime: new Date(1000000 + i),
      })),
    });
    const hidden = await prisma.developerProductCallLog.findMany({
      where: { entitlementId: account.id },
      orderBy: { createTime: "desc" },
      take: 20,
      select: { id: true },
    });
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: action, Resource: hidden.map((row) => platformDeveloperCallLogArn(row.id)) },
    });
    const result = await service.calls(request(), "kv", { accountId: account.id });
    expect(result).toHaveLength(DEVELOPER_PRODUCT_CALL_LOG_LIMIT);
    expect(result.some((row) => hidden.some((h) => h.id === row.id))).toBe(false);
  }, 30_000);
  it("does not include deleted rows or other product accounts", async () => {
    await group();
    const account = await create(),
      other = await create("push"),
      allowed = await log(account.id),
      deleted = await log(account.id, 1);
    await log(other.id);
    await prisma.developerProductCallLog.update({ where: { id: deleted.id }, data: { status: -1 } });
    expect((await service.calls(request(), "kv", { accountId: account.id })).map((row) => row.id)).toEqual([
      allowed.id,
    ]);
    await expect(service.calls(request(), "push", { accountId: account.id })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rejects stale log records before loading display data", async () => {
    await group();
    const account = await create(),
      entry = await log(account.id),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      await prisma.developerProductCallLog.update({
        where: { id: entry.id },
        data: { chargeAmount: 99, updateTime: new Date(Date.now() + 1000) },
      });
      return original(...args);
    });
    await expect(service.calls(request(), "kv", { accountId: account.id })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects changed parent account ownership after scanning", async () => {
    await group();
    const account = await create();
    await log(account.id);
    const other = await user(),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      await prisma.developerProductEntitlement.update({ where: { id: account.id }, data: { accountOwnerId: other } });
      return original(...args);
    });
    await expect(service.calls(request(), "kv", { accountId: account.id })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds hydrated results after a new log Deny", async () => {
    await group();
    const account = await create(),
      entry = await log(account.id),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      const rows = await original(...args);
      await deny(platformDeveloperCallLogArn(entry.id));
      return rows;
    });
    await expect(service.calls(request(), "kv", { accountId: account.id })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds logs after platform eligibility is revoked", async () => {
    const global = await group();
    const account = await create();
    await log(account.id);
    const original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      const rows = await original(...args);
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return rows;
    });
    await expect(service.calls(request(), "kv", { accountId: account.id })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires role-specific grants on logs rather than inheriting global groups", async () => {
    await group();
    const account = await create(),
      allowed = await log(account.id),
      hidden = await log(account.id, 1);
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "call-read-" + randomUUID() } });
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
    expect(await service.calls(req, "kv", { accountId: account.id })).toEqual([]);
    await bind(
      {
        Version: "1",
        Statement: { Effect: "Allow", Action: action, Resource: platformDeveloperCallLogArn(allowed.id) },
      },
      "role",
      role.id,
    );
    expect((await service.calls(req, "kv", { accountId: account.id })).map((row) => row.id)).toEqual([allowed.id]);
    expect(hidden.id).not.toBe(allowed.id);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.calls(req, "kv", { accountId: account.id })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires real global eligibility despite wildcard grants", async () => {
    const account = await create();
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.calls(request(), "kv", { accountId: account.id })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("projects legacy removals as Deny on every log", async () => {
    await group();
    const account = await create();
    await log(account.id);
    await prisma.user.update({
      where: { id: actor },
      data: { permissionRemoves: [Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE] },
    });
    expect(await service.calls(request(), "kv", { accountId: account.id })).toEqual([]);
  });
  it.each(["legacy", "shadow"] as const)("uses the original call-log reader once in %s", async (mode) => {
    await group();
    const account = await create(),
      entry = await log(account.id);
    await deny(platformDeveloperCallLogArn(entry.id));
    env.security.iamAuthorizationMode = mode;
    const display = vi.spyOn(DeveloperProductPlatformService.getInstance(), "listCallLogs"),
      hydrate = vi.spyOn(repo, "hydrate");
    expect((await service.calls(request(), "kv", { accountId: account.id })).map((row) => row.id)).toEqual([entry.id]);
    expect(display).toHaveBeenCalledOnce();
    expect(hydrate).not.toHaveBeenCalled();
  });
});
