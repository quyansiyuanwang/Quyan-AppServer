import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RedisService } from "@/services/infrastructure/redis.service";
import { RemoteTerminalSessionReadIamService } from "@/services/remote-terminal/remote-terminal-session-read-iam.service";
import { RemoteTerminalSessionGateway } from "@/modules/remote-terminal/gateway/session-gateway";
import { RemoteTerminalDeviceRegistry } from "@/modules/remote-terminal/gateway/device-registry";
import { RemoteTerminalUsageRepository } from "@/store/remote-terminal-product/remote-terminal-usage.repository";
import { remoteTerminalSessionArn } from "@/iam/resources/remote-terminal-resources";
import { terminalSessionRedisKey } from "@/services/infrastructure/remote-terminal-session-projection";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, other: string;
const mode = env.security.iamAuthorizationMode,
  redis = RedisService.getInstance(),
  keys: string[] = [],
  gateway = new RemoteTerminalSessionGateway(new RemoteTerminalDeviceRegistry()),
  service = new RemoteTerminalSessionReadIamService(gateway),
  groups = RamResourceGroupRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "session-read-" + randomUUID(),
        password: "fixture-only",
        userType: accountOwnerId ? "ram_user" : "root",
        accountOwnerId,
        parentUserId: accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*" },
    secure: true,
    ip: "192.0.2.10",
  }) as unknown as TypedRequest;
const arn = (id: string, userId = actor) => remoteTerminalSessionArn(owner, userId, id);
async function session(ownerUserId = actor, status = "pending") {
  const row = {
    sessionId: randomUUID(),
    ownerUserId,
    entitlementId: "fixture-entitlement",
    deviceId: "fixture-device",
    mode: "shell",
    shellType: "bash",
    status,
    createdAt: "2026-10-14T00:00:00.000Z",
    workingDirectory: "PRIVATE-SESSION-DIRECTORY",
  };
  const key = terminalSessionRedisKey(row.sessionId);
  keys.push(key);
  expect(await redis.set(key, JSON.stringify(row), 60)).not.toBeNull();
  return row;
}
async function policy(Statement: unknown, scopeType = "account", scopeResourceId?: string) {
  const parsed = parseIamPolicy({ Version: "1", Statement });
  const created = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "session-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  return prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: created.id,
      scopeType,
      scopeResourceId,
      scopeKey: scopeType === "account" ? "account" : scopeType + ":" + scopeResourceId,
      createdBy: owner,
    },
  });
}
async function entitlement(userId = actor) {
  const ent = await prisma.remoteTerminalUserEntitlement.create({
    data: {
      userId,
      name: "Fixture",
      startAt: new Date(Date.now() - 60_000),
      endAt: new Date(Date.now() + 3_600_000),
      deviceLimit: 4,
      terminalLimit: 5,
    },
  });
  const token = await prisma.remoteTerminalEntitlementToken.create({
    data: { entitlementId: ent.id, token: randomUUID() },
  });
  await prisma.remoteTerminalDeviceBinding.create({
    data: {
      userId,
      entitlementId: ent.id,
      registrationTokenId: token.id,
      deviceId: randomUUID(),
      fingerprint: randomUUID(),
      hostname: "fixture-host",
      platform: "linux",
      arch: "x64",
      heartbeatToken: randomUUID(),
      snapshot: { privateFixture: "PRIVATE-SNAPSHOT" },
      registeredAt: new Date(),
      lastSeenAt: new Date(),
      online: false,
    },
  });
  return ent;
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  other = await user(owner);
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  if (keys.length) await redis.deleteMany(keys.splice(0));
});
describe("terminal session resource authorization and full usage", () => {
  it("returns only an admitted owned session and never its working directory", async () => {
    const own = await session();
    await session();
    await session(other);
    await policy({ Effect: "Allow", Action: "quyan:remote_terminal:ListSessions", Resource: arn(own.sessionId) });
    const items = await service.list(actor, request(), vi.fn());
    expect(items).toHaveLength(1);
    expect(items[0].sessionId).toBe(own.sessionId);
    expect(JSON.stringify(items)).not.toContain("PRIVATE");
  });
  it("lets explicit Deny override an account-wide Allow", async () => {
    const own = await session();
    await policy([
      { Effect: "Allow", Action: "quyan:remote_terminal:ListSessions", Resource: "*" },
      { Effect: "Deny", Action: "quyan:remote_terminal:ListSessions", Resource: arn(own.sessionId) },
    ]);
    expect(await service.list(actor, request(), vi.fn())).toEqual([]);
  });
  it("does not honor client Action spoofing or a grant to another owner", async () => {
    await session();
    const foreign = await session(other);
    await policy({
      Effect: "Allow",
      Action: "quyan:remote_terminal:ListSessions",
      Resource: arn(foreign.sessionId, other),
    });
    expect(await service.list(actor, request(), vi.fn())).toEqual([]);
  });
  it("enforces SourceIp conditions on each owned session", async () => {
    const own = await session();
    await policy({
      Effect: "Allow",
      Action: "quyan:remote_terminal:ListSessions",
      Resource: arn(own.sessionId),
      Condition: { IpAddress: { "acs:SourceIp": "198.51.100.0/24" } },
    });
    expect(await service.list(actor, request(), vi.fn())).toEqual([]);
  });
  it("rejects a source changed between metadata and hydration", async () => {
    const own = await session();
    await policy({ Effect: "Allow", Action: "quyan:remote_terminal:ListSessions", Resource: arn(own.sessionId) });
    const hydrate = gateway.hydrateSessionSummaries.bind(gateway);
    vi.spyOn(gateway, "hydrateSessionSummaries").mockImplementationOnce(async (userId, targets) => {
      await redis.set(
        terminalSessionRedisKey(own.sessionId),
        JSON.stringify({ ...own, deviceId: "changed-device" }),
        60,
      );
      return hydrate(userId, targets);
    });
    await expect(service.list(actor, request(), vi.fn())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects policy revocation during source hydration", async () => {
    const own = await session(),
      authorization = await policy({
        Effect: "Allow",
        Action: "quyan:remote_terminal:ListSessions",
        Resource: arn(own.sessionId),
      });
    const hydrate = gateway.hydrateSessionSummaries.bind(gateway);
    vi.spyOn(gateway, "hydrateSessionSummaries").mockImplementationOnce(async (userId, targets) => {
      const result = await hydrate(userId, targets);
      await prisma.ramAuthorization.update({ where: { id: authorization.id }, data: { status: 0 } });
      return result;
    });
    await expect(service.list(actor, request(), vi.fn())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects disabled principals even for an empty collection", async () => {
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    await expect(service.list(actor, request(), vi.fn())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires a separate user resource grant for quota, and includes every owned active session", async () => {
    await entitlement();
    await entitlement(other);
    await session();
    await session(actor, "connected");
    await session(actor, "closed");
    await session(other);
    await policy({
      Effect: "Allow",
      Action: "quyan:remote_terminal:GetUsageSummary",
      Resource: "acs:quyan:*:" + owner + ":user/" + actor,
    });
    expect(await service.list(actor, request(), vi.fn())).toEqual([]);
    expect(await service.getUsage(actor, request(), vi.fn())).toMatchObject({
      activeSessionCount: 2,
      activeDeviceCount: 1,
      totalTerminalLimit: 5,
      totalDeviceLimit: 4,
      remainingTerminalCount: 3,
      remainingDeviceCount: 3,
    });
  });
  it("does not infer quota authorization from a session grant", async () => {
    const own = await session();
    await policy({ Effect: "Allow", Action: "quyan:remote_terminal:ListSessions", Resource: arn(own.sessionId) });
    await expect(service.getUsage(actor, request(), vi.fn())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("excludes expired entitlement quotas and bindings without loading credentials", async () => {
    const ent = await entitlement();
    await prisma.remoteTerminalUserEntitlement.update({
      where: { id: ent.id },
      data: { endAt: new Date(Date.now() - 1_000) },
    });
    expect(await RemoteTerminalUsageRepository.getInstance().totals(getIamPrincipal(request())!)).toEqual({
      activeDeviceCount: 0,
      totalDeviceLimit: 0,
      totalTerminalLimit: 0,
    });
  });
  it("verifies session resource-group membership using exact account and parent IDs", async () => {
    const own = await session();
    expect(await groups.resourceExistsInAccount(arn(own.sessionId), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(arn(own.sessionId.toUpperCase()), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(arn(own.sessionId, other), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(arn(own.sessionId), other)).toBe(false);
  });
  it("applies resource-group scope and member removal without a stale allow", async () => {
    const own = await session(),
      hidden = await session();
    const group = await groups.create({
      accountOwnerId: owner,
      name: "session-scope-" + randomUUID(),
    });
    const member = await prisma.ramResourceGroupMember.create({
      data: {
        accountOwnerId: owner,
        resourceGroupId: group.id,
        resourceArn: arn(own.sessionId),
        service: "remote-terminal",
        resourceType: "session",
        resourceId: actor + "/" + own.sessionId,
      },
    });
    await policy(
      { Effect: "Allow", Action: "quyan:remote_terminal:ListSessions", Resource: "*" },
      "resource-group",
      group.id,
    );
    expect((await service.list(actor, request(), vi.fn())).map((row) => row.sessionId)).toEqual([own.sessionId]);
    expect(hidden.sessionId).not.toBe(own.sessionId);
    await prisma.ramResourceGroupMember.update({ where: { id: member.id }, data: { status: 0 } });
    expect(await service.list(actor, request(), vi.fn())).toEqual([]);
  });
});
