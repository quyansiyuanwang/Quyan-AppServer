import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { DeveloperProductAccountAdminService } from "@/services/developer/developer-product-account-admin.service";
import { DeveloperProductPlatformService } from "@/services/developer/developer-product-platform.service";
import { PlatformDeveloperAccountReadRepository } from "@/store/developer/platform-developer-account-read.repository";
import { platformDeveloperAccountArn } from "@/iam/resources/platform-developer-account-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode,
  service = DeveloperProductAccountAdminService.getInstance(),
  repo = PlatformDeveloperAccountReadRepository.getInstance();
const action = "quyan:developer:ListProductAccounts";
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
describe("platform product account lists database", () => {
  it("hydrates only permitted actual records and retains the existing response", async () => {
    await group();
    const kv = await create(),
      push = await create("push");
    await deny(platformDeveloperAccountArn(push.id));
    const hydrate = vi.spyOn(repo, "hydrate");
    expect(await service.list(request())).toEqual([
      expect.objectContaining({
        id: kv.id,
        accountOwnerId: kv.accountOwnerId,
        accountOwnerDisplayName: "fixture account",
        productCode: "kv",
        dailyFreeQuota: 100,
        instanceLimit: 2,
      }),
    ]);
    expect(hydrate.mock.calls.flatMap((c) => c[1].map((t) => t.id))).not.toContain(push.id);
  });
  it("filters by actual product before authorization and hydration", async () => {
    await group();
    const kv = await create();
    await create("push");
    const scan = vi.spyOn(repo, "scan");
    expect((await service.list(request(), "kv")).map((r) => r.id)).toEqual([kv.id]);
    expect(scan).toHaveBeenCalledWith(expect.anything(), undefined, "kv");
  });
  it("does not let an account-level resource grant authorize platform records", async () => {
    await group();
    await create();
    await prisma.user.update({
      where: { id: actor },
      data: { permissionRemoves: [Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE] },
    });
    expect(() =>
      parseIamPolicy({
        Version: "1",
        Statement: { Effect: "Allow", Action: action, Resource: "acs:quyan:*:" + owner + ":account" },
      }),
    ).toThrow();
    expect(await service.list(request())).toEqual([]);
  });
  it("requires real platform eligibility despite ownership or wildcard grants", async () => {
    await create();
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
    const req = request();
    req.user!.userId = owner;
    req.authContext!.principalUserId = owner;
    await expect(service.list(req)).rejects.toMatchObject({ statusCode: 403 });
    const global = await group();
    await prisma.group.update({ where: { id: global.id }, data: { accountOwnerId: owner } });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps disabled or expired usage records but filters deleted records and inactive owners", async () => {
    await group();
    const valid = await create(),
      deleted = await create("push"),
      inactive = await create("status");
    await prisma.developerProductEntitlement.update({
      where: { id: valid.id },
      data: { enabled: false, expiresAt: new Date(0) },
    });
    await prisma.developerProductEntitlement.update({ where: { id: deleted.id }, data: { status: -1 } });
    await prisma.user.update({ where: { id: inactive.accountOwnerId }, data: { status: 0 } });
    expect((await service.list(request())).map((r) => r.id)).toEqual([valid.id]);
  });
  it("preserves update-time ordering and nullable quota semantics", async () => {
    await group();
    const kv = await create(),
      push = await create("push");
    await prisma.developerProductEntitlement.update({
      where: { id: kv.id },
      data: { dailyFreeQuota: null, updateTime: new Date(Date.now() + 1000) },
    });
    const rows = await service.list(request());
    expect(rows.map((r) => r.id)).toEqual([kv.id, push.id]);
    expect(rows[0].dailyFreeQuota).toBeUndefined();
  });
  it("rejects changed record snapshots before returning quota values", async () => {
    await group();
    const row = await create(),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      await prisma.developerProductEntitlement.update({
        where: { id: row.id },
        data: { dailyFreeQuota: 77, updateTime: new Date(Date.now() + 1000) },
      });
      return original(...args);
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects changed primary-account snapshots rather than exposing new display data", async () => {
    await group();
    const row = await create(),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      await prisma.user.update({
        where: { id: row.accountOwnerId },
        data: { displayName: "changed", updateTime: new Date(Date.now() + 1000) },
      });
      return original(...args);
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds hydrated results when a new Deny is introduced", async () => {
    await group();
    const row = await create(),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      const rows = await original(...args);
      await deny(platformDeveloperAccountArn(row.id));
      return rows;
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds results when platform eligibility is revoked", async () => {
    const global = await group();
    await create();
    const original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      const rows = await original(...args);
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return rows;
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not lazily create product configurations or other account records", async () => {
    await group();
    await create();
    const configs = await prisma.developerProductConfig.count(),
      accounts = await prisma.developerProductEntitlement.count();
    await service.list(request());
    expect(await prisma.developerProductConfig.count()).toBe(configs);
    expect(await prisma.developerProductEntitlement.count()).toBe(accounts);
  });
  it("uses only explicit role record grants and rejects revoked sessions", async () => {
    await group();
    const row = await create();
    await create("push");
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "account-read-" + randomUUID() } });
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
    expect(await service.list(req)).toEqual([]);
    await bind(
      { Version: "1", Statement: { Effect: "Allow", Action: action, Resource: platformDeveloperAccountArn(row.id) } },
      "role",
      role.id,
    );
    expect((await service.list(req)).map((r) => r.id)).toEqual([row.id]);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.list(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("calls the original list once in %s", async (mode) => {
    await group();
    const row = await create();
    await deny(platformDeveloperAccountArn(row.id));
    env.security.iamAuthorizationMode = mode;
    const display = vi.spyOn(DeveloperProductPlatformService.getInstance(), "listAccounts");
    expect((await service.list(request(), "kv")).map((r) => r.id)).toEqual([row.id]);
    expect(display).toHaveBeenCalledOnce();
  });
  it("fails closed on corrupt quotas and malformed product codes", async () => {
    await group();
    const row = await create();
    await prisma.developerProductEntitlement.update({ where: { id: row.id }, data: { instanceLimit: 0 } });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list(request(), "unknown" as any)).rejects.toMatchObject({ statusCode: 403 });
  });
});
