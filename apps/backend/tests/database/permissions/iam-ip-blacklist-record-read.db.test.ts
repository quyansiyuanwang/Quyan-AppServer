import { PlatformIPBlacklistRecordReadRepository } from "@/store/security/platform-ip-blacklist-record-read.repository";
import { platformIpBlacklistRecordResourceResolver } from "@/iam/request/platform-ip-address-resource-resolvers";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { IPBlacklistController } from "@/api/controllers/v1/system/ipblacklist.controller";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PlatformIPBlacklistRecordReadIamService } from "@/services/system/platform-ip-blacklist-record-read-iam.service";
import { platformIpAddressArn } from "@/iam/resources/platform-ip-address-resources";
import type { TypedRequest } from "@/types/express";
const service = PlatformIPBlacklistRecordReadIamService.getInstance(),
  mode = env.security.iamAuthorizationMode,
  action = "quyan:system:ip_blacklist:GetBlacklist";
let owner: string, actor: string, groupId: string, roleId: string, sessionId: string, ip: string, banId: string;
const repository = PlatformIPBlacklistRecordReadRepository.getInstance();
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "ip-record-" + randomUUID(),
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
    name: "ip-record-policy-" + randomUUID(),
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
      data: { username: "ip-record-global-" + randomUUID(), permissions: [Permission.IP_BLACKLIST_READ] },
    })
  ).id;
  actor = await user(owner, groupId);
  roleId = (await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "ip-record-role-" + randomUUID() } }))
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
describe("blacklist record detail resolves the actual IP before protected hydration", () => {
  it("returns real Controller detail in place of the former placeholder", async () => {
    await grant();
    const req = request();
    req.params.id = banId;
    Object.assign(req, { body: { ipAddress: "192.0.2.9", accountOwnerId: "other" } });
    req.headers["x-action"] = "quyan:system:ip_blacklist:ListBlacklists";
    expect(await platformIpBlacklistRecordResourceResolver({ request: req, principal: getIamPrincipal(req)! })).toBe(
      platformIpAddressArn(ip),
    );
    const result = await new IPBlacklistController().getIPBlacklistById(banId, req);
    expect(result).toMatchObject({ id: banId, ipAddress: ip, banReason: "fixture-only", errorCount: 0, metadata: {} });
    expect(
      req.iamDecisions!.every(
        (decision) => decision.action === action && decision.resource === platformIpAddressArn(ip),
      ),
    ).toBe(true);
  });
  it("does not expose a record without an exact role grant or through CheckIPAddress", async () => {
    const hydrate = vi.spyOn(repository, "hydrate");
    await expect(service.read(banId, request())).rejects.toMatchObject({ statusCode: 403 });
    await grant(platformIpAddressArn(ip), "Allow", "quyan:system:ip_blacklist:CheckIPAddress");
    await expect(service.read(banId, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("honors Deny and limits permission to the source record IP", async () => {
    await grant(platformIpAddressArn("192.0.2.9"));
    await expect(service.read(banId, request())).rejects.toMatchObject({ statusCode: 403 });
    await grant();
    await grant(platformIpAddressArn(ip), "Deny");
    await expect(service.read(banId, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("permits authorized expired history and denies deleted records", async () => {
    await grant();
    await prisma.iPBlackList.update({ where: { id: banId }, data: { ExpireTime: new Date(0) } });
    expect((await service.read(banId, request())).ExpireTime!.getTime()).toBe(0);
    await prisma.iPBlackList.update({ where: { id: banId }, data: { status: -1 } });
    await expect(service.read(banId, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects missing and invalid resources without resolving them to a wildcard", async () => {
    await grant("*");
    const req = request();
    req.params.id = "absent-" + randomUUID();
    expect(
      await platformIpBlacklistRecordResourceResolver({ request: req, principal: getIamPrincipal(req)! }),
    ).toBeUndefined();
    await expect(service.read(req.params.id as string, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.read("../" + banId, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses private-group and user-addition substitutions before resolving an address", async () => {
    await grant();
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.IP_BLACKLIST_READ] } });
    const req = request();
    req.params.id = banId;
    await expect(
      platformIpBlacklistRecordResourceResolver({ request: req, principal: getIamPrincipal(req)! }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.read(banId, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["policy", "attachment", "qualification", "record", "address", "session"] as const)(
    "discards an already hydrated detail after %s changes",
    async (kind) => {
      const policy = await grant(),
        original = repository.hydrate.bind(repository);
      vi.spyOn(repository, "hydrate").mockImplementation(async (target) => {
        const result = await original(target);
        if (kind === "policy") await prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } });
        if (kind === "attachment") await RamPolicyRepository.getInstance().detachPolicy(policy.id, "role", roleId);
        if (kind === "qualification") await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        if (kind === "record")
          await prisma.iPBlackList.update({ where: { id: banId }, data: { reason: "changed fixture" } });
        if (kind === "address")
          await prisma.iPBlackList.update({
            where: { id: banId },
            data: { ipAddress: "2001:db8:" + randomUUID().slice(0, 4) + "::2" },
          });
        if (kind === "session") await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { status: 0 } });
        return result;
      });
      await expect(service.read(banId, request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("supports AccessKey and denies OAuth, account spoofing and impersonation", async () => {
    const req = request(false);
    req.authContext!.subjectType = "access_key";
    expect((await service.read(banId, req)).id).toBe(banId);
    req.oauthAccessToken = {} as never;
    await expect(service.read(banId, req)).rejects.toMatchObject({ statusCode: 403 });
    const forged = request();
    forged.authContext!.accountOwnerId = "other";
    await expect(service.read(banId, forged)).rejects.toMatchObject({ statusCode: 403 });
    const impersonated = request(false);
    impersonated.authContext!.principalUserId = owner;
    await expect(service.read(banId, impersonated)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)(
    "provides one real detail lookup under the legacy effective permission in %s",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const hydrate = vi.spyOn(repository, "hydrate");
      expect((await new IPBlacklistController().getIPBlacklistById(banId, request(false))).id).toBe(banId);
      expect(hydrate).toHaveBeenCalledTimes(1);
    },
  );
});
