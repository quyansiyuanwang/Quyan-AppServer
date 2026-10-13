import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { PlatformApiLogReadIamService } from "@/services/system/platform-api-log-read-iam.service";
import { SystemService } from "@/services/system/system.service";
import { SystemController } from "@/api/controllers/v1/system/system.controller";
import { platformApiLogArn } from "@/iam/resources/platform-api-log-resources";
import type { TypedRequest } from "@/types/express";
const service = PlatformApiLogReadIamService.getInstance(),
  mode = env.security.iamAuthorizationMode,
  action = "quyan:system:log:GetLogDetail";
let owner: string, actor: string, groupId: string, roleId: string, sessionId: string, logId: string, otherId: string;
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "api-log-" + randomUUID(),
        password: "fixture-only",
        userType: accountOwnerId ? "ram_user" : "root",
        accountOwnerId,
        parentUserId: accountOwnerId,
        groupId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const log = () =>
  prisma.aPILog.create({
    data: {
      requestID: randomUUID(),
      userID: actor,
      path: "/fixture/api-log",
      method: "GET",
      statusCode: 200,
      ipAddress: "192.0.2.1",
      requestHeaders: { fixture: "protected-log-content" },
      response: { fixture: "protected-response" },
    },
  });
const request = (role = true) =>
  ({
    user: { userId: actor },
    authContext: {
      principalUserId: actor,
      accountOwnerId: owner,
      subjectType: role ? "assumed_role" : "sub_user",
      ...(role ? { assumedRoleId: roleId, roleSessionId: sessionId } : {}),
    },
    headers: { "x-action": "quyan:ram:CreateUser" },
    ip: "192.0.2.1",
    secure: true,
    params: { logId },
  }) as unknown as TypedRequest;
const hydrate = () => SystemService.getInstance().getLogDetail(logId);
async function grant(resource: string | string[], effect: "Allow" | "Deny" = "Allow", ownerId = owner) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: effect, Action: action, Resource: resource } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: ownerId,
    name: "api-log-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { document: parsed.document, documentHash: parsed.documentHash, createdBy: ownerId },
  });
  await RamPolicyRepository.getInstance().attachPolicy(ownerId, policy.id, "role", roleId);
  return policy;
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  groupId = (
    await prisma.group.create({
      data: { username: "api-log-global-" + randomUUID(), permissions: [Permission.API_LOG_READ] },
    })
  ).id;
  actor = await user(owner, groupId);
  roleId = (await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "api-log-role-" + randomUUID() } })).id;
  sessionId = (
    await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
        tokenJtiHash: randomUUID(),
      },
    })
  ).id;
  logId = (await log()).id;
  otherId = (await log()).id;
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("API log detail with resource scopes and either global read qualification", () => {
  it.each([Permission.API_LOG_READ, Permission.SYSTEM_LOG_READ])(
    "accepts the %s global qualification independently",
    async (permission) => {
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [permission] } });
      await grant(platformApiLogArn(logId));
      const detail = await service.read(logId, request(), hydrate);
      expect(detail.id).toBe(logId);
      expect(detail.requestHeaders).toEqual({ fixture: "protected-log-content" });
      const denied = vi.fn().mockImplementation(hydrate);
      await expect(service.read(otherId, request(), denied)).rejects.toMatchObject({ statusCode: 403 });
      expect(denied).not.toHaveBeenCalled();
    },
  );
  it("a matching Deny overrides Allow and cannot be bypassed via the other legacy alias", async () => {
    await prisma.group.update({
      where: { id: groupId },
      data: { permissions: [Permission.API_LOG_READ, Permission.SYSTEM_LOG_READ] },
    });
    await grant("*");
    await grant(platformApiLogArn(logId), "Deny");
    const read = vi.fn().mockImplementation(hydrate);
    await expect(service.read(logId, request(), read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("legacy permission removals produce native Deny even with the other alias's group Allow", async () => {
    await prisma.group.update({
      where: { id: groupId },
      data: { permissions: [Permission.API_LOG_READ, Permission.SYSTEM_LOG_READ] },
    });
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.API_LOG_READ] } });
    const result = await IamAuthorizationService.getInstance().authorize({
      principal: { subjectUserId: actor, principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
      action,
      resource: platformApiLogArn(logId),
    });
    expect(result.decision).toBe("ExplicitDeny");
  });
  it("policy wildcard and permission additions do not manufacture operational group eligibility", async () => {
    await grant("*");
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.API_LOG_READ, Permission.SYSTEM_LOG_READ] },
    });
    const read = vi.fn().mockImplementation(hydrate);
    await expect(service.read(logId, request(), read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it.each(["private-group", "group-disabled", "actor-disabled", "owner-disabled", "revoked-session"])(
    "denies %s subjects before reading sensitive log details",
    async (change) => {
      await grant("*");
      if (change === "private-group")
        await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      if (change === "group-disabled") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      if (change === "actor-disabled") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
      if (change === "owner-disabled") await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
      if (change === "revoked-session")
        await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
      const read = vi.fn().mockImplementation(hydrate);
      await expect(service.read(logId, request(), read)).rejects.toMatchObject({ statusCode: 403 });
      expect(read).not.toHaveBeenCalled();
    },
  );
  it.each(["policy", "binding", "qualification", "target", "session"])(
    "discards hydrated details after %s revocation",
    async (change) => {
      const policy = await grant(platformApiLogArn(logId));
      await expect(
        service.read(logId, request(), async () => {
          const detail = await hydrate();
          if (change === "policy") await prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } });
          if (change === "binding") await RamPolicyRepository.getInstance().detachPolicy(policy.id, "role", roleId);
          if (change === "qualification")
            await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
          if (change === "target") await prisma.aPILog.update({ where: { id: logId }, data: { status: 0 } });
          if (change === "session")
            await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
          return detail;
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("ignores foreign-account policies and validates AccessKey subjects with the same native Action", async () => {
    await grant(platformApiLogArn(logId), "Allow", await user());
    const read = vi.fn().mockImplementation(hydrate);
    await expect(service.read(logId, request(), read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
    const req = request(false);
    req.authContext!.subjectType = "access_key";
    expect((await service.read(logId, req, hydrate)).id).toBe(logId);
  });
  it.each(["legacy", "shadow"] as const)("preserves the old ANY check and reads once in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const read = vi.fn().mockImplementation(hydrate);
    expect((await service.read(logId, request(false), read)).id).toBe(logId);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("controller forwards the fixed log ID through the native service and refuses OAuth contexts", async () => {
    await grant(platformApiLogArn(logId));
    expect((await new SystemController().getSystemLogDetail(request(), logId)).id).toBe(logId);
    const req = request();
    req.oauthAccessToken = {} as never;
    await expect(new SystemController().getSystemLogDetail(req, logId)).rejects.toMatchObject({ statusCode: 403 });
  });
});
