import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import { RemoteTerminalDeviceRegistry } from "@/modules/remote-terminal/gateway/device-registry";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { remoteTerminalProductEntitlementArn } from "@/iam/resources/remote-terminal-resources";
import * as revisions from "@/store/users/iam-authorization-revision";
import type { IamCondition } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import type { RemoteTerminalHostSnapshot } from "@/modules/remote-terminal/protocol";
const mode = env.security.iamAuthorizationMode,
  oldSecret = env.integrations.remoteTerminal.installTokenSecret;
const SECRET = "fixture-only-consumption-secret-".repeat(4),
  registry = new RemoteTerminalDeviceRegistry();
const host: RemoteTerminalHostSnapshot = {
  hostname: "fixture",
  platform: "linux",
  arch: "x64",
  agentVersion: "fixture",
  capabilities: {
    sshForward: false,
    nativePty: false,
    selfUpdate: false,
    proxyAware: false,
    serviceManaged: false,
    sessionRecording: false,
  },
  diagnostics: {
    installFormats: [],
    serviceManager: "fixture",
    defaultLogPath: "fixture",
    availableShells: [],
    sshCheck: { available: false, detail: "fixture" },
    notes: [],
  },
};
let owner: string, actor: string, entitlement: string;
const request = (): TypedRequest =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
    headers: {},
    ip: "192.0.2.42",
    secure: true,
  }) as TypedRequest;
const issue = (req = request()) =>
  RemoteTerminalProductService.getInstance().issueInstallToken(actor, entitlement, req);
const register = (token: string, fingerprint = "a".repeat(64)) =>
  registry.register(
    { registrationToken: token, deviceFingerprint: fingerprint, fingerprintVersion: "v1", snapshot: host },
    request(),
  );
async function deny(Condition?: IamCondition) {
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "consume-deny-" + randomUUID(),
    permissions: [],
    iamVersion: {
      ...parseIamPolicy({
        Version: "1",
        Statement: {
          Effect: "Deny",
          ...(Condition ? { Condition } : {}),
          Action: "quyan:remote_terminal:GetMyInstallToken",
          Resource: remoteTerminalProductEntitlementArn(owner, actor, entitlement),
        },
      }),
      createdBy: owner,
    },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  env.integrations.remoteTerminal.installTokenSecret = SECRET;
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "consume-" + randomUUID(),
          password: "fixture-only",
          accountOwnerId,
          parentUserId: accountOwnerId,
          userType: accountOwnerId ? "ram_user" : "root",
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  entitlement = (
    await prisma.remoteTerminalUserEntitlement.create({
      data: {
        userId: actor,
        name: "Consumption fixture",
        startAt: new Date(Date.now() - 86400000),
        endAt: new Date(Date.now() + 86400000),
        deviceLimit: 1,
        terminalLimit: 1,
      },
    })
  ).id;
  await prisma.remoteTerminalEntitlementToken.create({
    data: { entitlementId: entitlement, token: "private-consumption-fixture-" + randomUUID() },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  env.integrations.remoteTerminal.installTokenSecret = oldSecret;
});
describe("install capability registration transaction", () => {
  it("registers and refreshes one device through the real signed capability without consuming another slot", async () => {
    const credential = await issue(),
      first = await register(credential.token),
      second = await register(credential.token);
    expect(first.deviceId).toBe(second.deviceId);
    expect(first.heartbeatToken).not.toBe(second.heartbeatToken);
    expect(await prisma.remoteTerminalDeviceBinding.count({ where: { entitlementId: entitlement, status: 1 } })).toBe(
      1,
    );
  });
  it("rejects policy revocation after issuance with no device or token-use write", async () => {
    const credential = await issue();
    await deny();
    await expect(register(credential.token)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.remoteTerminalDeviceBinding.count({ where: { entitlementId: entitlement } })).toBe(0);
    expect(
      (await prisma.remoteTerminalEntitlementToken.findUnique({ where: { entitlementId: entitlement } }))?.lastUsedAt,
    ).toBeNull();
  });
  it("cannot turn an IAM-bound capability into an unrestricted credential by rolling back to legacy", async () => {
    const credential = await issue();
    await deny();
    env.security.iamAuthorizationMode = "legacy";
    await expect(register(credential.token)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("invalidates capabilities after issuer or entitlement revisions change", async () => {
    const credential = await issue();
    await prisma.user.update({ where: { id: actor }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(register(credential.token)).rejects.toMatchObject({ statusCode: 403 });
    const second = await issue();
    await prisma.remoteTerminalUserEntitlement.update({ where: { id: entitlement }, data: { deviceLimit: 2 } });
    await expect(register(second.token)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("serializes competing registration attempts under a one-device limit", async () => {
    const credential = await issue();
    const results = await Promise.allSettled([register(credential.token), register(credential.token, "b".repeat(64))]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.remoteTerminalDeviceBinding.count({ where: { entitlementId: entitlement, status: 1 } })).toBe(
      1,
    );
  });
  it("rolls back the binding and token-use marker when the final authorization revision differs", async () => {
    const credential = await issue();
    vi.spyOn(revisions, "readIamAuthorizationRevision")
      .mockResolvedValueOnce("before")
      .mockResolvedValueOnce("changed");
    await expect(register(credential.token)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.remoteTerminalDeviceBinding.count({ where: { entitlementId: entitlement } })).toBe(0);
    expect(
      (await prisma.remoteTerminalEntitlementToken.findUnique({ where: { entitlementId: entitlement } }))?.lastUsedAt,
    ).toBeNull();
  });
  it("rejects a revoked AccessKey without returning device credentials", async () => {
    const key = await prisma.accessKey.create({
      data: { userId: actor, key: "private-install-access-fixture-" + randomUUID() },
    });
    const req = request();
    req.authContext!.subjectType = "access_key";
    req.accessKey = key;
    const credential = await issue(req);
    await prisma.accessKey.update({ where: { id: key.id }, data: { status: -1 } });
    await expect(register(credential.token)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.remoteTerminalDeviceBinding.count({ where: { entitlementId: entitlement } })).toBe(0);
  });
  it("counts disabled bindings when they are reactivated and respects the rebind cooldown", async () => {
    const credential = await issue();
    const first = await register(credential.token);
    await prisma.remoteTerminalDeviceBinding.update({ where: { deviceId: first.deviceId }, data: { status: 0 } });
    await register(credential.token, "b".repeat(64));
    await expect(register(credential.token)).rejects.toThrow("Device limit reached");
    await prisma.remoteTerminalDeviceBinding.update({
      where: { deviceId: first.deviceId },
      data: { status: -1, updateTime: new Date() },
    });
    await expect(register(credential.token)).rejects.toThrow("cooling down");
    expect(await prisma.remoteTerminalDeviceBinding.count({ where: { entitlementId: entitlement, status: 1 } })).toBe(
      1,
    );
  });
  it("checks conditions against the consuming device transport instead of the issuance request", async () => {
    await deny({ NotIpAddress: { "acs:SourceIp": "192.0.2.42" } });
    const credential = await issue(),
      req = request();
    Object.defineProperty(req, "ip", { value: "192.0.2.44" });
    await expect(
      registry.register(
        {
          registrationToken: credential.token,
          deviceFingerprint: "a".repeat(64),
          fingerprintVersion: "v1",
          snapshot: host,
        },
        req,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.remoteTerminalDeviceBinding.count({ where: { entitlementId: entitlement } })).toBe(0);
  });
  it("invalidates the capability when its issuing role session is revoked", async () => {
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "Consume role", maxSessionDuration: 3600 },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 900000),
      },
    });
    const req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    const credential = await issue(req);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), status: 0 } });
    await expect(register(credential.token)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.remoteTerminalDeviceBinding.count({ where: { entitlementId: entitlement } })).toBe(0);
  });
  it("refuses malformed binding states instead of reactivating corrupted metadata", async () => {
    const credential = await issue(),
      first = await register(credential.token);
    await prisma.remoteTerminalDeviceBinding.update({ where: { deviceId: first.deviceId }, data: { status: 2 } });
    await expect(register(credential.token)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.remoteTerminalDeviceBinding.findUnique({ where: { deviceId: first.deviceId } }))?.status).toBe(
      2,
    );
  });
});
