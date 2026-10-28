import { PlatformIpMonitoringDashboardRepository } from "@/store/security/platform-ip-monitoring-dashboard.repository";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { RECORD_STATUS } from "@/constant/status";
import { IPBlackListService } from "@/services/system/ipblacklist.service";
import { IPBlacklistController } from "@/api/controllers/v1/system/ipblacklist.controller";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PlatformIpMonitoringDashboardIamService } from "@/services/system/platform-ip-monitoring-dashboard-iam.service";
import { platformIpAddressArn } from "@/iam/resources/platform-ip-address-resources";
import type { TypedRequest } from "@/types/express";
const service = PlatformIpMonitoringDashboardIamService.getInstance(),
  mode = env.security.iamAuthorizationMode,
  action = "quyan:system:ip_blacklist:GetMonitoringDashboard";
let owner: string, actor: string, groupId: string, roleId: string, sessionId: string, ip: string, banId: string;
const reports = IPBlackListService.getInstance();
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "ip-dashboard-" + randomUUID(),
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
  grantAction: string = action,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: grantAction, Resource: resource },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "ip-dashboard-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { document: parsed.document, documentHash: parsed.documentHash, createdBy: owner },
  });
  await RamPolicyRepository.getInstance().attachPolicy(owner, policy.id, "role", roleId);
  return policy;
}
beforeEach(async () => {
  await prisma.iPBlackList.deleteMany();
  await prisma.businessLog.deleteMany({ where: { operationType: OperationType.IP_BAN } });
  env.security.iamAuthorizationMode = "enforce";
  ip = "2001:db8:" + randomUUID().slice(0, 4) + ":" + randomUUID().slice(0, 4) + "::1";
  owner = await user();
  groupId = (
    await prisma.group.create({
      data: { username: "ip-dashboard-global-" + randomUUID(), permissions: [Permission.IP_BLACKLIST_READ] },
    })
  ).id;
  actor = await user(owner, groupId);
  roleId = (await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "ip-dashboard-role-" + randomUUID() } }))
    .id;
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
  banId = (
    await prisma.iPBlackList.create({
      data: {
        ipAddress: ip,
        banType: "manual",
        banLevel: 2,
        reason: "fixture-only",
        ExpireTime: new Date(Date.now() + 3600000),
      },
    })
  ).id;
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});

const repository = PlatformIpMonitoringDashboardRepository.getInstance();
const event = async (address = ip, time = new Date(Date.now() - 30000)) =>
  prisma.businessLog.create({
    data: {
      operationType: OperationType.IP_BAN,
      operationCategory: OperationCategory.SECURITY,
      targetResourceType: "IP_ADDRESS",
      targetResourceId: address,
      description: "fixture-only",
      ipAddress: "192.0.2.1",
      createTime: time,
    },
  });
describe("dashboard authorizes blacklist and activity contributions through one verified cursor", () => {
  it("returns actual authorized ban and event statistics through the Controller", async () => {
    await grant();
    await event();
    const result = await new IPBlacklistController().getMonitoringDashboard(request());
    expect(result.activeBans).toMatchObject({
      total: 1,
      byLevel: { level1: 0, level2: 1, level3: 0 },
      byType: { auto: 0, manual: 1 },
    });
    expect(result.activeBans.recentBans[0]).toMatchObject({ id: banId, ipAddress: ip, banReason: "fixture-only" });
    expect(result.recentActivity).toMatchObject({ last24Hours: 1, last7Days: 1 });
    expect(result.topBannedIPs).toMatchObject([{ ipAddress: ip, banCount: 1, currentStatus: "banned" }]);
  });
  it("excludes unauthorized ban details, events and rankings", async () => {
    await grant();
    await event();
    const other = "192.0.2.23";
    await prisma.iPBlackList.create({
      data: { ipAddress: other, reason: "hidden reason", ExpireTime: new Date(Date.now() + 3600000) },
    });
    await event(other);
    const result = await service.read(request());
    expect(result.activeBans.total).toBe(1);
    expect(result.recentActivity.last7Days).toBe(1);
    expect(JSON.stringify(result)).not.toContain(other);
    expect(JSON.stringify(result)).not.toContain("hidden reason");
  });
  it.each(["explicit-deny", "list-only", "missing-allow"])(
    "does not substitute %s for dashboard grants",
    async (kind) => {
      await event();
      if (kind === "explicit-deny") {
        await grant("*");
        await grant(platformIpAddressArn(ip), "Deny");
      }
      if (kind === "list-only") await grant("*", "Allow", "quyan:system:ip_blacklist:ListBlacklists");
      const result = await service.read(request());
      expect(result.activeBans.total).toBe(0);
      expect(result.activeBans.recentBans).toEqual([]);
      expect(result.recentActivity.last7Days).toBe(0);
      expect(result.topBannedIPs).toEqual([]);
    },
  );
  it("retains the existing window and permanent-null exclusion semantics", async () => {
    await grant();
    await event();
    await event(ip, new Date(Date.now() - 2 * 24 * 3600000));
    await event(ip, new Date(Date.now() - 8 * 24 * 3600000));
    await prisma.iPBlackList.update({ where: { id: banId }, data: { ExpireTime: null } });
    const result = await service.read(request());
    expect(result.activeBans.total).toBe(0);
    expect(result.recentActivity).toMatchObject({ last24Hours: 1, last7Days: 2 });
    expect(result.topBannedIPs[0]).toMatchObject({ banCount: 2, currentStatus: "unbanned" });
  });
  it("keeps expired history outside the active-ban summary", async () => {
    await grant();
    await prisma.iPBlackList.update({ where: { id: banId }, data: { ExpireTime: new Date(Date.now() - 1000) } });
    await event();
    const result = await service.read(request());
    expect(result.activeBans.total).toBe(0);
    expect(result.recentActivity.last7Days).toBe(1);
    expect(result.topBannedIPs[0]!.currentStatus).toBe("unbanned");
  });
  it("merges tied-time cursors across multiple batches without duplicating either source", async () => {
    await grant();
    const time = new Date(Date.now() - 60000);
    await prisma.businessLog.createMany({
      data: Array.from({ length: 1005 }, () => ({
        operationType: OperationType.IP_BAN,
        operationCategory: OperationCategory.SECURITY,
        targetResourceType: "IP_ADDRESS",
        targetResourceId: ip,
        description: "fixture-only",
        ipAddress: "192.0.2.1",
        createTime: time,
      })),
    });
    await prisma.iPBlackList.update({ where: { id: banId }, data: { createTime: time } });
    const result = await service.read(request());
    expect(result.activeBans.total).toBe(1);
    expect(result.recentActivity.last7Days).toBe(1005);
    expect(result.recentActivity.timeline.reduce((sum, item) => sum + item.count, 0)).toBe(1000);
    expect(result.topBannedIPs[0]!.banCount).toBe(1000);
  });
  it.each(["ban", "event", "group", "policy", "session"])(
    "discards results after %s changes while reading details",
    async (kind) => {
      const policy = await grant(),
        log = await event(),
        original = repository.hydrateBans.bind(repository);
      vi.spyOn(repository, "hydrateBans").mockImplementation(async (targets) => {
        const result = await original(targets);
        if (kind === "ban") await prisma.iPBlackList.update({ where: { id: banId }, data: { banLevel: 3 } });
        if (kind === "event")
          await prisma.businessLog.update({ where: { id: log.id }, data: { status: RECORD_STATUS.DELETED } });
        if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        if (kind === "policy") await prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } });
        if (kind === "session") await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { status: 0 } });
        return result;
      });
      await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("cannot use private groups or user additions as platform qualification", async () => {
    await grant("*");
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.IP_BLACKLIST_READ] } });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses malformed event resource identifiers without granting all resources", async () => {
    await grant("*");
    await event("invalid-ip");
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("retains the original aggregate in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    await event();
    const original = vi.spyOn(reports, "getMonitoringDashboard");
    const result = await service.read(request(false));
    expect(result.activeBans.total).toBe(1);
    expect(result.recentActivity.last7Days).toBe(1);
    expect(original).toHaveBeenCalledTimes(1);
  });
});
