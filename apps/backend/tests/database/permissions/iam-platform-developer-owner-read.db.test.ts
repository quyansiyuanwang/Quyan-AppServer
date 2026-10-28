import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { DeveloperProductAccountAdminService } from "@/services/developer/developer-product-account-admin.service";
import { DeveloperProductPlatformService } from "@/services/developer/developer-product-platform.service";
import { PlatformDeveloperOwnerReadRepository } from "@/store/developer/platform-developer-owner-read.repository";
import {
  platformDeveloperAccountArn,
  platformDeveloperAccountScopeArn,
} from "@/iam/resources/platform-developer-account-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, tag: string;
const originalMode = env.security.iamAuthorizationMode,
  service = DeveloperProductAccountAdminService.getInstance(),
  repo = PlatformDeveloperOwnerReadRepository.getInstance();
const action = "quyan:developer:ListProductAccountOwners";
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
  tag = "directory-" + randomUUID();
  owner = await user();
  actor = await user(owner);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
async function primary(index: number) {
  return prisma.user.create({
    data: {
      username: tag + "-" + index,
      displayName: "fixture " + index,
      password: "fixture-only",
      userType: "root",
      permissionAdds: [],
      permissionRemoves: [],
      createTime: new Date(1000000 + index),
    },
  });
}
const directory = (page = 1, pageSize = 20, req = request()) =>
  service.managedList(req, "kv", { keyword: tag, page, pageSize });
describe("platform product primary-account authorized pagination database", () => {
  it("filters before pagination and total counts while supporting unprovisioned primary accounts", async () => {
    await group();
    const a = await primary(1),
      b = await primary(2),
      c = await primary(3);
    const account = await create("kv", b.id);
    await deny(platformDeveloperAccountScopeArn(c.id, "kv"));
    const hydrate = vi.spyOn(repo, "hydrate"),
      result = await directory(1, 1);
    expect(result).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 1,
      records: [{ userId: b.id, account: { id: account.id, dailyFreeQuota: 100 } }],
    });
    expect(await directory(2, 1)).toMatchObject({ total: 2, records: [{ userId: a.id, account: undefined }] });
    expect(hydrate.mock.calls.flatMap((c) => c[2].map((t) => t.id))).not.toContain(c.id);
  });
  it("requires both the owner scope and its actual provisioned record", async () => {
    await group();
    const a = await primary(1),
      b = await primary(2),
      account = await create("kv", a.id);
    await deny(platformDeveloperAccountArn(account.id));
    expect(await directory()).toMatchObject({ total: 1, records: [{ userId: b.id }] });
  });
  it("filters keywords in the database without leaking unfiltered totals", async () => {
    await group();
    const a = await primary(1);
    await primary(2);
    await primary(3);
    expect(await service.managedList(request(), "kv", { keyword: a.username, page: 1, pageSize: 20 })).toMatchObject({
      total: 1,
      records: [{ userId: a.id }],
    });
  });
  it("returns empty records with authorized total on a page beyond the results", async () => {
    await group();
    await primary(1);
    expect(await directory(5, 1)).toEqual({ records: [], total: 1, page: 5, pageSize: 1 });
  });
  it("filters inactive primary accounts and subusers", async () => {
    await group();
    const a = await primary(1),
      b = await primary(2),
      c = await primary(3);
    await prisma.user.update({ where: { id: b.id }, data: { status: 0 } });
    await prisma.user.update({ where: { id: c.id }, data: { userType: "sub_user", accountOwnerId: a.id } });
    expect(await directory()).toMatchObject({ total: 1, records: [{ userId: a.id }] });
  });
  it("rechecks off-page authorizations before returning the total", async () => {
    await group();
    const a = await primary(1);
    await primary(2);
    const original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      const rows = await original(...args);
      await deny(platformDeveloperAccountScopeArn(a.id, "kv"));
      return rows;
    });
    await expect(directory(1, 1)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a competing product record insert for an authorized unprovisioned owner", async () => {
    await group();
    const a = await primary(1),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      await create("kv", a.id);
      return original(...args);
    });
    await expect(directory()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects changed user identities or product snapshots before returning", async () => {
    await group();
    const a = await primary(1),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      await prisma.user.update({
        where: { id: a.id },
        data: { displayName: "changed", updateTime: new Date(Date.now() + 1000) },
      });
      return original(...args);
    });
    await expect(directory()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds directory results after global eligibility is revoked", async () => {
    const global = await group();
    await primary(1);
    const original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      const rows = await original(...args);
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return rows;
    });
    await expect(directory()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires real global eligibility rather than wildcard identity policy", async () => {
    await primary(1);
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(directory()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses only role grants and excludes owners without both permissions", async () => {
    await group();
    const a = await primary(1),
      b = await primary(2),
      account = await create("kv", b.id);
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "directory-role-" + randomUUID() },
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
    expect(await directory(1, 20, req)).toMatchObject({ records: [], total: 0 });
    await bind(
      {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: action,
          Resource: [platformDeveloperAccountScopeArn(a.id, "kv"), platformDeveloperAccountScopeArn(b.id, "kv")],
        },
      },
      "role",
      role.id,
    );
    expect(await directory(1, 20, req)).toMatchObject({ total: 1, records: [{ userId: a.id }] });
    await bind(
      {
        Version: "1",
        Statement: { Effect: "Allow", Action: action, Resource: platformDeveloperAccountArn(account.id) },
      },
      "role",
      role.id,
    );
    expect(await directory(1, 20, req)).toMatchObject({ total: 2 });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(directory(1, 20, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not provision accounts or configs and honors legacy permission removals", async () => {
    await group();
    await primary(1);
    const configs = await prisma.developerProductConfig.count(),
      accounts = await prisma.developerProductEntitlement.count();
    await directory();
    expect(await prisma.developerProductConfig.count()).toBe(configs);
    expect(await prisma.developerProductEntitlement.count()).toBe(accounts);
    await prisma.user.update({
      where: { id: actor },
      data: { permissionRemoves: [Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE] },
    });
    expect(await directory()).toMatchObject({ total: 0, records: [] });
  });
  it.each(["legacy", "shadow"] as const)("uses the original pagination once in %s", async (mode) => {
    await group();
    const a = await primary(1);
    await deny(platformDeveloperAccountScopeArn(a.id, "kv"));
    env.security.iamAuthorizationMode = mode;
    const legacy = vi.spyOn(DeveloperProductPlatformService.getInstance(), "listManagedAccounts"),
      hydrate = vi.spyOn(repo, "hydrate");
    expect(await directory()).toMatchObject({ total: 1, records: [{ userId: a.id }] });
    expect(legacy).toHaveBeenCalledOnce();
    expect(hydrate).not.toHaveBeenCalled();
  });
});
