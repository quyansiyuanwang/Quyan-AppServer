import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RemoteTerminalSessionAuthorityRepository } from "@/store/remote-terminal-product/remote-terminal-session-authority.repository";
import { RemoteTerminalSessionAuthorityService } from "@/services/remote-terminal/remote-terminal-session-authority.service";
import { RedisService } from "@/services/infrastructure/redis.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { remoteTerminalSessionArn } from "@/iam/resources/remote-terminal-resources";
import { terminalSessionRedisKey } from "@/services/infrastructure/remote-terminal-session-projection";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, actorUpdatedAt: string;
const mode = env.security.iamAuthorizationMode,
  store = RemoteTerminalSessionAuthorityRepository.getInstance(),
  service = RemoteTerminalSessionAuthorityService.getInstance(),
  redis = RedisService.getInstance(),
  keys: string[] = [];
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "socket-authority-" + randomUUID(),
        password: "fixture-password-only",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram_user" : "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = (accessKeyId?: string) => {
  const result = {
    user: { userId: actor, updatedAt: actorUpdatedAt },
    authContext: {
      principalUserId: actor,
      accountOwnerId: owner,
      subjectType: accessKeyId ? "access_key" : "sub_user",
    },
    headers: { authorization: "fixture-private" },
    secure: true,
    ip: "192.0.2.10",
  } as unknown as TypedRequest;
  if (accessKeyId)
    Object.defineProperty(result, "accessKey", { value: { id: accessKeyId, key: "PRIVATE-CREDENTIAL-FIXTURE" } });
  return result;
};
async function device() {
  const entitlement = await prisma.remoteTerminalUserEntitlement.create({
    data: {
      userId: actor,
      name: "Fixture",
      startAt: new Date(Date.now() - 60_000),
      endAt: new Date(Date.now() + 3_600_000),
      deviceLimit: 3,
      terminalLimit: 3,
    },
  });
  const registration = await prisma.remoteTerminalEntitlementToken.create({
    data: { entitlementId: entitlement.id, token: randomUUID() },
  });
  return prisma.remoteTerminalDeviceBinding.create({
    data: {
      userId: actor,
      entitlementId: entitlement.id,
      registrationTokenId: registration.id,
      deviceId: randomUUID(),
      fingerprint: randomUUID(),
      hostname: "fixture-host",
      platform: "linux",
      arch: "x64",
      heartbeatToken: "PRIVATE-HEARTBEAT-" + randomUUID(),
      snapshot: { privateFixture: "PRIVATE-DEVICE-SNAPSHOT" },
      registeredAt: new Date(),
      lastSeenAt: new Date(),
      online: true,
    },
  });
}
async function key() {
  return prisma.accessKey.create({
    data: { userId: actor, key: "PRIVATE-CREDENTIAL-" + randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) },
  });
}
async function session(deviceId: string, entitlementId: string) {
  const source = {
    sessionId: randomUUID(),
    ownerUserId: actor,
    entitlementId,
    deviceId,
    status: "pending",
    mode: "shell",
    shellType: "bash",
    createdAt: "2026-10-14T00:00:00.000Z",
    workingDirectory: "PRIVATE-WORKING-DIRECTORY",
  };
  const sessionKey = terminalSessionRedisKey(source.sessionId);
  keys.push(sessionKey);
  expect(await redis.setWithResult(sessionKey, JSON.stringify(source), 60)).toBe(true);
  return source;
}
async function policy(sessionId: string, Effect = "Allow", Condition?: unknown) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: {
      Effect,
      Action: "quyan:remote_terminal:ConnectSession",
      Resource: remoteTerminalSessionArn(owner, actor, sessionId),
      ...(Condition ? { Condition } : {}),
    },
  });
  const created = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "socket-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  return prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: created.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  actorUpdatedAt = (
    await prisma.user.findUniqueOrThrow({ where: { id: actor }, select: { updateTime: true } })
  ).updateTime.toISOString();
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  if (keys.length) await redis.deleteMany(keys.splice(0));
});
describe("persisted terminal session authority", () => {
  it("returns only safe source revisions and identifiers", async () => {
    const target = await device(),
      credential = await key(),
      req = request(credential.id);
    const authority = await store.capture(getIamPrincipal(req)!, target.deviceId, credential.id);
    expect(JSON.stringify(authority)).not.toContain("PRIVATE");
    expect(authority.accessKeyId).toBe(credential.id);
    expect(authority.keyRevision).toMatch(/^[a-f0-9]{64}$/);
  });
  it("does not expire authority on ordinary device heartbeats", async () => {
    const target = await device(),
      authority = await store.capture(getIamPrincipal(request())!, target.deviceId);
    await prisma.remoteTerminalDeviceBinding.update({
      where: { id: target.id },
      data: { lastSeenAt: new Date(), online: false, hostname: "updated-fixture" },
    });
    await expect(store.assertCurrent(authority)).resolves.toBeUndefined();
  });
  it("does not expire authority on AccessKey usage counters", async () => {
    const target = await device(),
      credential = await key(),
      authority = await store.capture(getIamPrincipal(request(credential.id))!, target.deviceId, credential.id);
    await prisma.accessKey.update({
      where: { id: credential.id },
      data: { lastUsedAt: new Date(), requestCount: { increment: 1 } },
    });
    await expect(store.assertCurrent(authority)).resolves.toBeUndefined();
  });
  it.each(["rotation", "disabled", "expiry", "reassignment"])(
    "revokes a connection after credential %s",
    async (change) => {
      const target = await device(),
        credential = await key(),
        authority = await store.capture(getIamPrincipal(request(credential.id))!, target.deviceId, credential.id);
      const data =
        change === "rotation"
          ? { key: randomUUID() }
          : change === "disabled"
            ? { status: 0 }
            : change === "expiry"
              ? { expiresAt: new Date(Date.now() - 1_000) }
              : { userId: owner };
      await prisma.accessKey.update({ where: { id: credential.id }, data });
      await expect(store.assertCurrent(authority)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("rejects a stale user authentication revision", async () => {
    const target = await device(),
      authority = await store.capture(getIamPrincipal(request())!, target.deviceId);
    await prisma.user.update({ where: { id: actor }, data: { password: "changed-fixture-only" } });
    await expect(store.assertCurrent(authority)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects expired device entitlement and unavailable account owner", async () => {
    const target = await device(),
      authority = await store.capture(getIamPrincipal(request())!, target.deviceId);
    await prisma.remoteTerminalUserEntitlement.update({
      where: { id: target.entitlementId },
      data: { endAt: new Date(Date.now() - 1_000) },
    });
    await expect(store.assertCurrent(authority)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(store.capture(getIamPrincipal(request())!, target.deviceId)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("evaluates fresh session policies for every guarded use", async () => {
    const target = await device(),
      source = await session(target.deviceId, target.entitlementId);
    await policy(source.sessionId);
    const binding = await service.prepare(actor, target.deviceId, request()),
      check = await binding.bindSession(source.sessionId);
    await expect(check({ "acs:SourceIp": "192.0.2.10", "acs:SecureTransport": true })).resolves.toBeUndefined();
    await policy(source.sessionId, "Deny");
    await expect(check({ "acs:SecureTransport": true })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("checks connection conditions separately from the initial HTTP request", async () => {
    const target = await device(),
      source = await session(target.deviceId, target.entitlementId);
    await policy(source.sessionId, "Allow", {
      IpAddress: { "acs:SourceIp": "192.0.2.0/24" },
      Bool: { "acs:SecureTransport": true },
    });
    const binding = await service.prepare(actor, target.deviceId, request()),
      check = await binding.bindSession(source.sessionId);
    await expect(check({ "acs:SourceIp": "192.0.2.10", "acs:SecureTransport": true })).resolves.toBeUndefined();
    await expect(check({ "acs:SourceIp": "198.51.100.10", "acs:SecureTransport": true })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(check({ "acs:SourceIp": "192.0.2.10", "acs:SecureTransport": false })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("revokes a bound session if its persisted owner, device or entitlement changes", async () => {
    const target = await device(),
      source = await session(target.deviceId, target.entitlementId);
    await policy(source.sessionId);
    const binding = await service.prepare(actor, target.deviceId, request()),
      check = await binding.bindSession(source.sessionId);
    await redis.setWithResult(
      terminalSessionRedisKey(source.sessionId),
      JSON.stringify({ ...source, entitlementId: "changed-entitlement" }),
      60,
    );
    await expect(check({})).rejects.toMatchObject({ statusCode: 403 });
  });
});
