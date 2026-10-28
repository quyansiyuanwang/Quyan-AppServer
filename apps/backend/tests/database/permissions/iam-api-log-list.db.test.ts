import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PlatformApiLogReadRepository } from "@/store/system/platform-api-log-read.repository";
import { PlatformApiLogListIamService } from "@/services/system/platform-api-log-list-iam.service";
import { PlatformApiLogReadIamService } from "@/services/system/platform-api-log-read-iam.service";
import { SystemService } from "@/services/system/system.service";
import { SystemController } from "@/api/controllers/v1/system/system.controller";
import { APILogRepository } from "@/store/system/apilog";
import { platformApiLogArn } from "@/iam/resources/platform-api-log-resources";
import { INTERNAL_LOG_METADATA_KEY } from "@/config/logging";
import type { TypedRequest } from "@/types/express";
const service = PlatformApiLogListIamService.getInstance(),
  repository = PlatformApiLogReadRepository.getInstance(),
  mode = env.security.iamAuthorizationMode,
  action = "quyan:system:log:ListLogs";
let owner: string, actor: string, groupId: string, roleId: string, sessionId: string, prefix: string, ids: string[];
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "api-list-" + randomUUID(),
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
        requestHeaders: { "content-length": "17", [INTERNAL_LOG_METADATA_KEY]: { responseSizeBytes: 42 } },
        createTime: new Date(Date.now() - index * 1000),
        ...extra,
      },
    })
  ).id;
async function grant(resource: string | string[] = ids.map(platformApiLogArn), effect: "Allow" | "Deny" = "Allow") {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: effect, Action: action, Resource: resource } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "api-list-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { document: parsed.document, documentHash: parsed.documentHash, createdBy: owner },
  });
  await RamPolicyRepository.getInstance().attachPolicy(owner, policy.id, "role", roleId);
  return policy;
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  prefix = "/fixture/api-list/" + randomUUID();
  owner = await user();
  groupId = (
    await prisma.group.create({
      data: { username: "api-list-global-" + randomUUID(), permissions: [Permission.API_LOG_READ] },
    })
  ).id;
  actor = await user(owner, groupId);
  roleId = (await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "api-list-role-" + randomUUID() } })).id;
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
describe("API log lists filter before pagination, totals and payload reads", () => {
  it("omits denied resources before page selection and returns only allowed totals", async () => {
    await grant();
    await grant(platformApiLogArn(ids[1]!), "Deny");
    const hydrate = vi.spyOn(repository, "hydrate");
    const page = await service.list(2, 1, { path: prefix }, request());
    expect(page.total).toBe(2);
    expect(page.logs.map((row) => row.id)).toEqual([ids[2]]);
    expect(hydrate.mock.calls[0]![0].map((row) => row.id)).toEqual([ids[2]]);
    expect(page.logs[0]).toMatchObject({ requestSizeBytes: 17, responseSizeBytes: 42, username: expect.any(String) });
    expect(page.logs[0]).not.toHaveProperty("requestHeaders");
    expect(page.logs[0]).not.toHaveProperty("response");
    expect(page.logs[0]).not.toHaveProperty("responseHeaders");
  });
  it.each([Permission.API_LOG_READ, Permission.SYSTEM_LOG_READ])(
    "accepts the %s platform qualification without changing the fixed Action",
    async (permission) => {
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [permission] } });
      await grant(platformApiLogArn(ids[0]!));
      expect((await service.list(1, 10, { path: prefix }, request())).total).toBe(1);
    },
  );
  it("list permission cannot read an individual log's full payload", async () => {
    await grant();
    const hydrate = vi.fn().mockImplementation(() => SystemService.getInstance().getLogDetail(ids[0]!));
    await expect(PlatformApiLogReadIamService.getInstance().read(ids[0]!, request(), hydrate)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("has no inherited group Allow in a role session and does not reveal the account's unfiltered total", async () => {
    const hydrate = vi.spyOn(repository, "hydrate");
    expect(await service.list(1, 10, { path: prefix }, request())).toEqual({ logs: [], total: 0 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("finds permitted resources after a denied first scan batch", async () => {
    const rows = Array.from({ length: 502 }, (_, index) => ({
      id: "bulk-" + randomUUID(),
      requestID: randomUUID(),
      userID: actor,
      path: prefix + "/bulk",
      method: "GET",
      statusCode: 200,
      ipAddress: "192.0.2.1",
      createTime: new Date(Date.now() - index * 1000),
    }));
    await prisma.aPILog.createMany({ data: rows });
    await grant(platformApiLogArn(rows[501]!.id));
    const scan = vi.spyOn(repository, "scan"),
      result = await service.list(1, 1, { path: prefix + "/bulk" }, request());
    expect(result.logs.map((row) => row.id)).toEqual([rows[501]!.id]);
    expect(result.total).toBe(1);
    expect(scan).toHaveBeenCalledTimes(4);
  });
  it("reuses existing date, method, status, username and literal keyword semantics", async () => {
    await grant();
    await prisma.aPILog.update({
      where: { id: ids[1]! },
      data: { method: "POST", statusCode: 500, bodyParams: "different payload" },
    });
    const username = (await prisma.user.findUniqueOrThrow({ where: { id: actor } })).username;
    const byUser = await service.list(
      1,
      10,
      { path: prefix, user: username, method: ["GET"], statusCode: [200] },
      request(),
    );
    expect(byUser.logs.map((row) => row.id)).toEqual([ids[0], ids[2]]);
    expect(byUser.total).toBe(2);
    expect(await service.list(1, 10, { path: prefix, user: "no-match-" + randomUUID() }, request())).toEqual({
      logs: [],
      total: 0,
    });
    const byPayload = await service.list(1, 10, { search: "中文针" }, request());
    expect(byPayload.logs.map((row) => row.id)).toEqual([ids[0], ids[2]]);
    const raw = await APILogRepository.getInstance().query({
      path: prefix,
      method: ["GET"],
      statusCode: [200],
      limit: 100,
    });
    expect(raw.total).toBe(byUser.total);
    expect(raw.logs.map((row) => row.id)).toEqual(byUser.logs.map((row) => row.id));
  });
  it.each(["policy", "binding", "qualification", "off-page-log", "session"])(
    "rejects %s changes after selecting the allowed page",
    async (change) => {
      const policy = await grant();
      const original = repository.hydrate.bind(repository);
      vi.spyOn(repository, "hydrate").mockImplementation(async (targets) => {
        const result = await original(targets);
        if (change === "policy") await prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } });
        if (change === "binding") await RamPolicyRepository.getInstance().detachPolicy(policy.id, "role", roleId);
        if (change === "qualification")
          await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        if (change === "off-page-log") await prisma.aPILog.update({ where: { id: ids[2]! }, data: { status: 0 } });
        if (change === "session")
          await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
        return result;
      });
      await expect(service.list(1, 1, { path: prefix }, request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("does not return stale counts after a backdated allowed resource is inserted during hydration", async () => {
    await grant("*");
    const original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (targets) => {
      const result = await original(targets);
      await log(4);
      return result;
    });
    await expect(service.list(1, 1, { path: prefix }, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("excludes newer logs from the fixed snapshot and picks them up on the next request", async () => {
    await grant("*");
    const original = repository.hydrate.bind(repository);
    let added: string | undefined;
    const spy = vi.spyOn(repository, "hydrate").mockImplementation(async (targets) => {
      const result = await original(targets);
      added = await log(0);
      return result;
    });
    expect((await service.list(1, 1, { path: prefix }, request())).total).toBe(3);
    spy.mockRestore();
    const next = await service.list(1, 1, { path: prefix }, request());
    expect(next.total).toBe(4);
    expect(next.logs[0]!.id).toBe(added);
  });
  it("handles equal-time keys deterministically across pages", async () => {
    await prisma.aPILog.updateMany({ where: { id: { in: ids } }, data: { createTime: new Date(Date.now() - 10000) } });
    await grant();
    const sorted = [...ids].sort().reverse(),
      seen: string[] = [];
    for (let page = 1; page <= 3; page++)
      seen.push((await service.list(page, 1, { path: prefix }, request())).logs[0]!.id);
    expect(seen).toEqual(sorted);
  });
  it("enforces AccessKey identities and rejects OAuth contexts", async () => {
    const req = request(false);
    req.authContext!.subjectType = "access_key";
    expect((await service.list(1, 10, { path: prefix }, req)).total).toBe(3);
    req.oauthAccessToken = {} as never;
    await expect(service.list(1, 10, { path: prefix }, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("keeps one legacy payload query and total in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const query = vi.spyOn(SystemService.getInstance(), "getLogs");
    expect((await service.list(1, 1, { path: prefix }, request(false))).total).toBe(3);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("controller applies the same resource-filtered pagination", async () => {
    await grant(platformApiLogArn(ids[1]!));
    const result = await new SystemController().getSystemLogs(request(), 1, 1, undefined, undefined, prefix);
    expect(result.total).toBe(1);
    expect(result.logs.map((row) => row.id)).toEqual([ids[1]]);
  });
});
