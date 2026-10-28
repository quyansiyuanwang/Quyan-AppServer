import BusinessLogService from "@/services/system/businesslog.service";
import { BusinessLogController } from "@/api/controllers/v1/system/businesslog.controller";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PlatformBusinessLogReadRepository } from "@/store/system/platform-business-log-read.repository";
import { PlatformBusinessLogListIamService } from "@/services/system/platform-business-log-list-iam.service";
import { platformBusinessLogArn } from "@/iam/resources/platform-business-log-resources";
import type { TypedRequest } from "@/types/express";
const service = PlatformBusinessLogListIamService.getInstance(),
  repository = PlatformBusinessLogReadRepository.getInstance(),
  mode = env.security.iamAuthorizationMode,
  action = "quyan:system:business_log:ListLogs";
let owner: string, actor: string, groupId: string, roleId: string, sessionId: string, prefix: string, ids: string[];
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "business-list-" + randomUUID(),
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
const request = (role = true) =>
  ({
    user: { userId: actor },
    authContext: {
      principalUserId: actor,
      accountOwnerId: owner,
      subjectType: role ? "assumed_role" : "sub_user",
      ...(role ? { assumedRoleId: roleId, roleSessionId: sessionId } : {}),
    },
    headers: { "x-action": "quyan:system:log:GetLogDetail" },
    secure: true,
    ip: "192.0.2.1",
    params: {},
  }) as unknown as TypedRequest;
const log = async (index: number, extra: Record<string, unknown> = {}) =>
  (
    await prisma.businessLog.create({
      data: {
        operationType: OperationType.USER_UPDATE,
        operationCategory: OperationCategory.USER_MANAGEMENT,
        actorUserId: actor,
        targetUserId: owner,
        description: prefix,
        success: index !== 2,
        ipAddress: "127.0.0.1",
        changes: { password: "fixture-password-secret" },
        metadata: { accessToken: "fixture-token-secret" },
        createTime: new Date(Date.now() - index * 1000),
        ...extra,
      },
    })
  ).id;

async function grant(
  resource: string | string[] = ids.map(platformBusinessLogArn),
  effect: "Allow" | "Deny" = "Allow",
) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: effect, Action: action, Resource: resource } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "business-list-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { document: parsed.document, documentHash: parsed.documentHash, createdBy: owner },
  });
  await RamPolicyRepository.getInstance().attachPolicy(owner, policy.id, "role", roleId);
  return policy;
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  prefix = "/fixture/business-list/" + randomUUID();
  owner = await user();
  groupId = (
    await prisma.group.create({
      data: { username: "business-list-global-" + randomUUID(), permissions: [Permission.SYSTEM_BUSINESS_LOG_READ] },
    })
  ).id;
  actor = await user(owner, groupId);
  roleId = (
    await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "business-list-role-" + randomUUID() } })
  ).id;
  sessionId = (
    await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 120000),
        tokenJtiHash: randomUUID(),
      },
    })
  ).id;
  ids = [await log(1), await log(2), await log(3)];
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("business log lists authorize metadata before totals, pagination and payload reads", () => {
  it("filters Deny before pagination and reads only the allowed page", async () => {
    await grant();
    await grant(platformBusinessLogArn(ids[1]!), "Deny");
    const read = vi.spyOn(repository, "hydrate");
    const result = await service.list(2, 1, { actorUserId: actor }, request());
    expect(result.total).toBe(2);
    expect(result.logs.map((row) => row.id)).toEqual([ids[2]]);
    expect(read.mock.calls.flatMap(([rows]) => rows.map((row) => row.id))).toEqual([ids[2]]);
    expect(result.logs[0]!.actorUsername).toBe(
      (await prisma.user.findUniqueOrThrow({ where: { id: actor } })).username,
    );
  });
  it("does not hydrate payloads without Allow or inherit the global group's Allow into a role", async () => {
    const hydrate = vi.spyOn(repository, "hydrate");
    expect(await service.list(1, 10, { actorUserId: actor }, request())).toEqual({ logs: [], total: 0 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("preserves actor/target intersection, IP normalization, enums, false success and dates", async () => {
    await grant();
    const username = (await prisma.user.findUniqueOrThrow({ where: { id: actor } })).username;
    const result = await service.list(
      1,
      10,
      {
        actorUserId: actor,
        actor: username,
        targetUserId: owner,
        operationType: OperationType.USER_UPDATE,
        success: false,
        ip: "::ffff:127.0.0.1",
        startDate: new Date(Date.now() - 60000),
      },
      request(),
    );
    expect(result.total).toBe(1);
    expect(result.logs.map((row) => row.id)).toEqual([ids[1]]);
    expect((await service.list(1, 10, { actorUserId: owner, actor: username }, request())).total).toBe(0);
  });
  it("keeps old logs visible when no date filter is supplied", async () => {
    await prisma.businessLog.update({ where: { id: ids[0] }, data: { createTime: new Date("2025-01-01") } });
    await grant();
    expect((await service.list(1, 10, { actorUserId: actor }, request())).total).toBe(3);
  });
  it("requires real global eligibility even with private group and user additions", async () => {
    await grant();
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.SYSTEM_BUSINESS_LOG_READ] } });
    await expect(service.list(1, 10, { actorUserId: actor }, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("scans beyond a denied first batch without loading denied payloads", async () => {
    const now = Date.now();
    await prisma.businessLog.createMany({
      data: Array.from({ length: 501 }, (_, i) => ({
        operationType: OperationType.USER_UPDATE,
        operationCategory: OperationCategory.USER_MANAGEMENT,
        actorUserId: actor,
        description: prefix,
        success: true,
        ipAddress: "192.0.2.1",
        createTime: new Date(now - 10000 - i),
      })),
    });
    await grant(platformBusinessLogArn(ids[2]!));
    const scan = vi.spyOn(repository, "scan"),
      hydrate = vi.spyOn(repository, "hydrate");
    expect((await service.list(1, 1, { actorUserId: actor }, request())).total).toBe(1);
    expect(scan).toHaveBeenCalledTimes(4);
    expect(hydrate.mock.calls[0]![0].map((row) => row.id)).toEqual([ids[2]]);
  });
  it.each(["binding", "qualification", "off-page-log", "session"] as const)(
    "rejects %s drift during payload hydration",
    async (change) => {
      const policy = await grant(),
        original = repository.hydrate.bind(repository);
      vi.spyOn(repository, "hydrate").mockImplementation(async (targets) => {
        const result = await original(targets);
        if (change === "binding") await RamPolicyRepository.getInstance().detachPolicy(policy.id, "role", roleId);
        if (change === "qualification")
          await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        if (change === "off-page-log") await prisma.businessLog.update({ where: { id: ids[2] }, data: { status: 0 } });
        if (change === "session")
          await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
        return result;
      });
      await expect(service.list(1, 1, { actorUserId: actor }, request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("detects backdated additions to the selected snapshot", async () => {
    await grant("*");
    const original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (targets) => {
      const result = await original(targets);
      await log(4);
      return result;
    });
    await expect(service.list(1, 1, { actorUserId: actor }, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("enforces AccessKey and rejects OAuth", async () => {
    const req = request(false);
    req.authContext!.subjectType = "access_key";
    expect((await service.list(1, 10, { actorUserId: actor }, req)).total).toBe(3);
    req.oauthAccessToken = {} as never;
    await expect(service.list(1, 10, { actorUserId: actor }, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("retains one old query in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const read = vi.spyOn(BusinessLogService.getInstance(), "getLogs");
    expect((await service.list(1, 10, { actorUserId: actor }, request(false))).total).toBe(3);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("preserves Controller response, forwarding, usernames and masking of allowed payloads", async () => {
    await grant(platformBusinessLogArn(ids[1]!));
    const req = request();
    req.headers["x-action"] = "quyan:system:business_log:GetFilterOptions";
    const result = await new BusinessLogController().getBusinessLogs(
      req,
      1,
      1,
      OperationType.USER_UPDATE,
      undefined,
      actor,
    );
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(result.logs.map((row) => row.id)).toEqual([ids[1]]);
    expect(JSON.stringify(result)).not.toContain("fixture-password-secret");
    expect(JSON.stringify(result)).not.toContain("fixture-token-secret");
  });
});
