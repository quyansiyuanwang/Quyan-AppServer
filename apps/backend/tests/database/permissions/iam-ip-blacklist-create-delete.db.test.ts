import { RECORD_STATUS } from "@/constant/status";
import { RedisService } from "@/services/infrastructure/redis.service";
import { IPBlackListService } from "@/services/system/ipblacklist.service";
import { ConfigService } from "@/services/system/config.service";
import { OperationType } from "@/constant/operation-type";
import { PlatformIpBlacklistMutationRepository } from "@/store/security/platform-ip-blacklist-mutation.repository";
import { IPBlacklistController } from "@/api/controllers/v1/system/ipblacklist.controller";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PlatformIpBlacklistMutationIamService } from "@/services/system/platform-ip-blacklist-mutation-iam.service";
import { platformIpAddressArn } from "@/iam/resources/platform-ip-address-resources";
import type { TypedRequest } from "@/types/express";
const service = PlatformIpBlacklistMutationIamService.getInstance(),
  mode = env.security.iamAuthorizationMode,
  action = "quyan:system:ip_blacklist:CreateBlacklist";
let owner: string, actor: string, groupId: string, roleId: string, sessionId: string, ip: string;
const repository = PlatformIpBlacklistMutationRepository.getInstance();
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "ip-ban-mutations-" + randomUUID(),
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
  resource: string | string[] = platformIpAddressArn(ip),
  effect: "Allow" | "Deny" = "Allow",
  grantAction: string | string[] = action,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: grantAction, Resource: resource },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "ip-ban-mutations-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { document: parsed.document, documentHash: parsed.documentHash, createdBy: owner },
  });
  await RamPolicyRepository.getInstance().attachPolicy(owner, policy.id, "role", roleId);
  return policy;
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  ip = "2001:db8:" + randomUUID().slice(0, 4) + ":" + randomUUID().slice(0, 4) + "::1";
  owner = await user();
  groupId = (
    await prisma.group.create({
      data: {
        username: "ip-ban-mutations-global-" + randomUUID(),
        permissions: [Permission.IP_BLACKLIST_CREATE, Permission.IP_BLACKLIST_UPDATE, Permission.IP_BLACKLIST_DELETE],
      },
    })
  ).id;
  actor = await user(owner, groupId);
  roleId = (
    await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "ip-ban-mutations-role-" + randomUUID() } })
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
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});

const deleteAction = "quyan:system:ip_blacklist:DeleteBlacklist",
  redis = RedisService.getInstance();
const input = () => ({ ipAddress: ip, duration: 60, reason: "fixture manual" });
const record = () => prisma.iPBlackList.findUnique({ where: { ipAddress: ip } });
const existing = () =>
  prisma.iPBlackList.create({
    data: {
      ipAddress: ip,
      banType: "auto",
      banLevel: 2,
      reason: "original",
      ExpireTime: new Date(Date.now() + 3600000),
    },
  });
const businessLogs = () =>
  prisma.businessLog.findMany({
    where: { targetResourceId: ip, operationType: { in: [OperationType.IP_BAN, OperationType.IP_UNBAN] } },
  });
describe("manual ban and unban require resource grants and retain trusted background bans", () => {
  it("creates and unbans through the Controller with the trusted actor and business audit", async () => {
    await grant(platformIpAddressArn(ip), "Allow", [action, deleteAction]);
    const controller = new IPBlacklistController();
    const created = await controller.createIPBlacklist(input(), request());
    expect(created).toMatchObject({
      ipAddress: ip,
      banReason: "fixture manual",
      banLevel: 0,
      bannedBy: actor,
      status: 1,
    });
    expect(controller.getStatus()).toBe(201);
    expect(await record()).toMatchObject({ banType: "manual", bannedBy: actor });
    await redis.setWithResult(RedisService.getIpErrorWeightKey(ip), "7");
    expect(await controller.deleteIPBlacklist(ip, request())).toEqual({ success: true });
    expect(await record()).toMatchObject({ status: RECORD_STATUS.DELETED });
    expect(await redis.get(RedisService.getIpErrorWeightKey(ip))).toBe("7");
    const logs = await businessLogs();
    expect(logs).toHaveLength(2);
    expect(
      logs.every((row) => row.actorUserId === actor && row.targetResourceType === "IP_ADDRESS" && row.success),
    ).toBe(true);
  });
  it("restores a soft-deleted record identity and keeps the permanent ban representation", async () => {
    const row = await existing();
    await prisma.iPBlackList.update({ where: { id: row.id }, data: { status: RECORD_STATUS.DELETED } });
    await grant();
    const created = await service.create({ ...input(), duration: -1 }, request());
    expect(created).toMatchObject({
      id: row.id,
      status: 1,
      banType: "manual",
      banLevel: 0,
      bannedBy: actor,
      ExpireTime: new Date("2099-12-31"),
    });
  });
  it("rejects duplicate active records without overwriting or success audit", async () => {
    const row = await existing();
    await grant();
    await expect(service.create(input(), request())).rejects.toMatchObject({ statusCode: 409 });
    expect(await record()).toMatchObject({ id: row.id, reason: "original", banType: "auto", banLevel: 2 });
    expect(await businessLogs()).toHaveLength(0);
  });
  it.each(["deny", "other-ip", "update-only", "missing-allow"])(
    "refuses create for %s without a record or success audit",
    async (kind) => {
      if (kind === "deny") {
        await grant("*");
        await grant(platformIpAddressArn(ip), "Deny");
      }
      if (kind === "other-ip") await grant(platformIpAddressArn("192.0.2.1"));
      if (kind === "update-only")
        await grant(platformIpAddressArn(ip), "Allow", "quyan:system:ip_blacklist:UpdateBlacklist");
      await expect(service.create(input(), request())).rejects.toMatchObject({ statusCode: 403 });
      expect(await record()).toBeNull();
      expect(await businessLogs()).toHaveLength(0);
    },
  );
  it.each(["deny", "other-ip", "create-only", "missing-allow"])(
    "refuses delete for %s without side effects",
    async (kind) => {
      await existing();
      if (kind === "deny") {
        await grant("*", "Allow", deleteAction);
        await grant(platformIpAddressArn(ip), "Deny", deleteAction);
      }
      if (kind === "other-ip") await grant(platformIpAddressArn("192.0.2.1"), "Allow", deleteAction);
      if (kind === "create-only") await grant();
      await expect(service.remove(ip, request())).rejects.toMatchObject({ statusCode: 403 });
      expect((await record())!.status).toBe(1);
      expect(await businessLogs()).toHaveLength(0);
    },
  );
  it.each(["missing", "deleted"])("refuses %s unban targets even with wildcard grant", async (kind) => {
    if (kind === "deleted") {
      const row = await existing();
      await prisma.iPBlackList.update({ where: { id: row.id }, data: { status: RECORD_STATUS.DELETED } });
    }
    await grant("*", "Allow", deleteAction);
    await expect(service.remove(ip, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await businessLogs()).toHaveLength(0);
  });
  it.each(["private-group", "additions", "read-only"])(
    "cannot create or delete with %s qualification",
    async (kind) => {
      await grant("*", "Allow", [action, deleteAction]);
      if (kind === "private-group")
        await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      if (kind === "additions") {
        await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        await prisma.user.update({
          where: { id: actor },
          data: { permissionAdds: [Permission.IP_BLACKLIST_CREATE, Permission.IP_BLACKLIST_DELETE] },
        });
      }
      if (kind === "read-only")
        await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.IP_BLACKLIST_READ] } });
      await expect(service.create(input(), request())).rejects.toMatchObject({ statusCode: 403 });
      expect(await record()).toBeNull();
      await existing();
      await expect(service.remove(ip, request())).rejects.toMatchObject({ statusCode: 403 });
      expect((await record())!.status).toBe(1);
    },
  );
  it.each(["policy", "group", "session", "role", "principal", "target"])(
    "refuses create after %s changes",
    async (kind) => {
      const policy = await grant(),
        original = repository.create.bind(repository);
      vi.spyOn(repository, "create").mockImplementation(async (target, input, guard) => {
        if (kind === "policy") await prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } });
        if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        if (kind === "session") await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { status: 0 } });
        if (kind === "role") await prisma.ramRole.update({ where: { id: roleId }, data: { status: 0 } });
        if (kind === "principal") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
        if (kind === "target") await existing();
        return original(target, input, guard);
      });
      await expect(service.create(input(), request())).rejects.toMatchObject({ statusCode: 403 });
      expect(kind === "target" ? (await record())!.reason : await record()).toBe(kind === "target" ? "original" : null);
      expect(await businessLogs()).toHaveLength(0);
    },
  );
  it.each(["policy", "group", "session", "record"])("refuses delete after %s changes", async (kind) => {
    await existing();
    const policy = await grant(platformIpAddressArn(ip), "Allow", deleteAction),
      original = repository.remove.bind(repository);
    vi.spyOn(repository, "remove").mockImplementation(async (target, guard) => {
      if (kind === "policy") await prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } });
      if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      if (kind === "session") await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { status: 0 } });
      if (kind === "record")
        await prisma.iPBlackList.update({ where: { id: target.id }, data: { reason: "concurrent edit" } });
      return original(target, guard);
    });
    await expect(service.remove(ip, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await record())!.status).toBe(1);
    expect(await businessLogs()).toHaveLength(0);
  });
  it("retains AccessKey qualification and prevents OAuth/impersonation", async () => {
    const req = request(false);
    req.authContext!.subjectType = "access_key";
    await service.create(input(), req);
    expect((await record())!.bannedBy).toBe(actor);
    req.oauthAccessToken = {} as never;
    await expect(service.remove(ip, req)).rejects.toMatchObject({ statusCode: 403 });
    delete req.oauthAccessToken;
    req.authContext!.principalUserId = owner;
    await expect(service.remove(ip, req)).rejects.toMatchObject({ statusCode: 403 });
    expect((await record())!.status).toBe(1);
  });
  it.each(["legacy", "shadow"] as const)("retains original creation, soft deletion and logs in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const nativeCreate = vi.spyOn(repository, "create"),
      nativeDelete = vi.spyOn(repository, "remove");
    await service.create(input(), request(false));
    await service.remove(ip, request(false));
    expect((await record())!.status).toBe(RECORD_STATUS.DELETED);
    expect(await businessLogs()).toHaveLength(2);
    expect(nativeCreate).not.toHaveBeenCalled();
    expect(nativeDelete).not.toHaveBeenCalled();
    await expect(service.remove(ip, request(false))).rejects.toMatchObject({ statusCode: 404 });
  });
  it("preserves automatic trusted background bans independently of the caller's IAM grants", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    const config = ConfigService.getInstance(),
      current = await config.getIpBanConfig();
    vi.spyOn(config, "getIpBanConfig").mockResolvedValue({
      ...current,
      enabled: true,
      level1Threshold: 1,
      level2Threshold: 2,
      level3Threshold: 3,
      level1Duration: 60,
    });
    expect(await IPBlackListService.getInstance().checkAndBanIfNeeded(ip, 1)).toMatchObject({ banned: true, level: 1 });
    expect(await record()).toMatchObject({ banType: "auto", banLevel: 1 });
    expect(await businessLogs()).toHaveLength(1);
  });
});
