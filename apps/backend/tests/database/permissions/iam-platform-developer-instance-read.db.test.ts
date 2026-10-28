import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { DeveloperProductAccountAdminService } from "@/services/developer/developer-product-account-admin.service";
import { DeveloperProductPlatformService } from "@/services/developer/developer-product-platform.service";
import { PlatformDeveloperInstanceReadRepository } from "@/store/developer/platform-developer-instance-read.repository";
import { platformDeveloperInstanceArn } from "@/iam/resources/platform-developer-instance-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode,
  service = DeveloperProductAccountAdminService.getInstance(),
  repo = PlatformDeveloperInstanceReadRepository.getInstance();
const action = "quyan:developer:ListProductAccountInstances";
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
async function instance(entitlementId: string, accountOwnerId: string) {
  const project = await prisma.developerProject.create({
    data: { userId: accountOwnerId, name: "fixture backing " + randomUUID(), slug: "instance-read-" + randomUUID() },
  });
  return prisma.developerProductInstance.create({
    data: { entitlementId, backingProjectId: project.id, name: "fixture instance", slug: "fixture-" + randomUUID() },
  });
}
describe("platform developer instances row authorization database", () => {
  it("hydrates only authorized actual instances and keeps safe DTOs", async () => {
    await group();
    const account = await create(),
      allowed = await instance(account.id, account.accountOwnerId),
      hidden = await instance(account.id, account.accountOwnerId);
    await deny(platformDeveloperInstanceArn(hidden.id));
    const hydrate = vi.spyOn(repo, "hydrate");
    expect(await service.instances(request(), "kv", account.accountOwnerId)).toEqual([
      expect.objectContaining({
        id: allowed.id,
        accountProductId: account.id,
        productCode: "kv",
        name: "fixture instance",
      }),
    ]);
    expect(hydrate.mock.calls.flatMap((c) => c[2].map((t) => t.id))).not.toContain(hidden.id);
  });
  it("retains disabled instances and filters deleted instances and inactive projects", async () => {
    await group();
    const account = await create(),
      disabled = await instance(account.id, account.accountOwnerId),
      deleted = await instance(account.id, account.accountOwnerId),
      inactive = await instance(account.id, account.accountOwnerId);
    await prisma.developerProductInstance.update({ where: { id: disabled.id }, data: { enabled: false } });
    await prisma.developerProductInstance.update({ where: { id: deleted.id }, data: { status: -1 } });
    await prisma.developerProject.update({ where: { id: inactive.backingProjectId }, data: { status: 0 } });
    expect((await service.instances(request(), "kv", account.accountOwnerId)).map((row) => row.id)).toEqual([
      disabled.id,
    ]);
  });
  it("filters instances with a backing project owned by a different account", async () => {
    await group();
    const account = await create();
    await instance(account.id, await user());
    expect(await service.instances(request(), "kv", account.accountOwnerId)).toEqual([]);
  });
  it("rejects a project snapshot change before hydration", async () => {
    await group();
    const account = await create(),
      row = await instance(account.id, account.accountOwnerId),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      await prisma.developerProject.update({
        where: { id: row.backingProjectId },
        data: { name: "changed", updateTime: new Date(Date.now() + 1000) },
      });
      return original(...args);
    });
    await expect(service.instances(request(), "kv", account.accountOwnerId)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects an instance rebind before returning names", async () => {
    await group();
    const account = await create(),
      row = await instance(account.id, account.accountOwnerId),
      other = await create("push"),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      await prisma.developerProductInstance.update({ where: { id: row.id }, data: { entitlementId: other.id } });
      return original(...args);
    });
    await expect(service.instances(request(), "kv", account.accountOwnerId)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds hydrated results after a new specific Deny", async () => {
    await group();
    const account = await create(),
      row = await instance(account.id, account.accountOwnerId),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      const rows = await original(...args);
      await deny(platformDeveloperInstanceArn(row.id));
      return rows;
    });
    await expect(service.instances(request(), "kv", account.accountOwnerId)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds results when platform eligibility is revoked", async () => {
    const global = await group();
    const account = await create();
    await instance(account.id, account.accountOwnerId);
    const original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      const rows = await original(...args);
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return rows;
    });
    await expect(service.instances(request(), "kv", account.accountOwnerId)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires real global eligibility despite broad account policy", async () => {
    const account = await create();
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.instances(request(), "kv", account.accountOwnerId)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses only role instance grants and rejects revoked sessions", async () => {
    await group();
    const account = await create(),
      row = await instance(account.id, account.accountOwnerId);
    await instance(account.id, account.accountOwnerId);
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "instance-read-" + randomUUID() },
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
    expect(await service.instances(req, "kv", account.accountOwnerId)).toEqual([]);
    await bind(
      { Version: "1", Statement: { Effect: "Allow", Action: action, Resource: platformDeveloperInstanceArn(row.id) } },
      "role",
      role.id,
    );
    expect((await service.instances(req, "kv", account.accountOwnerId)).map((t) => t.id)).toEqual([row.id]);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.instances(req, "kv", account.accountOwnerId)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("honors legacy permission removals and rejects a product mismatch", async () => {
    await group();
    const account = await create();
    await instance(account.id, account.accountOwnerId);
    await prisma.user.update({
      where: { id: actor },
      data: { permissionRemoves: [Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE] },
    });
    expect(await service.instances(request(), "kv", account.accountOwnerId)).toEqual([]);
    await expect(service.instances(request(), "push", account.accountOwnerId)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each(["legacy", "shadow"] as const)("uses the original instance reader once in %s", async (mode) => {
    await group();
    const account = await create(),
      row = await instance(account.id, account.accountOwnerId);
    await deny(platformDeveloperInstanceArn(row.id));
    env.security.iamAuthorizationMode = mode;
    const display = vi.spyOn(DeveloperProductPlatformService.getInstance(), "listManagedInstances"),
      hydrate = vi.spyOn(repo, "hydrate");
    expect((await service.instances(request(), "kv", account.accountOwnerId)).map((t) => t.id)).toEqual([row.id]);
    expect(display).toHaveBeenCalledOnce();
    expect(hydrate).not.toHaveBeenCalled();
  });
});
