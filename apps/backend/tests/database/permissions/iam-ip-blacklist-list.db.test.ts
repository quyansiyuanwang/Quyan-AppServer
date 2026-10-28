import { PlatformIPBlacklistCollectionRepository } from "@/store/security/platform-ip-blacklist-collection.repository";
import { IPBlackListService } from "@/services/system/ipblacklist.service";
import { IPBlacklistController } from "@/api/controllers/v1/system/ipblacklist.controller";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PlatformIPBlacklistListIamService } from "@/services/system/platform-ip-blacklist-list-iam.service";
import { platformIpAddressArn } from "@/iam/resources/platform-ip-address-resources";
import type { TypedRequest } from "@/types/express";
const service = PlatformIPBlacklistListIamService.getInstance(),
  mode = env.security.iamAuthorizationMode,
  action = "quyan:system:ip_blacklist:ListBlacklists";
let owner: string,
  actor: string,
  groupId: string,
  roleId: string,
  sessionId: string,
  ip: string,
  banId: string,
  prefix: string,
  ips: string[],
  ids: string[];
const reports = IPBlackListService.getInstance(),
  repository = PlatformIPBlacklistCollectionRepository.getInstance();
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "ip-list-" + randomUUID(),
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
async function grant(
  resource: string | string[] = ips.map(platformIpAddressArn),
  effect: "Allow" | "Deny" = "Allow",
  grantAction: string = action,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: grantAction, Resource: resource },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "ip-list-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { document: parsed.document, documentHash: parsed.documentHash, createdBy: owner },
  });
  await RamPolicyRepository.getInstance().attachPolicy(owner, policy.id, "role", roleId);
  return policy;
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  prefix = "2001:db8:" + randomUUID().slice(0, 4) + ":" + randomUUID().slice(0, 4);
  ips = [prefix + "::1", prefix + "::2", prefix + "::3"];
  ip = ips[0]!;
  owner = await user();
  groupId = (
    await prisma.group.create({
      data: { username: "ip-list-global-" + randomUUID(), permissions: [Permission.IP_BLACKLIST_READ] },
    })
  ).id;
  actor = await user(owner, groupId);
  roleId = (await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "ip-list-role-" + randomUUID() } })).id;
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
  ids = [];
  for (let index = 0; index < ips.length; index++)
    ids.push(
      (
        await prisma.iPBlackList.create({
          data: {
            ipAddress: ips[index]!,
            banType: "manual",
            banLevel: 2,
            reason: "fixture-only",
            ExpireTime: index === 2 ? new Date(0) : new Date(Date.now() + 3600000),
            createTime: new Date(Date.now() - index * 1000),
          },
        })
      ).id,
    );
  banId = ids[0]!;
});
afterEach(async () => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
  await prisma.iPBlackList.deleteMany({ where: { ipAddress: { startsWith: prefix } } });
});
describe("blacklist collections filter IP resources before total and offset", () => {
  it("omits Deny before offset and hydrates only the allowed page", async () => {
    await grant();
    await grant(platformIpAddressArn(ips[1]!), "Deny");
    const hydrate = vi.spyOn(repository, "hydrate");
    const result = await service.list(1, 1, request());
    expect(result.total).toBe(2);
    expect(result.blacklists.map((row) => row.id)).toEqual([ids[2]]);
    expect(hydrate.mock.calls[0]![0].map((row) => row.id)).toEqual([ids[2]]);
    expect(result.blacklists[0]!.ExpireTime!.getTime()).toBe(0);
  });
  it("retains Controller DTO formatting with a fixed server Action", async () => {
    await grant(platformIpAddressArn(ip));
    const req = request();
    req.headers["x-action"] = "quyan:system:ip_blacklist:CheckIPAddress";
    const result = await new IPBlacklistController().getAllIPBlacklists(req, 10, 0);
    expect(result.total).toBe(1);
    expect(result.blacklists[0]).toMatchObject({
      id: banId,
      ipAddress: ip,
      banReason: "fixture-only",
      errorCount: 0,
      metadata: {},
    });
    expect(req.iamDecisions!.every((decision) => decision.action === action)).toBe(true);
  });
  it("returns a filtered empty total without reading protected fields", async () => {
    const hydrate = vi.spyOn(repository, "hydrate");
    expect(await service.list(10, 0, request())).toEqual({ blacklists: [], total: 0 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("does not let an IP check grant authorize listing", async () => {
    await grant(ips.map(platformIpAddressArn), "Allow", "quyan:system:ip_blacklist:CheckIPAddress");
    expect((await service.list(10, 0, request())).total).toBe(0);
  });
  it("counts all permitted batches while bounding candidate and payload reads", async () => {
    const now = Date.now();
    const data = Array.from({ length: 501 }, (_, index) => ({
      ipAddress: prefix + "::" + (index + 4).toString(16),
      banType: "manual",
      banLevel: 1,
      createTime: new Date(now - 10000 - index),
    }));
    await prisma.iPBlackList.createMany({ data });
    await grant(platformIpAddressArn(ip).slice(0, -1) + "*");
    const hydrate = vi.spyOn(repository, "hydrate"),
      scan = vi.spyOn(repository, "scan");
    const result = await service.list(100, 500, request());
    expect(result.total).toBe(504);
    expect(result.blacklists).toHaveLength(4);
    expect(hydrate.mock.calls[0]![0]).toHaveLength(4);
    expect(scan).toHaveBeenCalledTimes(4);
  });
  it.each(["policy", "attachment", "qualification", "off-page-record", "session"] as const)(
    "rejects %s changes after a page read",
    async (kind) => {
      const policy = await grant(),
        original = repository.hydrate.bind(repository);
      vi.spyOn(repository, "hydrate").mockImplementation(async (targets) => {
        const result = await original(targets);
        if (kind === "policy") await prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } });
        if (kind === "attachment") await RamPolicyRepository.getInstance().detachPolicy(policy.id, "role", roleId);
        if (kind === "qualification") await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        if (kind === "off-page-record")
          await prisma.iPBlackList.update({ where: { id: ids[2] }, data: { reason: "changed fixture" } });
        if (kind === "session") await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { status: 0 } });
        return result;
      });
      await expect(service.list(1, 0, request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("detects backdated insertions and excludes newer records from the snapshot", async () => {
    await grant(platformIpAddressArn(ip).slice(0, -1) + "*");
    const original = repository.hydrate.bind(repository);
    const spy = vi.spyOn(repository, "hydrate").mockImplementation(async (targets) => {
      const result = await original(targets);
      await prisma.iPBlackList.create({
        data: { ipAddress: prefix + "::4", banType: "manual", banLevel: 1, createTime: new Date(Date.now() - 10000) },
      });
      return result;
    });
    await expect(service.list(1, 0, request())).rejects.toMatchObject({ statusCode: 403 });
    spy.mockRestore();
    vi.spyOn(repository, "hydrate").mockImplementation(async (targets) => {
      const result = await original(targets);
      await prisma.iPBlackList.create({
        data: { ipAddress: prefix + "::5", banType: "manual", banLevel: 1, createTime: new Date() },
      });
      return result;
    });
    expect((await service.list(1, 0, request())).total).toBe(4);
  });
  it("requires real global-group qualification rather than private groups or user additions", async () => {
    await grant();
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.IP_BLACKLIST_READ] } });
    await expect(service.list(10, 0, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("supports AccessKey but refuses OAuth and an impersonated context", async () => {
    const req = request(false);
    req.authContext!.subjectType = "access_key";
    expect((await service.list(10, 0, req)).total).toBe(3);
    req.oauthAccessToken = {} as never;
    await expect(service.list(10, 0, req)).rejects.toMatchObject({ statusCode: 403 });
    const other = request(false);
    other.authContext!.principalUserId = owner;
    await expect(service.list(10, 0, other)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("retains one original list query in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const read = vi.spyOn(reports, "getBlacklist"),
      hydrate = vi.spyOn(repository, "hydrate");
    expect((await service.list(10, 0, request(false))).total).toBe(3);
    expect(read).toHaveBeenCalledTimes(1);
    expect(hydrate).not.toHaveBeenCalled();
  });
});
