import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PlatformApiLogReadRepository } from "@/store/system/platform-api-log-read.repository";
import { PlatformApiLogStatsIamService } from "@/services/system/platform-api-log-stats-iam.service";
import { SystemService } from "@/services/system/system.service";
import { SystemController } from "@/api/controllers/v1/system/system.controller";
import { platformApiLogArn } from "@/iam/resources/platform-api-log-resources";
import type { TypedRequest } from "@/types/express";
const service = PlatformApiLogStatsIamService.getInstance(),
  repository = PlatformApiLogReadRepository.getInstance(),
  mode = env.security.iamAuthorizationMode,
  action = "quyan:system:log:GetLogStatistics";
let owner: string, actor: string, groupId: string, roleId: string, sessionId: string, prefix: string, ids: string[];
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "api-statistics-" + randomUUID(),
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
    await prisma.aPILog.create({
      data: {
        requestID: randomUUID(),
        userID: actor,
        path: prefix,
        method: "GET",
        statusCode: 200,
        ipAddress: "192.0.2.1",
        bodyParams: "fixture 中文针",
        requestHeaders: { "content-length": "17" },
        createTime: new Date(Date.now() - index * 1000),
        ...extra,
      },
    })
  ).id;
async function grant(resource: string | string[] = ids.map(platformApiLogArn), effect: "Allow" | "Deny" = "Allow") {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: effect, Action: action, Resource: resource } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "api-statistics-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { document: parsed.document, documentHash: parsed.documentHash, createdBy: owner },
  });
  await RamPolicyRepository.getInstance().attachPolicy(owner, policy.id, "role", roleId);
  return policy;
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  prefix = "/fixture/api-statistics/" + randomUUID();
  owner = await user();
  groupId = (
    await prisma.group.create({
      data: { username: "api-statistics-global-" + randomUUID(), permissions: [Permission.API_LOG_READ] },
    })
  ).id;
  actor = await user(owner, groupId);
  roleId = (
    await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "api-statistics-role-" + randomUUID() } })
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
describe("API log resource statistics with real policies and global eligibility", () => {
  it("omits Deny contributions from summary and every distribution", async () => {
    await prisma.aPILog.update({
      where: { id: ids[1] },
      data: { method: "DELETE", statusCode: 503, userID: null, ipAddress: "192.0.2.9", path: prefix + "/private" },
    });
    await grant();
    await grant(platformApiLogArn(ids[1]!), "Deny");
    const hydrate = vi.spyOn(repository, "hydrateStats");
    const result = await service.statistics({ path: prefix }, request());
    expect(result.summary).toEqual({
      totalRequests: 2,
      successRequests: 2,
      redirectRequests: 0,
      clientErrorRequests: 0,
      serverErrorRequests: 0,
      uniqueUsers: 1,
      anonymousRequests: 0,
      uniqueIPs: 1,
    });
    expect(result.byMethod).toEqual([{ key: "GET", label: "GET", count: 2, share: 100 }]);
    expect(result.byStatusCode).toEqual([{ key: "200", label: "200", count: 2, share: 100 }]);
    expect(result.byPath.some((row) => row.key.includes("private"))).toBe(false);
    expect(hydrate.mock.calls.flatMap(([rows]) => rows.map((row) => row.id))).toEqual([ids[0], ids[2]]);
    expect(JSON.stringify(result)).not.toContain("bodyParams");
  });
  it("keeps legacy aggregate mathematics when every matching resource is allowed", async () => {
    await prisma.aPILog.update({
      where: { id: ids[1] },
      data: { statusCode: 302, method: "POST", userID: null, ipAddress: "192.0.2.2", path: prefix + "/123" },
    });
    await prisma.aPILog.update({
      where: { id: ids[2] },
      data: { statusCode: 404, method: "PATCH", path: prefix + "/456" },
    });
    await grant();
    const { generatedAt: _legacy, ...expected } = await SystemService.getInstance().getLogStats({ path: prefix });
    const { generatedAt: _native, ...actual } = await service.statistics({ path: prefix }, request());
    expect(actual).toEqual(expected);
    expect(actual.summary).toMatchObject({
      totalRequests: 3,
      redirectRequests: 1,
      clientErrorRequests: 1,
      uniqueUsers: 1,
      anonymousRequests: 1,
      uniqueIPs: 2,
    });
  });
  it("requires the independent statistics Action", async () => {
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: ["quyan:system:log:ListLogs", "quyan:system:log:GetLogDetail"],
        Resource: "*",
      },
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "list-only-" + randomUUID(),
      permissions: [],
      iamVersion: { document: parsed.document, documentHash: parsed.documentHash, createdBy: owner },
    });
    await RamPolicyRepository.getInstance().attachPolicy(owner, policy.id, "role", roleId);
    expect((await service.statistics({ path: prefix }, request())).summary.totalRequests).toBe(0);
  });
  it.each([Permission.API_LOG_READ, Permission.SYSTEM_LOG_READ])(
    "accepts either real global qualification independently: %s",
    async (permission) => {
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [permission] } });
      await grant();
      expect((await service.statistics({ path: prefix }, request())).summary.totalRequests).toBe(3);
    },
  );
  it("rejects a private group or user addition that attempts to manufacture platform eligibility", async () => {
    await grant();
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.API_LOG_READ] } });
    await expect(service.statistics({ path: prefix }, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not inherit the subject group's Allow into an assumed role", async () => {
    const hydrate = vi.spyOn(repository, "hydrateStats");
    expect((await service.statistics({ path: prefix }, request())).summary.totalRequests).toBe(0);
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("reuses username, date, method, status and JSON search predicates", async () => {
    await grant();
    const identity = await prisma.user.findUniqueOrThrow({ where: { id: actor }, select: { username: true } });
    const result = await service.statistics(
      { path: prefix, user: identity.username, method: ["GET"], statusCode: [200], search: "中文针" },
      request(),
    );
    expect(result.summary.totalRequests).toBe(3);
    expect(
      (await service.statistics({ path: prefix, user: "unknown-" + randomUUID() }, request())).summary.totalRequests,
    ).toBe(0);
  });
  it("reads statistics fields in bounded batches", async () => {
    const now = Date.now();
    await prisma.aPILog.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        requestID: randomUUID(),
        path: prefix,
        method: "POST",
        statusCode: 500,
        ipAddress: "192.0.2.3",
        createTime: new Date(now - 10000 - index),
      })),
    });
    await grant("*");
    const hydrate = vi.spyOn(repository, "hydrateStats"),
      scan = vi.spyOn(repository, "scan");
    expect((await service.statistics({ path: prefix }, request())).summary.totalRequests).toBe(504);
    expect(hydrate.mock.calls.map(([rows]) => rows.length)).toEqual([500, 4]);
    expect(scan).toHaveBeenCalledTimes(4);
  });
  it.each(["policy", "attachment", "qualification", "off-page-record", "session"] as const)(
    "rejects %s changes after a contribution read",
    async (kind) => {
      const policy = await grant(),
        original = repository.hydrateStats.bind(repository);
      vi.spyOn(repository, "hydrateStats").mockImplementation(async (targets) => {
        const result = await original(targets);
        if (kind === "policy") await prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } });
        if (kind === "attachment") await RamPolicyRepository.getInstance().detachPolicy(policy.id, "role", roleId);
        if (kind === "qualification") await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        if (kind === "off-page-record")
          await prisma.aPILog.update({ where: { id: ids[2] }, data: { statusCode: 500 } });
        if (kind === "session") await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { status: 0 } });
        return result;
      });
      await expect(service.statistics({ path: prefix }, request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("detects a backdated insertion but excludes a newer insertion from the chosen snapshot", async () => {
    await grant("*");
    const original = repository.hydrateStats.bind(repository);
    const spy = vi.spyOn(repository, "hydrateStats").mockImplementation(async (targets) => {
      const result = await original(targets);
      await log(4);
      return result;
    });
    await expect(service.statistics({ path: prefix }, request())).rejects.toMatchObject({ statusCode: 403 });
    spy.mockRestore();
    const second = vi.spyOn(repository, "hydrateStats").mockImplementation(async (targets) => {
      const result = await original(targets);
      await log(0);
      return result;
    });
    expect((await service.statistics({ path: prefix }, request())).summary.totalRequests).toBe(4);
    second.mockRestore();
    expect((await service.statistics({ path: prefix }, request())).summary.totalRequests).toBe(5);
  });
  it("enforces AccessKey and rejects OAuth", async () => {
    const req = request(false);
    req.authContext!.subjectType = "access_key";
    expect((await service.statistics({ path: prefix }, req)).summary.totalRequests).toBe(3);
    req.oauthAccessToken = {} as never;
    await expect(service.statistics({ path: prefix }, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)(
    "keeps one legacy aggregate and does not hydrate native fields in %s",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const read = vi.spyOn(SystemService.getInstance(), "getLogStats"),
        hydrate = vi.spyOn(repository, "hydrateStats");
      expect((await service.statistics({ path: prefix }, request(false))).summary.totalRequests).toBe(3);
      expect(read).toHaveBeenCalledTimes(1);
      expect(hydrate).not.toHaveBeenCalled();
    },
  );
  it("keeps Controller filter forwarding and ignores a forged Action header", async () => {
    await grant(platformApiLogArn(ids[1]!));
    const req = request();
    req.headers["x-action"] = "quyan:system:log:ListLogs";
    const result = await new SystemController().getSystemLogStats(
      req,
      undefined,
      undefined,
      prefix,
      undefined,
      ["GET"],
      [200],
    );
    expect(result.summary.totalRequests).toBe(1);
  });
});
