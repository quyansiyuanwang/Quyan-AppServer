import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RemoteTerminalDeviceIamService } from "@/services/remote-terminal/remote-terminal-device-iam.service";
import { RemoteTerminalDeviceReadRepository } from "@/store/remote-terminal-product/remote-terminal-device-read.repository";
import { RemoteTerminalDeviceProbeRepository } from "@/store/remote-terminal-product/remote-terminal-device-probe.repository";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { remoteTerminalDeviceArn } from "@/iam/resources/remote-terminal-resources";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, other: string;
const mode = env.security.iamAuthorizationMode,
  reads = RemoteTerminalDeviceReadRepository.getInstance(),
  probes = RemoteTerminalDeviceProbeRepository.getInstance(),
  service = RemoteTerminalDeviceIamService.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "terminal-operation-" + randomUUID(),
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
    headers: { "x-action": "*" },
    secure: true,
    ip: "192.0.2.10",
  }) as unknown as TypedRequest;
const principal = () => getIamPrincipal(request())!;
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
  return prisma.remoteTerminalDeviceBinding.create({
    data: {
      entitlementId: entitlement.id,
      userId: actor,
      deviceId: randomUUID(),
      fingerprint: randomUUID(),
      hostname: "fixture",
      platform: "linux",
      arch: "x64",
      snapshot: { diagnostics: { availableShells: ["bash"] } },
      heartbeatToken: randomUUID(),
      registeredAt: new Date(),
      lastSeenAt: new Date(Date.now() - 60_000),
      online: true,
    },
  });
}
const arn = (id: string) => remoteTerminalDeviceArn(owner, actor, id);
async function policy(Statement: unknown) {
  const parsed = parseIamPolicy({ Version: "1", Statement });
  const row = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "terminal-operation-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  return prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: row.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
const grant = (deviceId: string, Action = "quyan:remote_terminal:ProbeDevices") =>
  policy({ Effect: "Allow", Action, Resource: arn(deviceId) });
async function guard(deviceId: string) {
  return {
    principal: principal(),
    target: (await reads.targets(principal(), [deviceId]))[0]!,
    authorizationRevision: await probes.revision(principal()),
    recheck: vi.fn(async () => {}),
  };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  other = await user(owner);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
});
describe("guarded terminal probe persistence", () => {
  it("updates a permitted offline probe without changing lastSeenAt", async () => {
    const row = await device();
    const result = await probes.record(await guard(row.deviceId), null);
    expect(result).toEqual({ deviceId: row.deviceId, online: false, lastSeenAt: row.lastSeenAt.toISOString() });
    expect((await prisma.remoteTerminalDeviceBinding.findUniqueOrThrow({ where: { id: row.id } })).lastSeenAt).toEqual(
      row.lastSeenAt,
    );
  });
  it("records a successful probe timestamp without returning credentials", async () => {
    const row = await device(),
      pongAt = new Date();
    const result = await probes.record(await guard(row.deviceId), pongAt);
    expect(result).toEqual({ deviceId: row.deviceId, online: true, lastSeenAt: pongAt.toISOString() });
    expect(Object.keys(result).sort()).toEqual(["deviceId", "lastSeenAt", "online"]);
    const saved = await prisma.remoteTerminalDeviceBinding.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved.lastOnlineAt).toEqual(pongAt);
    expect(saved.heartbeatToken).toBe(row.heartbeatToken);
  });
  it("rolls back a status update when the final authorization check denies", async () => {
    const row = await device(),
      input = await guard(row.deviceId);
    input.recheck.mockResolvedValueOnce(undefined).mockRejectedValue(new Error("fixture final denial"));
    await expect(probes.record(input, null)).rejects.toThrow("fixture final denial");
    const saved = await prisma.remoteTerminalDeviceBinding.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved.online).toBe(true);
    expect(saved.updateTime).toEqual(row.updateTime);
  });
  it("does not write after a policy binding changes", async () => {
    const row = await device(),
      input = await guard(row.deviceId);
    await grant(row.deviceId);
    await expect(probes.record(input, null)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.remoteTerminalDeviceBinding.findUniqueOrThrow({ where: { id: row.id } })).online).toBe(true);
  });
  it.each(["reassigned", "device-disabled", "entitlement-disabled", "expired", "raw-owner"] as const)(
    "rejects %s source revisions before status writes",
    async (kind) => {
      const row = await device(),
        input = await guard(row.deviceId);
      if (kind === "reassigned" || kind === "device-disabled")
        await prisma.remoteTerminalDeviceBinding.update({
          where: { id: row.id },
          data: kind === "reassigned" ? { userId: other } : { status: 0 },
        });
      else if (kind === "raw-owner")
        await prisma.$executeRaw`UPDATE remote_terminal_user_entitlements SET userId=${other} WHERE id=${row.entitlementId}`;
      else
        await prisma.remoteTerminalUserEntitlement.update({
          where: { id: row.entitlementId },
          data: kind === "expired" ? { endAt: new Date(Date.now() - 60_000) } : { status: 0 },
        });
      await expect(probes.record(input, null)).rejects.toMatchObject({ statusCode: 403 });
      expect((await prisma.remoteTerminalDeviceBinding.findUniqueOrThrow({ where: { id: row.id } })).online).toBe(true);
    },
  );
  it("rejects disabled actor or account owner", async () => {
    const row = await device(),
      input = await guard(row.deviceId);
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(probes.record(input, null)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a stale target ID rather than writing a different bound device", async () => {
    const a = await device(),
      b = await device(),
      input = await guard(a.deviceId);
    input.target.id = b.id;
    await expect(probes.record(input, null)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.remoteTerminalDeviceBinding.findUniqueOrThrow({ where: { id: b.id } })).online).toBe(true);
  });
});
describe("native device operation policies", () => {
  it("pings and commits only resources allowed by policy", async () => {
    const a = await device(),
      b = await device();
    await policy([
      {
        Effect: "Allow",
        Action: "quyan:remote_terminal:ProbeDevices",
        Resource: "acs:remote-terminal:*:" + owner + ":device/" + actor + "/*",
      },
      { Effect: "Deny", Action: "quyan:remote_terminal:ProbeDevices", Resource: arn(b.deviceId) },
    ]);
    const dispatch = vi.fn(async (_id, check) => {
      await check();
      return null;
    });
    expect(
      (
        await service.probe(
          actor,
          request(),
          async () => {
            throw new Error("unexpected legacy");
          },
          dispatch,
        )
      ).items.map((row) => row.deviceId),
    ).toEqual([a.deviceId]);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((await prisma.remoteTerminalDeviceBinding.findUniqueOrThrow({ where: { id: a.id } })).online).toBe(false);
    expect((await prisma.remoteTerminalDeviceBinding.findUniqueOrThrow({ where: { id: b.id } })).online).toBe(true);
  });
  it("commits multiple permitted probes after concurrent transport checks", async () => {
    const devices = await Promise.all([device(), device(), device()]);
    await policy({
      Effect: "Allow",
      Action: "quyan:remote_terminal:ProbeDevices",
      Resource: "acs:remote-terminal:*:" + owner + ":device/" + actor + "/*",
    });
    const dispatch = vi.fn(async (_id, check) => {
      await check();
      await Promise.resolve();
      return null;
    });
    const response = await service.probe(actor, request(), async () => ({ items: [] }), dispatch);
    expect(response.items.map((item) => item.deviceId).sort()).toEqual(devices.map((row) => row.deviceId).sort());
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(
      await prisma.remoteTerminalDeviceBinding.count({
        where: { id: { in: devices.map((row) => row.id) }, online: false },
      }),
    ).toBe(3);
  });
  it("does not write or dispatch with no matching Allow", async () => {
    const row = await device(),
      dispatch = vi.fn();
    expect(await service.probe(actor, request(), async () => ({ items: [] }), dispatch)).toEqual({ items: [] });
    expect(dispatch).not.toHaveBeenCalled();
    expect((await prisma.remoteTerminalDeviceBinding.findUniqueOrThrow({ where: { id: row.id } })).online).toBe(true);
  });
  it("does not persist a late probe result after revocation", async () => {
    const row = await device(),
      binding = await grant(row.deviceId);
    await expect(
      service.probe(
        actor,
        request(),
        async () => ({ items: [] }),
        async () => {
          await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
          return null;
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.remoteTerminalDeviceBinding.findUniqueOrThrow({ where: { id: row.id } })).online).toBe(true);
  });
  it("does not persist a late probe result after device reassignment", async () => {
    const row = await device();
    await grant(row.deviceId);
    await expect(
      service.probe(
        actor,
        request(),
        async () => ({ items: [] }),
        async () => {
          await prisma.remoteTerminalDeviceBinding.update({ where: { id: row.id }, data: { userId: other } });
          return null;
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.remoteTerminalDeviceBinding.findUniqueOrThrow({ where: { id: row.id } })).online).toBe(true);
  });
  it("requires a write grant for preferences-set and honors explicit Deny", async () => {
    const row = await device();
    await grant(row.deviceId, "quyan:remote_terminal:GetAgentPreferences");
    const write = vi.fn(async (check) => {
      await check?.();
      return { saved: true };
    });
    await expect(
      service.withDevice(actor, row.deviceId, "quyan:remote_terminal:UpdateAgentPreferences", request(), write),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(write).not.toHaveBeenCalled();
    await grant(row.deviceId, "quyan:remote_terminal:UpdateAgentPreferences");
    expect(
      await service.withDevice(actor, row.deviceId, "quyan:remote_terminal:UpdateAgentPreferences", request(), write),
    ).toEqual({ saved: true });
    await policy({
      Effect: "Deny",
      Action: "quyan:remote_terminal:UpdateAgentPreferences",
      Resource: arn(row.deviceId),
    });
    write.mockClear();
    await expect(
      service.withDevice(actor, row.deviceId, "quyan:remote_terminal:UpdateAgentPreferences", request(), write),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(write).not.toHaveBeenCalled();
  });
  it("does not return preference acknowledgements after mid-request revocation", async () => {
    const row = await device(),
      binding = await grant(row.deviceId, "quyan:remote_terminal:UpdateAgentPreferences");
    await expect(
      service.withDevice(
        actor,
        row.deviceId,
        "quyan:remote_terminal:UpdateAgentPreferences",
        request(),
        async (check) => {
          await check?.();
          await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
          return { saved: true };
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("preserves one old write with %s permission enforcement", async (mode) => {
    const row = await device();
    env.security.iamAuthorizationMode = mode;
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.REMOTE_TERMINAL_DEVICE_READ] },
    });
    const write = vi.fn(async () => ({ saved: true }));
    await expect(
      service.withDevice(actor, row.deviceId, "quyan:remote_terminal:UpdateAgentPreferences", request(), write),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.REMOTE_TERMINAL_DEVICE_WRITE] },
    });
    await policy({
      Effect: "Deny",
      Action: "quyan:remote_terminal:UpdateAgentPreferences",
      Resource: arn(row.deviceId),
    });
    expect(
      await service.withDevice(actor, row.deviceId, "quyan:remote_terminal:UpdateAgentPreferences", request(), write),
    ).toEqual({ saved: true });
    expect(write).toHaveBeenCalledTimes(1);
  });
});
