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
import { PlatformBusinessLogStatsIamService } from "@/services/system/platform-business-log-stats-iam.service";
import { platformBusinessLogArn } from "@/iam/resources/platform-business-log-resources";
import type { TypedRequest } from "@/types/express";
const service = PlatformBusinessLogStatsIamService.getInstance(),
  repository = PlatformBusinessLogReadRepository.getInstance(),
  mode = env.security.iamAuthorizationMode,
  action = "quyan:system:business_log:GetLogStatistics";
let owner: string, actor: string, groupId: string, roleId: string, sessionId: string, prefix: string, ids: string[];
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "business-stats-" + randomUUID(),
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
    name: "business-stats-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { document: parsed.document, documentHash: parsed.documentHash, createdBy: owner },
  });
  await RamPolicyRepository.getInstance().attachPolicy(owner, policy.id, "role", roleId);
  return policy;
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  prefix = "/fixture/business-stats/" + randomUUID();
  owner = await user();
  groupId = (
    await prisma.group.create({
      data: { username: "business-stats-global-" + randomUUID(), permissions: [Permission.SYSTEM_BUSINESS_LOG_READ] },
    })
  ).id;
  actor = await user(owner, groupId);
  roleId = (
    await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "business-stats-role-" + randomUUID() } })
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
describe("business log statistics authorize each contribution before aggregation", () => {
  it("omits Deny from every summary and distribution and reads only statistical fields", async () => {
    await grant();
    await grant(platformBusinessLogArn(ids[1]!), "Deny");
    const hydrate = vi.spyOn(repository, "hydrateStats");
    const result = await service.statistics({ actorUserId: actor }, request());
    expect(result.summary).toEqual({
      totalLogs: 2,
      successLogs: 2,
      failedLogs: 0,
      uniqueActors: 1,
      systemTriggeredLogs: 0,
      uniqueTargets: 1,
      uniqueIPs: 1,
    });
    expect(result.bySuccess).toEqual([{ key: "success", label: "success", count: 2, share: 100 }]);
    expect(result.byOperationType).toEqual([
      { key: OperationType.USER_UPDATE, label: OperationType.USER_UPDATE, count: 2, share: 100 },
    ]);
    expect(result.daily.reduce((sum, row) => sum + row.totalLogs, 0)).toBe(2);
    expect(hydrate.mock.calls[0]![0].map((row) => row.id)).toEqual([ids[0], ids[2]]);
    const fields = await repository.hydrateStats(hydrate.mock.calls[0]![0]);
    expect(Object.keys(fields[0]!).sort()).toEqual(
      [
        "id",
        "status",
        "createTime",
        "updateTime",
        "operationType",
        "operationCategory",
        "success",
        "actorUserId",
        "targetUserId",
        "ipAddress",
      ].sort(),
    );
  });
  it("returns an empty aggregate without reading protected fields when no grant matches", async () => {
    const hydrate = vi.spyOn(repository, "hydrateStats");
    expect((await service.statistics({ actorUserId: actor }, request())).summary.totalLogs).toBe(0);
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("does not let ListLogs authorize statistics", async () => {
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:system:business_log:ListLogs", Resource: "*" },
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "list-only-" + randomUUID(),
      permissions: [],
      iamVersion: { document: parsed.document, documentHash: parsed.documentHash, createdBy: owner },
    });
    await RamPolicyRepository.getInstance().attachPolicy(owner, policy.id, "role", roleId);
    expect((await service.statistics({ actorUserId: actor }, request())).summary.totalLogs).toBe(0);
  });
  it("retains actor and target intersection, false success, IP normalization and historical dates", async () => {
    await grant("*");
    const identity = await prisma.user.findUniqueOrThrow({ where: { id: actor }, select: { username: true } });
    expect(
      (
        await service.statistics(
          { actorUserId: actor, actor: identity.username, target: owner, success: false, ip: "::ffff:127.0.0.1" },
          request(),
        )
      ).summary.totalLogs,
    ).toBe(1);
    expect(
      (await service.statistics({ actorUserId: actor, actor: "absent-" + randomUUID() }, request())).summary.totalLogs,
    ).toBe(0);
    const historical = await log(4, { createTime: new Date("2025-01-01T12:00:00Z") });
    const result = await service.statistics({ actorUserId: actor }, request());
    expect(result.summary.totalLogs).toBe(4);
    expect(result.daily[0]!.date).toBe("2025-01-01");
    await grant(platformBusinessLogArn(historical), "Deny");
    expect((await service.statistics({ actorUserId: actor }, request())).summary.totalLogs).toBe(3);
  });
  it("reads authorized contributions in bounded batches", async () => {
    const now = Date.now();
    await prisma.businessLog.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        operationType: OperationType.USER_UPDATE,
        operationCategory: OperationCategory.USER_MANAGEMENT,
        actorUserId: actor,
        description: prefix,
        success: false,
        ipAddress: "192.0.2.3",
        createTime: new Date(now - 10000 - index),
      })),
    });
    await grant("*");
    const hydrate = vi.spyOn(repository, "hydrateStats"),
      scan = vi.spyOn(repository, "scan");
    expect((await service.statistics({ actorUserId: actor }, request())).summary.totalLogs).toBe(504);
    expect(hydrate.mock.calls.map(([rows]) => rows.length)).toEqual([500, 4]);
    expect(scan).toHaveBeenCalledTimes(4);
  });
  it.each(["policy", "attachment", "qualification", "record", "session"] as const)(
    "refuses %s revocation after reading contributions",
    async (kind) => {
      const policy = await grant(),
        original = repository.hydrateStats.bind(repository);
      vi.spyOn(repository, "hydrateStats").mockImplementation(async (targets) => {
        const result = await original(targets);
        if (kind === "policy") await prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } });
        if (kind === "attachment") await RamPolicyRepository.getInstance().detachPolicy(policy.id, "role", roleId);
        if (kind === "qualification") await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        if (kind === "record") await prisma.businessLog.update({ where: { id: ids[2] }, data: { success: false } });
        if (kind === "session") await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { status: 0 } });
        return result;
      });
      await expect(service.statistics({ actorUserId: actor }, request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("detects a backdated insertion while fixing the upper snapshot boundary", async () => {
    await grant("*");
    const original = repository.hydrateStats.bind(repository);
    const spy = vi.spyOn(repository, "hydrateStats").mockImplementation(async (targets) => {
      const result = await original(targets);
      await log(4);
      return result;
    });
    await expect(service.statistics({ actorUserId: actor }, request())).rejects.toMatchObject({ statusCode: 403 });
    spy.mockRestore();
    vi.spyOn(repository, "hydrateStats").mockImplementation(async (targets) => {
      const result = await original(targets);
      await log(0);
      return result;
    });
    expect((await service.statistics({ actorUserId: actor }, request())).summary.totalLogs).toBe(4);
  });
  it("rejects private group and user additions as substitutes for platform qualification", async () => {
    await grant("*");
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.SYSTEM_BUSINESS_LOG_READ] } });
    await expect(service.statistics({ actorUserId: actor }, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("enforces AccessKey and rejects OAuth", async () => {
    const req = request(false);
    req.authContext!.subjectType = "access_key";
    expect((await service.statistics({ actorUserId: actor }, req)).summary.totalLogs).toBe(3);
    req.oauthAccessToken = {} as never;
    await expect(service.statistics({ actorUserId: actor }, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("keeps one legacy aggregation in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const read = vi.spyOn(BusinessLogService.getInstance(), "getStats"),
      hydrate = vi.spyOn(repository, "hydrateStats");
    expect((await service.statistics({ actorUserId: actor }, request(false))).summary.totalLogs).toBe(3);
    expect(read).toHaveBeenCalledTimes(1);
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("forwards Controller filters and ignores forged Action headers", async () => {
    await grant(platformBusinessLogArn(ids[1]!));
    const req = request();
    req.headers["x-action"] = "quyan:system:business_log:ListLogs";
    const result = await new BusinessLogController().getBusinessLogStats(
      req,
      undefined,
      undefined,
      actor,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      "127.0.0.1",
    );
    expect(result.summary.totalLogs).toBe(1);
    expect(result.summary.failedLogs).toBe(1);
  });
});
