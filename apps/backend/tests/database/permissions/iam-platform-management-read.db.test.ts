import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { PlatformManagementReadIamService } from "@/services/system/platform-management-read-iam.service";
import { platformSystemArn } from "@/iam/resources/platform-system-resources";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string;
const service = PlatformManagementReadIamService.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "platform-read-" + randomUUID(),
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
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
  vi.restoreAllMocks();
});
async function group(permissions: Permission[] = [Permission.SYSTEM_STATS_READ]) {
  const row = await prisma.group.create({
    data: { username: "platform-read-" + randomUUID(), name: "fixture", level: 0, permissions, accountOwnerId: null },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function bind(document: unknown, principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy(document);
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "platform-read-" + randomUUID(),
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
const action = "quyan:system:GetStatistics",
  resource = platformSystemArn("stats");
describe("platform management read authorization database", () => {
  it.each([
    ["GetBuildInfo", "build-info", Permission.DEBUG_ACCESS],
    ["GetStatistics", "stats", Permission.SYSTEM_STATS_READ],
    ["GetConsumptionStatistics", "consumption-stats", Permission.SYSTEM_CONSUMPTION_STATS_READ],
  ] as const)("grants %s only through the matching deployment group ceiling", async (operation, id, permission) => {
    await group([permission]);
    expect(
      await service.read("quyan:system:" + operation, platformSystemArn(id), request(), async () => "fixture"),
    ).toBe("fixture");
  });
  it("rejects account owners, account groups and arbitrary Allow policies without deployment eligibility", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    const read = vi.fn();
    await expect(service.read(action, resource, request(), read)).rejects.toMatchObject({ statusCode: 403 });
    const ownerRequest = request();
    ownerRequest.user!.userId = owner;
    ownerRequest.authContext!.principalUserId = owner;
    await expect(service.read(action, resource, ownerRequest, read)).rejects.toMatchObject({ statusCode: 403 });
    const row = await group();
    await prisma.group.update({ where: { id: row.id }, data: { accountOwnerId: owner } });
    await expect(service.read(action, resource, request(), read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("preserves Explicit Deny from policies and permission removals", async () => {
    await group();
    const read = vi.fn();
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.SYSTEM_STATS_READ] } });
    await expect(service.read(action, resource, request(), read)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [] } });
    await bind({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: resource } });
    await expect(service.read(action, resource, request(), read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("discards data if the global grant or owner identity becomes invalid during a read", async () => {
    const row = await group();
    await expect(
      service.read(action, resource, request(), async () => {
        await prisma.group.update({ where: { id: row.id }, data: { permissions: [] } });
        return { privateFixture: true };
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({ where: { id: row.id }, data: { permissions: [Permission.SYSTEM_STATS_READ] } });
    await expect(
      service.read(action, resource, request(), async () => {
        await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
        return { privateFixture: true };
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("reevaluates a newly attached Deny before returning a report", async () => {
    await group();
    await expect(
      service.read(action, resource, request(), async () => {
        await bind({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: resource } });
        return { privateFixture: true };
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires an active role grant and rejects role revocation during a read", async () => {
    await group();
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "platform-read-" + randomUUID() },
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
    const read = vi.fn().mockResolvedValue("fixture");
    await expect(service.read(action, resource, req, read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: action, Resource: resource } }, "role", role.id);
    expect(await service.read(action, resource, req, read)).toBe("fixture");
    await expect(
      service.read(action, resource, req, async () => {
        await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        return "fixture";
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
