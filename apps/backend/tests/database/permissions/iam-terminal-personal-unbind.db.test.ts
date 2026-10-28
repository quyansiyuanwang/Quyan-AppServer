import * as revisions from "@/store/users/iam-authorization-revision";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { TerminalPersonalUnbindIamService } from "@/services/remote-terminal/terminal-personal-unbind-iam.service";
import { TerminalPersonalUnbindRepository } from "@/store/remote-terminal-product/terminal-personal-unbind.repository";
import { RemoteTerminalProductRepository } from "@/store/remote-terminal-product/remote-terminal-product.repository";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import { ConfigService } from "@/services/system/config.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  remoteTerminalProductBindingArn,
  remoteTerminalProductEntitlementArn,
} from "@/iam/resources/remote-terminal-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode,
  repository = TerminalPersonalUnbindRepository.getInstance(),
  authority = TerminalPersonalUnbindIamService.getInstance();
let owner: string, actor: string, entitlement: string, bindings: string[];
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "personal-unbind-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram_user" : "root",
        permissionAdds: [Permission.REMOTE_TERMINAL_SESSION_READ],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "client:Fake", "x-account-id": "other" },
    secure: true,
    ip: "192.0.2.42",
  }) as unknown as TypedRequest;
const prepare = (id = bindings[0]) => authority.prepare("RevokeMyDeviceBinding", actor, id, request());
async function deny(action: string, resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:remote_terminal:" + action, Resource: resource },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "unbind-deny-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
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
  owner = await user();
  actor = await user(owner);
  vi.spyOn(ConfigService.getInstance(), "getRemoteTerminalUnbindConfig").mockResolvedValue({
    maxCount: 2,
    windowHours: 24,
    rebindCooldownMinutes: 60,
  });
  entitlement = (
    await prisma.remoteTerminalUserEntitlement.create({
      data: {
        userId: actor,
        name: "fixture entitlement",
        startAt: new Date("2026-01-01"),
        endAt: new Date("2027-01-01"),
        deviceLimit: 3,
        terminalLimit: 1,
      },
    })
  ).id;
  bindings = [];
  for (let index = 0; index < 2; index++)
    bindings.push(
      (
        await prisma.remoteTerminalDeviceBinding.create({
          data: {
            entitlementId: entitlement,
            userId: actor,
            deviceId: "fixture-" + randomUUID(),
            fingerprint: randomUUID(),
            hostname: "fixture host",
            platform: "linux",
            arch: "x64",
            snapshot: { private: "PRIVATE-SNAPSHOT-FIXTURE" },
            heartbeatToken: "PRIVATE-HEARTBEAT-FIXTURE",
            registeredAt: new Date(),
            lastSeenAt: new Date(),
            online: true,
          },
        })
      ).id,
    );
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
describe("personal terminal device unbind transaction", () => {
  it("reads reminders and revokes through native methods without loading credentials", async () => {
    const hydrate = vi.spyOn(RemoteTerminalProductRepository.getInstance(), "findDeviceBindingById");
    const service = RemoteTerminalProductService.getInstance();
    expect(await service.getCurrentUserDeviceUnbindReminder(actor, bindings[0], request())).toMatchObject({
      revokedCount: 0,
      remainingCount: 2,
    });
    await service.revokeCurrentUserDevice(actor, bindings[0], request());
    expect(await service.getCurrentUserDeviceUnbindReminder(actor, bindings[1], request())).toMatchObject({
      revokedCount: 1,
      remainingCount: 1,
    });
    expect(hydrate).not.toHaveBeenCalled();
    expect(await prisma.remoteTerminalDeviceBinding.findUnique({ where: { id: bindings[0] } })).toMatchObject({
      status: -1,
      online: false,
      heartbeatToken: "PRIVATE-HEARTBEAT-FIXTURE",
    });
  });
  it("retains authenticated reminder reads without granting personal mutations", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
    expect(
      await RemoteTerminalProductService.getInstance().getCurrentUserDeviceUnbindReminder(
        actor,
        bindings[0],
        request(),
      ),
    ).toMatchObject({ remainingCount: 2 });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["binding", "entitlement"])("refuses explicit denial on the %s resource", async (kind) => {
    const resource =
      kind === "binding"
        ? remoteTerminalProductBindingArn(owner, actor, bindings[0])
        : remoteTerminalProductEntitlementArn(owner, actor, entitlement);
    await deny("RevokeMyDeviceBinding", resource);
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.remoteTerminalDeviceBinding.findUnique({ where: { id: bindings[0] } }))?.status).toBe(1);
  });
  it("never turns a reminder guard into mutation authority", async () => {
    const source = await authority.prepare("GetMyUnbindReminder", actor, bindings[0], request());
    await expect(repository.run(source!.target, source!.guard, true)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.remoteTerminalDeviceBinding.findUnique({ where: { id: bindings[0] } }))?.status).toBe(1);
  });
  it("refuses relabeling a reminder guard as write authority", async () => {
    const source = await authority.prepare("GetMyUnbindReminder", actor, bindings[0], request());
    source!.guard.operation = "RevokeMyDeviceBinding";
    await expect(repository.run(source!.target, source!.guard, true)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.remoteTerminalDeviceBinding.findUnique({ where: { id: bindings[0] } }))?.status).toBe(1);
  });
  it("refuses binding and parent ownership mismatches", async () => {
    await prisma.remoteTerminalDeviceBinding.update({ where: { id: bindings[0] }, data: { userId: owner } });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.remoteTerminalUserEntitlement.update({ where: { id: entitlement }, data: { userId: owner } });
    await expect(prepare(bindings[1])).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses source changes including timestamp-preserving entitlement reset", async () => {
    const source = await prepare();
    await prisma.$executeRaw`UPDATE remote_terminal_user_entitlements SET unbindResetAt=NOW() WHERE id=${entitlement}`;
    await expect(repository.run(source!.target, source!.guard, true)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses fresh policy revocation", async () => {
    const source = await prepare();
    await deny("RevokeMyDeviceBinding", remoteTerminalProductBindingArn(owner, actor, bindings[0]));
    await expect(repository.run(source!.target, source!.guard, true)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back the state change on final authorization denial", async () => {
    const source = await prepare(),
      recheck = source!.guard.users.recheck;
    let calls = 0;
    source!.guard.users.recheck = async () => {
      await recheck();
      if (++calls === 2) throw iamAccountDenied();
    };
    await expect(repository.run(source!.target, source!.guard, true)).rejects.toMatchObject({ statusCode: 403 });
    expect(calls).toBe(2);
    expect(await prisma.remoteTerminalDeviceBinding.findUnique({ where: { id: bindings[0] } })).toMatchObject({
      status: 1,
      online: true,
    });
  });
  it("serializes competing device revocations at the last remaining allowance", async () => {
    vi.mocked(ConfigService.getInstance().getRemoteTerminalUnbindConfig).mockResolvedValue({
      maxCount: 1,
      windowHours: 24,
      rebindCooldownMinutes: 60,
    });
    const sources = await Promise.all(bindings.map((id) => prepare(id)));
    const results = await Promise.allSettled(
      sources.map((source) => repository.run(source!.target, source!.guard, true)),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.remoteTerminalDeviceBinding.count({ where: { entitlementId: entitlement, status: -1 } })).toBe(
      1,
    );
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect([400, 409]).toContain(rejected.reason.statusCode);
  });
  it("does not count revocations before the reset time", async () => {
    await prisma.remoteTerminalDeviceBinding.update({
      where: { id: bindings[0] },
      data: { status: -1, updateTime: new Date(Date.now() - 60000) },
    });
    await prisma.remoteTerminalUserEntitlement.update({
      where: { id: entitlement },
      data: { unbindResetAt: new Date() },
    });
    expect(
      await RemoteTerminalProductService.getInstance().getCurrentUserDeviceUnbindReminder(
        actor,
        bindings[1],
        request(),
      ),
    ).toMatchObject({ revokedCount: 0, remainingCount: 2 });
  });
  it("preserves disabled and exhausted quota errors", async () => {
    vi.mocked(ConfigService.getInstance().getRemoteTerminalUnbindConfig).mockResolvedValue({
      maxCount: 0,
      windowHours: 24,
      rebindCooldownMinutes: 60,
    });
    let source = await prepare();
    await expect(repository.run(source!.target, source!.guard, true)).rejects.toMatchObject({
      statusCode: 400,
      messageKey: "remoteTerminalProduct.unbindDisabled",
    });
    vi.mocked(ConfigService.getInstance().getRemoteTerminalUnbindConfig).mockResolvedValue({
      maxCount: 1,
      windowHours: 24,
      rebindCooldownMinutes: 60,
    });
    await prisma.remoteTerminalDeviceBinding.update({ where: { id: bindings[0] }, data: { status: -1 } });
    source = await prepare(bindings[1]);
    await expect(repository.run(source!.target, source!.guard, true)).rejects.toMatchObject({
      statusCode: 400,
      messageKey: "remoteTerminalProduct.unbindLimitReached",
    });
  });
  it("refuses authorization revision drift and rolls back its transaction", async () => {
    const revision = vi
      .spyOn(revisions, "readIamAuthorizationRevision")
      .mockResolvedValueOnce("before")
      .mockResolvedValueOnce("changed");
    await expect(
      RemoteTerminalProductService.getInstance().revokeCurrentUserDevice(actor, bindings[0], request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.remoteTerminalDeviceBinding.findUnique({ where: { id: bindings[0] } })).toMatchObject({
      status: 1,
      online: true,
    });
    expect(revision).toHaveBeenCalledTimes(2);
  });
});
