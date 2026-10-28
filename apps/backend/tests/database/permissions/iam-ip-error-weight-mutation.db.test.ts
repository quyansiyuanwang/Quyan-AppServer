import { RedisService } from "@/services/infrastructure/redis.service";
import { PlatformIpErrorWeightMutationRepository } from "@/store/security/platform-ip-error-weight-mutation.repository";
import { IPBlacklistController } from "@/api/controllers/v1/system/ipblacklist.controller";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PlatformIpErrorWeightMutationIamService } from "@/services/system/platform-ip-error-weight-mutation-iam.service";
import { platformIpAddressArn } from "@/iam/resources/platform-ip-address-resources";
import type { TypedRequest } from "@/types/express";
const service = PlatformIpErrorWeightMutationIamService.getInstance(),
  mode = env.security.iamAuthorizationMode,
  action = "quyan:system:ip_blacklist:SetIPAddressErrorWeight";
let owner: string, actor: string, groupId: string, roleId: string, sessionId: string, ip: string;
const redis = RedisService.getInstance(),
  repository = PlatformIpErrorWeightMutationRepository.getInstance(),
  errorAction = "quyan:system:ip_blacklist:ResetIPAddressErrorWeight";
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "ip-weight-" + randomUUID(),
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
    name: "ip-weight-policy-" + randomUUID(),
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
      data: { username: "ip-weight-global-" + randomUUID(), permissions: [Permission.IP_BLACKLIST_UPDATE] },
    })
  ).id;
  actor = await user(owner, groupId);
  roleId = (await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "ip-weight-role-" + randomUUID() } }))
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
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});

const keys = () => [
  RedisService.getIpErrorWeightKey(ip),
  RedisService.getIpErrorWeightTsKey(ip),
  RedisService.getIpErrorKey(ip),
  RedisService.getIpErrorBreakdownKey(ip),
];
const values = () => Promise.all(keys().map((key) => redis.get(key)));
const seed = async () => {
  for (const [index, key] of keys().entries()) await redis.setWithResult(key, String(index + 11));
};
describe("IP error weight mutations with isolated Redis and transactional admission", () => {
  it("sets the exact IP through the Controller while preserving breakdown and hour count", async () => {
    await grant();
    await seed();
    expect(await new IPBlacklistController().setIpErrorWeight(ip, { weight: 7 }, request())).toEqual({ success: true });
    const result = await values();
    expect(result[0]).toBe("7");
    expect(Number(result[1])).toBeGreaterThan(0);
    expect(result.slice(2)).toEqual(["13", "14"]);
  });
  it("setting zero preserves error detail while reset deletes all four keys", async () => {
    await grant();
    await grant(platformIpAddressArn(ip), "Allow", errorAction);
    await seed();
    await service.set(ip, 0, request());
    expect(await values()).toEqual([null, null, "13", "14"]);
    await service.reset(ip, request());
    expect(await values()).toEqual([null, null, null, null]);
  });
  it("resets exactly one authorized IP", async () => {
    await grant(platformIpAddressArn(ip), "Allow", errorAction);
    await seed();
    const other = "192.0.2.33";
    await redis.setWithResult(RedisService.getIpErrorWeightKey(other), "17");
    expect(await new IPBlacklistController().resetIpErrorWeight(ip, request())).toEqual({ success: true });
    expect(await values()).toEqual([null, null, null, null]);
    expect(await redis.get(RedisService.getIpErrorWeightKey(other))).toBe("17");
  });
  it.each(["quyan:system:ip_blacklist:ResetIPAddressErrorWeight", "quyan:system:ip_blacklist:GetIPAddressErrorStatus"])(
    "does not substitute grant %s for Set",
    async (other) => {
      await grant(platformIpAddressArn(ip), "Allow", other);
      await seed();
      await expect(service.set(ip, 7, request())).rejects.toMatchObject({ statusCode: 403 });
      expect(await values()).toEqual(["11", "12", "13", "14"]);
    },
  );
  it("does not allow Set on another IP", async () => {
    await grant(platformIpAddressArn("192.0.2.1"));
    await seed();
    await expect(service.set(ip, 7, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await values()).toEqual(["11", "12", "13", "14"]);
  });
  it("explicit Deny prevents the Redis effect", async () => {
    await grant("*");
    await grant(platformIpAddressArn(ip), "Deny");
    await seed();
    await expect(service.set(ip, 7, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await values()).toEqual(["11", "12", "13", "14"]);
  });
  it.each(["private-group", "additions", "read-group"])(
    "cannot acquire platform write qualification through %s",
    async (kind) => {
      await grant("*");
      await seed();
      if (kind === "private-group")
        await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      if (kind === "additions") {
        await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.IP_BLACKLIST_UPDATE] } });
      }
      if (kind === "read-group")
        await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.IP_BLACKLIST_READ] } });
      await expect(service.set(ip, 7, request())).rejects.toMatchObject({ statusCode: 403 });
      expect(await values()).toEqual(["11", "12", "13", "14"]);
    },
  );
  it.each(["policy", "attachment", "group", "session", "role", "principal"])(
    "rejects %s revocation between preparation and admission without writing",
    async (kind) => {
      const policy = await grant();
      await seed();
      const original = repository.admit.bind(repository);
      vi.spyOn(repository, "admit").mockImplementation(async (guard, effect) => {
        if (kind === "policy") await prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } });
        if (kind === "attachment") await RamPolicyRepository.getInstance().detachPolicy(policy.id, "role", roleId);
        if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        if (kind === "session") await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { status: 0 } });
        if (kind === "role") await prisma.ramRole.update({ where: { id: roleId }, data: { status: 0 } });
        if (kind === "principal") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
        return original(guard, effect);
      });
      await expect(service.set(ip, 7, request())).rejects.toMatchObject({ statusCode: 403 });
      expect(await values()).toEqual(["11", "12", "13", "14"]);
    },
  );
  it("refuses an unconfirmed Redis write and never retries the effect", async () => {
    await grant();
    const write = vi.spyOn(redis, "writeIpErrorWeightWithResult").mockResolvedValue(null);
    await expect(service.set(ip, 7, request())).rejects.toMatchObject({
      statusCode: 500,
      messageKey: "ipBlacklist.weightMutationUnavailable",
    });
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("does not claim a rollback when Redis wrote but confirmation was lost", async () => {
    await grant();
    const original = redis.writeIpErrorWeightWithResult.bind(redis);
    vi.spyOn(redis, "writeIpErrorWeightWithResult").mockImplementation(async (address, input) => {
      await original(address, input);
      return null;
    });
    await expect(service.set(ip, 7, request())).rejects.toMatchObject({ statusCode: 500 });
    expect((await values())[0]).toBe("7");
  });
  it.each(["group", "policy"])("holds %s eligibility until the admitted effect finishes", async (kind) => {
    const policy = await grant(),
      original = redis.writeIpErrorWeightWithResult.bind(redis);
    let competing: Promise<unknown> | undefined,
      settled = false;
    vi.spyOn(redis, "writeIpErrorWeightWithResult").mockImplementation(async (address, input) => {
      competing = (
        kind === "group"
          ? prisma.group.update({ where: { id: groupId }, data: { permissions: [] } })
          : prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } })
      ).then(() => {
        settled = true;
      });
      // Competing revocation may start, but must wait for the admission transaction's locks.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(settled).toBe(false);
      return original(address, input);
    });
    try {
      await service.set(ip, 7, request());
    } finally {
      await competing;
    }
    expect(settled).toBe(true);
    expect((await values())[0]).toBe("7");
    await expect(service.set(ip, 8, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await values())[0]).toBe("7");
  });
  it("supports AccessKey through the same qualified principal path", async () => {
    const req = request(false);
    req.authContext!.subjectType = "access_key";
    await service.set(ip, 3, req);
    expect((await values())[0]).toBe("3");
  });
  it.each(["legacy", "shadow"] as const)("preserves original write behavior in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const write = vi.spyOn(redis, "writeIpErrorWeightWithResult");
    await service.set(ip, 3, request(false));
    expect((await values())[0]).toBe("3");
    await service.reset(ip, request(false));
    expect(await values()).toEqual([null, null, null, null]);
    expect(write).not.toHaveBeenCalled();
  });
});
