import { IPBlackListService } from "@/services/system/ipblacklist.service";
import { IPBlacklistController } from "@/api/controllers/v1/system/ipblacklist.controller";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PlatformIpAddressReadIamService } from "@/services/system/platform-ip-address-read-iam.service";
import { platformIpAddressArn } from "@/iam/resources/platform-ip-address-resources";
import type { TypedRequest } from "@/types/express";
const service = PlatformIpAddressReadIamService.getInstance(),
  mode = env.security.iamAuthorizationMode,
  action = "quyan:system:ip_blacklist:CheckIPAddress";
let owner: string, actor: string, groupId: string, roleId: string, sessionId: string, ip: string, banId: string;
const reports = IPBlackListService.getInstance(),
  errorAction = "quyan:system:ip_blacklist:GetIPAddressErrorStatus";
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "ip-read-" + randomUUID(),
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
    name: "ip-read-policy-" + randomUUID(),
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
      data: { username: "ip-read-global-" + randomUUID(), permissions: [Permission.IP_BLACKLIST_READ] },
    })
  ).id;
  actor = await user(owner, groupId);
  roleId = (await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "ip-read-role-" + randomUUID() } })).id;
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
describe("specific IP reads enforce policies and real platform eligibility", () => {
  it("checks a permitted address through the Controller and retains the DTO", async () => {
    await grant();
    const req = request();
    req.headers["x-action"] = errorAction;
    const result = await new IPBlacklistController().checkIPBlacklist(ip, req);
    expect(result.isBlacklisted).toBe(true);
    expect(result.blacklistInfo).toMatchObject({ id: banId, ipAddress: ip, banLevel: 2, banReason: "fixture-only" });
    expect(
      req.iamDecisions!.every(
        (decision) => decision.action === action && decision.resource === platformIpAddressArn(ip),
      ),
    ).toBe(true);
  });
  it("reads actual error status from isolated Redis and current ban configuration", async () => {
    await grant(platformIpAddressArn(ip), "Allow", errorAction);
    const result = await new IPBlacklistController().getIpErrorStatus(ip, request());
    expect(result).toMatchObject({ ipAddress: ip, errorWeight: 0, isBanned: true, errorBreakdown: [] });
    expect(result.thresholds.level1).toBeGreaterThan(0);
  });
  it.each(["check", "errorStatus"] as const)("fails closed without a role grant for %s", async (kind) => {
    const read = vi.spyOn(reports, kind === "check" ? "isIpBlacklisted" : "getIpErrorStatus");
    await expect(service[kind](ip, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("keeps check and error status grants independent", async () => {
    await grant();
    await expect(service.errorStatus(ip, request())).rejects.toMatchObject({ statusCode: 403 });
    await grant(platformIpAddressArn(ip), "Allow", errorAction);
    await expect(service.errorStatus(ip, request())).resolves.toMatchObject({ ipAddress: ip });
  });
  it("limits a grant to its exact address and honors Deny across equivalent spellings", async () => {
    await grant();
    await expect(service.check("192.0.2.2", request())).rejects.toMatchObject({ statusCode: 403 });
    await grant(platformIpAddressArn(ip), "Deny");
    await expect(service.check(ip.toUpperCase(), request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("handles unlisted and expired addresses without exposing an expired reason", async () => {
    await grant("*");
    expect(await service.check("198.51.100.2", request())).toEqual({ isBlacklisted: false, blacklistInfo: null });
    await prisma.iPBlackList.update({ where: { id: banId }, data: { ExpireTime: new Date(0) } });
    expect(await service.check(ip, request())).toEqual({ isBlacklisted: false, blacklistInfo: null });
  });
  it("does not substitute a private group or user additions for platform qualification", async () => {
    await grant("*");
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.IP_BLACKLIST_READ] } });
    await expect(service.check(ip, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["policy", "attachment", "qualification", "record", "session", "principal"] as const)(
    "discards status after %s revocation",
    async (kind) => {
      const policy = await grant(),
        original = reports.isIpBlacklisted.bind(reports);
      vi.spyOn(reports, "isIpBlacklisted").mockImplementation(async (value) => {
        const result = await original(value);
        if (kind === "policy") await prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } });
        if (kind === "attachment") await RamPolicyRepository.getInstance().detachPolicy(policy.id, "role", roleId);
        if (kind === "qualification") await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        if (kind === "record")
          await prisma.iPBlackList.update({ where: { id: banId }, data: { reason: "changed fixture" } });
        if (kind === "session") await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { status: 0 } });
        if (kind === "principal") await prisma.user.update({ where: { id: actor }, data: { status: -1 } });
        return result;
      });
      await expect(service.check(ip, request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("refuses an error-status response after qualification is revoked", async () => {
    await grant(platformIpAddressArn(ip), "Allow", errorAction);
    const original = reports.getIpErrorStatus.bind(reports);
    vi.spyOn(reports, "getIpErrorStatus").mockImplementation(async (value) => {
      const result = await original(value);
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      return result;
    });
    await expect(service.errorStatus(ip, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("supports AccessKey and rejects OAuth or nested impersonation", async () => {
    const req = request(false);
    req.authContext!.subjectType = "access_key";
    expect((await service.check(ip, req)).isBlacklisted).toBe(true);
    req.oauthAccessToken = {} as never;
    await expect(service.check(ip, req)).rejects.toMatchObject({ statusCode: 403 });
    const other = request(false);
    other.authContext!.principalUserId = owner;
    await expect(service.check(ip, other)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("retains one original query in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const read = vi.spyOn(reports, "isIpBlacklisted"),
      detail = vi.spyOn(reports, "getBlacklistInfo"),
      status = vi.spyOn(reports, "getIpErrorStatus");
    expect((await service.check(ip, request(false))).isBlacklisted).toBe(true);
    await service.errorStatus(ip, request(false));
    expect(read).toHaveBeenCalledTimes(1);
    expect(detail).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(1);
  });
});
