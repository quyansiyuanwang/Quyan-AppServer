import { DEVELOPER_PRODUCT_CODES } from "@quyan/shared";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { DeveloperProductConfigAdminService } from "@/services/developer/developer-product-config-admin.service";
import { PlatformDeveloperConfigReadRepository } from "@/store/developer/platform-developer-config-read.repository";
import { DeveloperProductPlatformService } from "@/services/developer/developer-product-platform.service";
import { platformDeveloperConfigArn } from "@/iam/resources/platform-developer-config-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode,
  service = DeveloperProductConfigAdminService.getInstance(),
  repo = PlatformDeveloperConfigReadRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "developer-quota-read-" + randomUUID(),
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
const create = (productCode: string) =>
  prisma.developerProductConfig.create({
    data: {
      productCode,
      enabled: true,
      defaultDailyQuota: 100,
      defaultInstanceLimit: 2,
      overagePrice: 1.25,
      settings: { fixture: "value" },
    },
  });
async function group() {
  const row = await prisma.group.create({
    data: {
      username: "developer-quota-read-" + randomUUID(),
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
    name: "developer-quota-read-" + randomUUID(),
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
describe("platform product configuration list database", () => {
  it("returns only authorized actual configurations ordered by product", async () => {
    await group();
    const kv = await create("kv"),
      push = await create("push");
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:developer:ListProductConfigurations",
        Resource: platformDeveloperConfigArn(push.id),
      },
    });
    const hydrate = vi.spyOn(repo, "hydrate");
    expect(await service.list(request())).toEqual([
      expect.objectContaining({
        productCode: kv.productCode,
        overagePrice: 1.25,
        defaultDailyQuota: 100,
        settings: { fixture: "value" },
      }),
    ]);
    expect(hydrate.mock.calls.flatMap((call) => call[1].map((target) => target.id))).not.toContain(push.id);
  });
  it("requires real global management eligibility despite ownership or wildcard grants", async () => {
    await create("kv");
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
    const root = request();
    root.user!.userId = owner;
    root.authContext!.principalUserId = owner;
    await expect(service.list(root)).rejects.toMatchObject({ statusCode: 403 });
    const global = await group();
    await prisma.group.update({ where: { id: global.id }, data: { accountOwnerId: owner } });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects changed configuration snapshots before loading settings", async () => {
    await group();
    const row = await create("kv"),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (principal, targets) => {
      await prisma.developerProductConfig.update({
        where: { id: row.id },
        data: { settings: { fixture: "changed" }, updateTime: new Date(Date.now() + 1000) },
      });
      return original(principal, targets);
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds configurations after management eligibility is revoked", async () => {
    const global = await group();
    await create("kv");
    const original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (principal, targets) => {
      const rows = await original(principal, targets);
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return rows;
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("applies new Deny before returning loaded configuration", async () => {
    await group();
    const row = await create("kv"),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (principal, targets) => {
      const rows = await original(principal, targets);
      await bind({
        Version: "1",
        Statement: {
          Effect: "Deny",
          Action: "quyan:developer:ListProductConfigurations",
          Resource: platformDeveloperConfigArn(row.id),
        },
      });
      return rows;
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("never provisions other product records from an enforce-mode read", async () => {
    await group();
    expect(await service.list(request())).toEqual([]);
    expect(await prisma.developerProductConfig.count()).toBe(0);
    await create("kv");
    expect((await service.list(request())).map((row) => row.productCode)).toEqual(["kv"]);
    expect(await prisma.developerProductConfig.count()).toBe(1);
  });
  it("uses only explicit role record grants and rejects revoked sessions", async () => {
    await group();
    const row = await create("kv");
    await create("push");
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "product-config-read-" + randomUUID() },
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
    expect(await service.list(req)).toEqual([]);
    await bind(
      {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:developer:ListProductConfigurations",
          Resource: platformDeveloperConfigArn(row.id),
        },
      },
      "role",
      role.id,
    );
    expect((await service.list(req)).map((row) => row.productCode)).toEqual(["kv"]);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.list(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("calls the original display path once in %s", async (mode) => {
    await group();
    const row = await create("kv");
    env.security.iamAuthorizationMode = mode;
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:developer:ListProductConfigurations",
        Resource: platformDeveloperConfigArn(row.id),
      },
    });
    const display = vi.spyOn(DeveloperProductPlatformService.getInstance(), "listConfigs");
    expect(await service.list(request())).toHaveLength(DEVELOPER_PRODUCT_CODES.length);
    expect(display).toHaveBeenCalledOnce();
  });
  it("projects legacy permission removals as Deny and rejects corrupt DTO values", async () => {
    await group();
    const row = await create("kv");
    await prisma.user.update({
      where: { id: actor },
      data: { permissionRemoves: [Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE] },
    });
    expect(await service.list(request())).toEqual([]);
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [] } });
    await prisma.developerProductConfig.update({ where: { id: row.id }, data: { defaultDailyQuota: -1 } });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
