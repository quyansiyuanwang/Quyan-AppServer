import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { Permission } from "@quyan/shared";
import { PlatformTerminalEntitlementUpdateIamService } from "@/services/remote-terminal/platform-terminal-entitlement-update-iam.service";
import { PlatformTerminalEntitlementUpdateRepository } from "@/store/remote-terminal-product/platform-terminal-entitlement-update.repository";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import { RemoteTerminalProductRepository } from "@/store/remote-terminal-product/remote-terminal-product.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformTerminalEntitlementArn } from "@/iam/resources/platform-terminal-entitlement-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  repository = PlatformTerminalEntitlementUpdateRepository.getInstance(),
  authority = PlatformTerminalEntitlementUpdateIamService.getInstance();
let owner: string, actor: string, customer: string, groupId: string, entitlement: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "terminal-update-" + randomUUID(),
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
    headers: {},
    secure: true,
    ip: "192.0.2.42",
  }) as unknown as TypedRequest;
const prepared = (deleting = false) => authority.prepare(actor, request(), entitlement, deleting);
async function deny(operation: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: {
      Effect: "Deny",
      Action: "quyan:remote_terminal:" + operation,
      Resource: platformTerminalEntitlementArn(customer, entitlement),
    },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "update-deny-" + randomUUID(),
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
  customer = await user();
  groupId = (
    await prisma.group.create({
      data: {
        username: "terminal-update-" + randomUUID(),
        name: "Fixture manager",
        accountOwnerId: null,
        permissions: [Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  entitlement = (
    await prisma.remoteTerminalUserEntitlement.create({
      data: {
        userId: customer,
        name: "fixture entitlement",
        startAt: new Date("2026-01-01"),
        endAt: new Date("2027-01-01"),
        deviceLimit: 2,
        terminalLimit: 1,
      },
    })
  ).id;
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
});
describe("terminal entitlement resource updates", () => {
  it("updates through the native service without loading, rotating or returning credentials", async () => {
    await prisma.remoteTerminalEntitlementToken.create({
      data: { entitlementId: entitlement, token: "PRIVATE-REGISTRATION-FIXTURE" },
    });
    const hydration = vi.spyOn(RemoteTerminalProductRepository.getInstance(), "findEntitlementById");
    const tokens = vi.spyOn(RemoteTerminalProductRepository.getInstance(), "upsertEntitlementToken");
    const result = await RemoteTerminalProductService.getInstance().updateEntitlement(
      entitlement,
      { name: "updated fixture" },
      actor,
      request(),
    );
    expect(result).toMatchObject({ id: entitlement, name: "updated fixture" });
    expect(result.registrationToken).toBeUndefined();
    expect(result.username).toBeUndefined();
    expect(result.registeredDeviceCount).toBeUndefined();
    expect(hydration).not.toHaveBeenCalled();
    expect(tokens).not.toHaveBeenCalled();
    expect(
      (await prisma.remoteTerminalEntitlementToken.findUnique({ where: { entitlementId: entitlement } }))?.token,
    ).toBe("PRIVATE-REGISTRATION-FIXTURE");
  });
  it("does not silently issue a token when a terminal-only entitlement gains device allowance", async () => {
    await prisma.remoteTerminalUserEntitlement.update({ where: { id: entitlement }, data: { deviceLimit: 0 } });
    await RemoteTerminalProductService.getInstance().updateEntitlement(
      entitlement,
      { deviceLimit: 1 },
      actor,
      request(),
    );
    expect(
      await prisma.remoteTerminalEntitlementToken.findUnique({ where: { entitlementId: entitlement } }),
    ).toBeNull();
  });
  it.each(["UpdateEntitlement", "DeleteEntitlement"])(
    "blocks %s denial including deletion through update",
    async (operation) => {
      await deny(operation);
      await expect(
        RemoteTerminalProductService.getInstance().updateEntitlement(entitlement, { status: -1 }, actor, request()),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect((await prisma.remoteTerminalUserEntitlement.findUnique({ where: { id: entitlement } }))?.status).toBe(1);
    },
  );
  it("allows status deletion with both authorized actions", async () => {
    await RemoteTerminalProductService.getInstance().updateEntitlement(entitlement, { status: -1 }, actor, request());
    expect((await prisma.remoteTerminalUserEntitlement.findUnique({ where: { id: entitlement } }))?.status).toBe(-1);
  });
  it("refuses deletion or identity edits using an ordinary update guard", async () => {
    const source = (await prepared())!;
    await expect(repository.update(source.target, { status: -1 }, source.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(repository.update(source.target, { userId: owner }, source.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each(["record", "user", "devices"])("refuses stale %s snapshots without relying on timestamps", async (kind) => {
    const source = (await prepared())!;
    if (kind === "record")
      await prisma.$executeRaw`UPDATE remote_terminal_user_entitlements SET deviceLimit=3 WHERE id=${entitlement}`;
    if (kind === "user") await prisma.$executeRaw`UPDATE users SET accountOwnerId=${owner} WHERE id=${customer}`;
    if (kind === "devices")
      await prisma.remoteTerminalDeviceBinding.create({
        data: {
          entitlementId: entitlement,
          userId: customer,
          deviceId: "fixture-" + randomUUID(),
          fingerprint: randomUUID(),
          hostname: "fixture host",
          platform: "linux",
          arch: "x64",
          heartbeatToken: "PRIVATE-HEARTBEAT-FIXTURE",
          snapshot: {},
          lastSeenAt: new Date(),
          registeredAt: new Date(),
        },
      });
    await expect(repository.update(source.target, { name: "should not persist" }, source.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.remoteTerminalUserEntitlement.findUnique({ where: { id: entitlement } }))?.name).toBe(
      "fixture entitlement",
    );
  });
  it("rolls back a completed write when final authorization fails", async () => {
    const source = (await prepared())!;
    let checks = 0;
    const recheck = source.guard.users.recheck;
    source.guard.users.recheck = async () => {
      if (++checks === 2) throw iamAccountDenied();
      await recheck();
    };
    await expect(repository.update(source.target, { name: "should not persist" }, source.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.remoteTerminalUserEntitlement.findUnique({ where: { id: entitlement } }))?.name).toBe(
      "fixture entitlement",
    );
  });
  it("requires the deployment-managed group ceiling", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(prepared()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("reevaluates unavailable conditions without writing", async () => {
    const source = (await prepared())!;
    vi.spyOn(IamAuthorizationService.getInstance(), "authorize").mockRejectedValue(new Error("fixture unavailable"));
    await expect(repository.update(source.target, { name: "should not persist" }, source.guard)).rejects.toThrow(
      "fixture unavailable",
    );
  });
});
