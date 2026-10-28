import { RECORD_STATUS } from "@/constant/status";
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
  action = "quyan:system:ip_blacklist:UpdateBlacklist";
let owner: string, actor: string, groupId: string, roleId: string, sessionId: string, ip: string;
const repository = PlatformIpBlacklistMutationRepository.getInstance(),
  errorAction = "quyan:system:ip_blacklist:ResetIPAddressErrorWeight";
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "ip-ban-update-" + randomUUID(),
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
    name: "ip-ban-update-policy-" + randomUUID(),
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
      data: { username: "ip-ban-update-global-" + randomUUID(), permissions: [Permission.IP_BLACKLIST_UPDATE] },
    })
  ).id;
  actor = await user(owner, groupId);
  roleId = (
    await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "ip-ban-update-role-" + randomUUID() } })
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

let banId: string;
beforeEach(async () => {
  banId = (
    await prisma.iPBlackList.create({
      data: {
        ipAddress: ip,
        reason: "original",
        banType: "auto",
        banLevel: 2,
        bannedBy: owner,
        ExpireTime: new Date("2025-01-01T00:00:00Z"),
      },
    })
  ).id;
});
const record = () => prisma.iPBlackList.findUniqueOrThrow({ where: { id: banId } });
describe("blacklist updates require resource grants and transactional admission", () => {
  it("updates an authorized expired history record through the Controller", async () => {
    await grant();
    const req = request();
    const result = await new IPBlacklistController().updateIPBlacklist(
      ip,
      { banReason: "updated", expireTime: "2027-01-01T00:00:00Z" },
      req,
    );
    expect(result).toMatchObject({
      id: banId,
      ipAddress: ip,
      banReason: "updated",
      expireTime: "2027-01-01T00:00:00.000Z",
      banLevel: 2,
      bannedBy: owner,
      status: 1,
    });
    expect(await record()).toMatchObject({ reason: "updated", banType: "auto", banLevel: 2, bannedBy: owner });
    expect(
      req.iamDecisions!.every((value) => value.action === action && value.resource === platformIpAddressArn(ip)),
    ).toBe(true);
  });
  it.each(["deny", "other-ip", "reset-only", "missing-allow"])("does not change a record for %s", async (kind) => {
    if (kind === "deny") {
      await grant("*");
      await grant(platformIpAddressArn(ip), "Deny");
    }
    if (kind === "other-ip") await grant(platformIpAddressArn("192.0.2.1"));
    if (kind === "reset-only") await grant(platformIpAddressArn(ip), "Allow", errorAction);
    await expect(service.update(ip, { banReason: "changed" }, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await record()).reason).toBe("original");
  });
  it.each(["deleted", "missing"])("refuses %s records even with wildcard Allow", async (kind) => {
    await grant("*");
    if (kind === "deleted")
      await prisma.iPBlackList.update({ where: { id: banId }, data: { status: RECORD_STATUS.DELETED } });
    await expect(
      service.update(kind === "missing" ? "192.0.2.254" : ip, { banReason: "changed" }, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await record()).reason).toBe("original");
  });
  it.each(["private-group", "additions", "read-only"])(
    "does not acquire platform eligibility through %s",
    async (kind) => {
      await grant("*");
      if (kind === "private-group")
        await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      if (kind === "additions") {
        await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.IP_BLACKLIST_UPDATE] } });
      }
      if (kind === "read-only")
        await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.IP_BLACKLIST_READ] } });
      await expect(service.update(ip, { banReason: "changed" }, request())).rejects.toMatchObject({ statusCode: 403 });
      expect((await record()).reason).toBe("original");
    },
  );
  it.each(["policy", "attachment", "group", "session", "role", "principal", "record"])(
    "refuses stale %s without an update",
    async (kind) => {
      const policy = await grant(),
        original = repository.update.bind(repository);
      vi.spyOn(repository, "update").mockImplementation(async (target, input, guard) => {
        if (kind === "policy") await prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } });
        if (kind === "attachment") await RamPolicyRepository.getInstance().detachPolicy(policy.id, "role", roleId);
        if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        if (kind === "session") await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { status: 0 } });
        if (kind === "role") await prisma.ramRole.update({ where: { id: roleId }, data: { status: 0 } });
        if (kind === "principal") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
        if (kind === "record")
          await prisma.iPBlackList.update({ where: { id: banId }, data: { reason: "concurrent edit" } });
        return original(target, input, guard);
      });
      await expect(service.update(ip, { banReason: "unauthorized edit" }, request())).rejects.toMatchObject({
        statusCode: 403,
      });
      expect((await record()).reason).toBe(kind === "record" ? "concurrent edit" : "original");
    },
  );
  it("rolls back if the final authorization recheck fails", async () => {
    await grant();
    const original = repository.update.bind(repository);
    vi.spyOn(repository, "update").mockImplementation((target, input, guard) =>
      original(target, input, {
        ...guard,
        users: {
          ...guard.users,
          recheck: async () => {
            throw new Error("fixture admission failure");
          },
        },
      }),
    );
    await expect(service.update(ip, { banReason: "changed" }, request())).rejects.toThrow("fixture admission failure");
    expect((await record()).reason).toBe("original");
  });
  it("supports qualified AccessKey identity", async () => {
    const req = request(false);
    req.authContext!.subjectType = "access_key";
    await service.update(ip, { banReason: "accesskey fixture" }, req);
    expect((await record()).reason).toBe("accesskey fixture");
  });
  it.each(["legacy", "shadow"] as const)("retains old update and missing 404 in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const native = vi.spyOn(repository, "update");
    await service.update(ip, { banReason: "legacy fixture" }, request(false));
    expect((await record()).reason).toBe("legacy fixture");
    expect(native).not.toHaveBeenCalled();
    await expect(service.update("192.0.2.254", {}, request(false))).rejects.toMatchObject({ statusCode: 404 });
  });
});
