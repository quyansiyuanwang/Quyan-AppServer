import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { DeveloperQuotaAdminService } from "@/services/developer/developer-quota-admin.service";
import { PlatformDeveloperQuotaReadRepository } from "@/store/developer/platform-developer-quota-read.repository";
import { DeveloperProjectRepository } from "@/store/developer/developer-project.repository";
import { platformDeveloperQuotaArn } from "@/iam/resources/platform-developer-quota-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode,
  service = DeveloperQuotaAdminService.getInstance(),
  repo = PlatformDeveloperQuotaReadRepository.getInstance();
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
const create = async () =>
  prisma.developerQuotaOverride.create({
    data: {
      subjectType: "user",
      subjectId: await user(owner),
      service: "ip",
      dailyFreeQuota: 100,
      createdByUserId: owner,
    },
  });
async function group() {
  const row = await prisma.group.create({
    data: {
      username: "developer-quota-read-" + randomUUID(),
      name: "fixture global",
      level: 0,
      accountOwnerId: null,
      permissions: [Permission.DEVELOPER_QUOTA_MANAGE],
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
  await prisma.developerQuotaOverride.deleteMany();
  owner = await user();
  actor = await user(owner);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
describe("platform developer quota list database", () => {
  it("returns only authorized actual quota records and preserves wire types", async () => {
    await group();
    const row = await create(),
      denied = await create();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:developer:ListQuotaOverrides",
        Resource: platformDeveloperQuotaArn(denied.id),
      },
    });
    const hydrate = vi.spyOn(repo, "hydrate");
    expect(await service.list(request())).toEqual([
      expect.objectContaining({
        id: row.id,
        subjectType: "user",
        subjectId: row.subjectId,
        service: "ip",
        dailyFreeQuota: 100,
        updateTime: row.updateTime.toISOString(),
      }),
    ]);
    expect(hydrate.mock.calls.flatMap((call) => call[1].map((target) => target.id))).not.toContain(denied.id);
  });
  it("does not manufacture platform eligibility through account ownership or wildcard Allow", async () => {
    await create();
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
  it("refuses changed quotas between metadata and hydration", async () => {
    await group();
    const row = await create(),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (principal, targets) => {
      await prisma.developerQuotaOverride.update({
        where: { id: row.id },
        data: { dailyFreeQuota: 200, updateTime: new Date(Date.now() + 1000) },
      });
      return original(principal, targets);
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not return quotas after global eligibility is revoked", async () => {
    const global = await group();
    await create();
    const original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (principal, targets) => {
      const rows = await original(principal, targets);
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return rows;
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("applies a newly attached Deny before returning hydrated quotas", async () => {
    await group();
    const row = await create(),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (principal, targets) => {
      const rows = await original(principal, targets);
      await bind({
        Version: "1",
        Statement: {
          Effect: "Deny",
          Action: "quyan:developer:ListQuotaOverrides",
          Resource: platformDeveloperQuotaArn(row.id),
        },
      });
      return rows;
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("limits AssumeRole to role-specific records and refuses a revoked session", async () => {
    await group();
    const row = await create();
    await create();
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "developer-quota-read-" + randomUUID() },
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
          Action: "quyan:developer:ListQuotaOverrides",
          Resource: platformDeveloperQuotaArn(row.id),
        },
      },
      "role",
      role.id,
    );
    expect((await service.list(req)).map((row) => row.id)).toEqual([row.id]);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.list(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("keeps the original display read once in %s", async (mode) => {
    await group();
    const row = await create();
    env.security.iamAuthorizationMode = mode;
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:developer:ListQuotaOverrides",
        Resource: platformDeveloperQuotaArn(row.id),
      },
    });
    const display = vi.spyOn(DeveloperProjectRepository.getInstance(), "listQuotaOverrides");
    expect((await service.list(request())).map((row) => row.id)).toEqual([row.id]);
    expect(display).toHaveBeenCalledOnce();
  });
  it("retains expired overrides for administration while hiding deleted records", async () => {
    await group();
    const expired = await create(),
      deleted = await create();
    await prisma.developerQuotaOverride.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(0), service: "*" },
    });
    await prisma.developerQuotaOverride.update({ where: { id: deleted.id }, data: { status: -1 } });
    expect(await service.list(request())).toEqual([
      expect.objectContaining({ id: expired.id, service: undefined, expiresAt: new Date(0).toISOString() }),
    ]);
  });
  it("projects legacy permission removals into Deny for the native list", async () => {
    await group();
    await create();
    await prisma.user.update({
      where: { id: actor },
      data: { permissionRemoves: [Permission.DEVELOPER_QUOTA_MANAGE] },
    });
    expect(await service.list(request())).toEqual([]);
  });
  it("rejects invalid persisted quota values instead of publishing corrupt DTOs", async () => {
    await group();
    const row = await create();
    await prisma.developerQuotaOverride.update({ where: { id: row.id }, data: { dailyFreeQuota: -1 } });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
