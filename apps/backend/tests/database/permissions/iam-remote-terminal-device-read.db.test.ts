import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RemoteTerminalDeviceReadRepository } from "@/store/remote-terminal-product/remote-terminal-device-read.repository";
import { RemoteTerminalDeviceIamService } from "@/services/remote-terminal/remote-terminal-device-iam.service";
import { remoteTerminalDeviceArn } from "@/iam/resources/remote-terminal-resources";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, other: string, foreign: string;
const mode = env.security.iamAuthorizationMode,
  repository = RemoteTerminalDeviceReadRepository.getInstance(),
  service = RemoteTerminalDeviceIamService.getInstance(),
  groups = RamResourceGroupRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "terminal-read-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram_user" : "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*", "x-account-id": "foreign" },
    ip: "192.0.2.10",
    secure: true,
  }) as unknown as TypedRequest;
const principal = () => getIamPrincipal(request())!;
const device = async (userId = actor, entitlementUserId = userId) => {
  const entitlement = await prisma.remoteTerminalUserEntitlement.create({
    data: {
      userId: entitlementUserId,
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
      userId,
      entitlementId: entitlement.id,
      registrationTokenId: registration.id,
      deviceId: randomUUID(),
      fingerprint: randomUUID(),
      hostname: "fixture-host",
      platform: "linux",
      arch: "x64",
      snapshot: { hostname: "fixture-host", privateFixture: "not-public", diagnostics: { availableShells: ["bash"] } },
      heartbeatToken: randomUUID(),
      registeredAt: new Date(),
      lastSeenAt: new Date(),
      online: true,
    },
  });
};
async function policy(Statement: unknown, scopeType = "account", scopeResourceId?: string) {
  const parsed = parseIamPolicy({ Version: "1", Statement });
  const created = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "terminal-policy-" + randomUUID(),
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
const arn = (deviceId: string, userId = actor) => remoteTerminalDeviceArn(owner, userId, deviceId);
const allow = async (deviceId: string, Action = "quyan:remote_terminal:ListDevices") =>
  policy({ Effect: "Allow", Action, Resource: arn(deviceId) });
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  other = await user(owner);
  foreign = await user();
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
});
describe("terminal metadata and summary repository", () => {
  it("isolates metadata by subject and persisted account before hydration", async () => {
    const own = await device();
    await device(other);
    await device(foreign);
    const rows = await repository.scan(principal());
    expect(rows.map((row) => row.deviceId)).toEqual([own.deviceId]);
    expect(Object.keys(rows[0]).sort()).toEqual(["controlRevision", "deviceId", "id", "summaryRevision", "userId"]);
    const hydrated = await repository.hydrate(principal(), rows);
    expect(hydrated).toEqual([
      expect.objectContaining({ deviceId: own.deviceId, availableShells: ["bash"], online: true }),
    ]);
    expect(hydrated[0]).not.toHaveProperty("heartbeatToken");
    expect(hydrated[0]).not.toHaveProperty("snapshot");
    expect(hydrated[0]).not.toHaveProperty("registrationToken");
    expect(await repository.targets(principal(), [randomUUID()])).toEqual([]);
  });
  it("rejects forged account and disabled subject before source reads", async () => {
    await device();
    await expect(repository.scan({ ...principal(), accountOwnerId: foreign })).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    await expect(repository.scan(principal())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a disabled account owner even when the child is still active", async () => {
    await device();
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(repository.scan(principal())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["device-disabled", "device-deleted", "entitlement-disabled", "future", "expired"] as const)(
    "excludes %s from metadata and resource-group membership",
    async (kind) => {
      const row = await device();
      if (kind === "device-disabled" || kind === "device-deleted")
        await prisma.remoteTerminalDeviceBinding.update({
          where: { id: row.id },
          data: { status: kind === "device-disabled" ? 0 : -1 },
        });
      else
        await prisma.remoteTerminalUserEntitlement.update({
          where: { id: row.entitlementId },
          data:
            kind === "entitlement-disabled"
              ? { status: 0 }
              : kind === "future"
                ? { startAt: new Date(Date.now() + 3_600_000) }
                : { endAt: new Date(Date.now() - 60_000) },
        });
      expect(await repository.scan(principal())).toEqual([]);
      expect(await groups.resourceExistsInAccount(arn(row.deviceId), owner)).toBe(false);
    },
  );
  it("rejects inconsistent entitlement ownership even within one account", async () => {
    const row = await device(actor, other);
    expect(await repository.scan(principal())).toEqual([]);
    expect(await groups.resourceExistsInAccount(arn(row.deviceId), owner)).toBe(false);
  });
  it("rejects entitlement parent case aliases", async () => {
    const row = await device();
    await prisma.$executeRaw`UPDATE remote_terminal_user_entitlements SET userId=${actor.toUpperCase()} WHERE id=${row.entitlementId}`;
    expect(await repository.scan(principal())).toEqual([]);
    expect(await groups.resourceExistsInAccount(arn(row.deviceId), owner)).toBe(false);
  });
  it("uses exact device and parent identifiers despite MySQL collation", async () => {
    const row = await device();
    await expect(repository.targets(principal(), [row.deviceId.toUpperCase()])).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await groups.resourceExistsInAccount(arn(row.deviceId.toUpperCase()), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(arn(row.deviceId, other), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(remoteTerminalDeviceArn(foreign, actor, row.deviceId), foreign)).toBe(
      false,
    );
  });
  it("returns bounded keyset metadata after a validated cursor", async () => {
    await device();
    await device();
    const rows = await repository.scan(principal());
    expect(rows).toHaveLength(2);
    expect(await repository.scan(principal(), rows[0].id)).toEqual([rows[1]]);
    await expect(repository.scan(principal(), "bad/id")).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["hostname", "shells", "entitlement"] as const)(
    "detects raw %s changes preserving updateTime",
    async (kind) => {
      const row = await device(),
        expected = await repository.scan(principal());
      if (kind === "hostname")
        await prisma.$executeRaw`UPDATE remote_terminal_device_bindings SET hostname='changed-fixture' WHERE id=${row.id}`;
      else if (kind === "shells")
        await prisma.$executeRaw`UPDATE remote_terminal_device_bindings SET snapshot=JSON_SET(snapshot,'$.diagnostics.availableShells',JSON_ARRAY('sh')) WHERE id=${row.id}`;
      else
        await prisma.$executeRaw`UPDATE remote_terminal_user_entitlements SET endAt=DATE_ADD(endAt,INTERVAL 1 DAY) WHERE id=${row.entitlementId}`;
      expect(
        (await prisma.remoteTerminalDeviceBinding.findUniqueOrThrow({ where: { id: row.id } })).updateTime,
      ).toEqual(row.updateTime);
      await expect(repository.hydrate(principal(), expected)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("rejects stale ownership and invalid hydration batches", async () => {
    const row = await device(),
      expected = await repository.scan(principal());
    await prisma.remoteTerminalDeviceBinding.update({ where: { id: row.id }, data: { userId: other } });
    await expect(repository.hydrate(principal(), expected)).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.targets(principal(), [row.deviceId, row.deviceId])).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
describe("terminal device policy integration", () => {
  it("applies per-device explicit Deny before reading public summaries", async () => {
    const a = await device(),
      b = await device();
    await policy([
      {
        Effect: "Allow",
        Action: "quyan:remote_terminal:ListDevices",
        Resource: "acs:remote-terminal:*:" + owner + ":device/" + actor + "/*",
      },
      { Effect: "Deny", Action: "quyan:remote_terminal:ListDevices", Resource: arn(b.deviceId) },
    ]);
    const hydrate = vi.spyOn(repository, "hydrate");
    expect(
      (
        await service.list(actor, request(), async () => {
          throw new Error("unexpected legacy");
        })
      ).map((row) => row.deviceId),
    ).toEqual([a.deviceId]);
    expect(hydrate).toHaveBeenCalledWith(principal(), [expect.objectContaining({ deviceId: a.deviceId })]);
  });
  it("does not turn device grants into visibility of another user devices", async () => {
    await device();
    await device(other);
    await policy({
      Effect: "Allow",
      Action: "quyan:remote_terminal:ListDevices",
      Resource: "acs:remote-terminal:*:" + owner + ":device/" + other + "/*",
    });
    expect(await service.list(actor, request(), async () => [])).toEqual([]);
  });
  it("returns no summaries when the only authorization is revoked", async () => {
    const row = await device(),
      binding = await allow(row.deviceId);
    expect(await service.list(actor, request(), async () => [])).toHaveLength(1);
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    expect(await service.list(actor, request(), async () => [])).toEqual([]);
  });
  it("authorizes only current resource-group members", async () => {
    const a = await device();
    await device();
    const group = await groups.create({ accountOwnerId: owner, name: "terminal-group-" + randomUUID() });
    const member = await groups.addMember({
      accountOwnerId: owner,
      resourceGroupId: group.id,
      resourceArn: arn(a.deviceId),
      service: "remote-terminal",
      resourceType: "device",
      resourceId: actor + "/" + a.deviceId,
    });
    await policy(
      { Effect: "Allow", Action: "quyan:remote_terminal:ListDevices", Resource: "*" },
      "resource-group",
      group.id,
    );
    expect((await service.list(actor, request(), async () => [])).map((row) => row.deviceId)).toEqual([a.deviceId]);
    await prisma.ramResourceGroupMember.update({ where: { id: member.id }, data: { status: -1 } });
    expect(await service.list(actor, request(), async () => [])).toEqual([]);
  });
  it("checks trusted request Conditions independently of client claims", async () => {
    const row = await device();
    await policy({
      Effect: "Allow",
      Action: "quyan:remote_terminal:ListDevices",
      Resource: arn(row.deviceId),
      Condition: { IpAddress: { "acs:SourceIp": "192.0.2.0/24" } },
    });
    expect(await service.list(actor, request(), async () => [])).toHaveLength(1);
    const req = request();
    Object.defineProperty(req, "ip", { value: "198.51.100.10" });
    expect(await service.list(actor, req, async () => [])).toEqual([]);
  });
  it("drops directory results when authorization is revoked during the RPC", async () => {
    const row = await device(),
      binding = await allow(row.deviceId, "quyan:remote_terminal:BrowseDirectories");
    let calls = 0;
    await expect(
      service.withDevice(actor, row.deviceId, "quyan:remote_terminal:BrowseDirectories", request(), async (guard) => {
        await guard?.();
        calls++;
        await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
        return { path: "/fixture-private" };
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(calls).toBe(1);
  });
  it("does not start preference RPCs without a matching Allow", async () => {
    const row = await device(),
      read = vi.fn();
    await expect(
      service.withDevice(actor, row.deviceId, "quyan:remote_terminal:GetAgentPreferences", request(), read),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("detects entitlement expiry before dispatch and exposes no RPC result", async () => {
    const row = await device();
    await allow(row.deviceId, "quyan:remote_terminal:GetAgentPreferences");
    await expect(
      service.withDevice(actor, row.deviceId, "quyan:remote_terminal:GetAgentPreferences", request(), async (guard) => {
        await prisma.remoteTerminalUserEntitlement.update({
          where: { id: row.entitlementId },
          data: { endAt: new Date(Date.now() - 60_000) },
        });
        await guard?.();
        return { private: "fixture" };
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("preserves one old read and old permissions in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const row = await device();
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.REMOTE_TERMINAL_DEVICE_READ] },
    });
    await policy({ Effect: "Deny", Action: "quyan:remote_terminal:ListDevices", Resource: arn(row.deviceId) });
    const legacy = vi.fn(async () => [{ deviceId: "legacy" }] as never);
    expect(await service.list(actor, request(), legacy)).toEqual([{ deviceId: "legacy" }]);
    expect(legacy).toHaveBeenCalledTimes(1);
  });
  it("projects legacy Allow and removes through the native device Action", async () => {
    const row = await device();
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.REMOTE_TERMINAL_DEVICE_READ] },
    });
    expect(await service.list(actor, request(), async () => [])).toHaveLength(1);
    await prisma.user.update({
      where: { id: actor },
      data: { permissionRemoves: [Permission.REMOTE_TERMINAL_DEVICE_READ] },
    });
    expect(await service.list(actor, request(), async () => [])).toEqual([]);
    expect(await groups.resourceExistsInAccount(arn(row.deviceId), owner)).toBe(true);
  });
});
