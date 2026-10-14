import * as revisions from "@/store/users/iam-authorization-revision";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { Permission, type IamTerminalManagementMutation } from "@quyan/shared";
import { PlatformTerminalManagementMutationIamService } from "@/services/remote-terminal/platform-terminal-management-mutation-iam.service";
import { PlatformTerminalManagementMutationRepository } from "@/store/remote-terminal-product/platform-terminal-management-mutation.repository";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  platformTerminalBindingArn,
  platformTerminalEntitlementArn,
} from "@/iam/resources/platform-terminal-entitlement-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  repository = PlatformTerminalManagementMutationRepository.getInstance(),
  authority = PlatformTerminalManagementMutationIamService.getInstance();
let owner: string, actor: string, customer: string, groupId: string, entitlement: string, binding: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "terminal-mutation-" + randomUUID(),
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
    headers: { "x-action": "client:Fake", "x-account-id": "other" },
    body: { userId: "other" },
    secure: true,
    ip: "192.0.2.42",
  }) as unknown as TypedRequest;
const prepared = (operation: IamTerminalManagementMutation = "RevokeDeviceBinding") =>
  authority.prepare(operation, actor, request(), operation === "RevokeDeviceBinding" ? binding : entitlement);
async function deny(operation: IamTerminalManagementMutation) {
  const resource =
    operation === "RevokeDeviceBinding"
      ? platformTerminalBindingArn(customer, binding)
      : platformTerminalEntitlementArn(customer, entitlement);
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:remote_terminal:" + operation, Resource: resource },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "mutation-deny-" + randomUUID(),
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
        username: "terminal-mutation-" + randomUUID(),
        name: "Fixture terminal manager",
        accountOwnerId: null,
        permissions: [Permission.REMOTE_TERMINAL_DEVICE_WRITE, Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE],
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
  binding = (
    await prisma.remoteTerminalDeviceBinding.create({
      data: {
        entitlementId: entitlement,
        userId: customer,
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
  ).id;
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
});
describe("terminal management resource mutations", () => {
  it("runs native business methods without legacy secret hydration and preserves admin unbind bypass", async () => {
    const legacy = vi.spyOn(
      (
        await import("@/store/remote-terminal-product/remote-terminal-product.repository")
      ).RemoteTerminalProductRepository.getInstance(),
      "findDeviceBindingById",
    );
    await RemoteTerminalProductService.getInstance().adminRevokeDevice(binding, actor, request());
    expect(legacy).not.toHaveBeenCalled();
    expect(await prisma.remoteTerminalDeviceBinding.findUnique({ where: { id: binding } })).toMatchObject({
      status: -1,
      online: false,
      heartbeatToken: "PRIVATE-HEARTBEAT-FIXTURE",
    });
    await RemoteTerminalProductService.getInstance().resetUnbindCount(entitlement, actor, request());
    expect(
      (await prisma.remoteTerminalUserEntitlement.findUnique({ where: { id: entitlement } }))?.unbindResetAt,
    ).toBeInstanceOf(Date);
    await RemoteTerminalProductService.getInstance().deleteEntitlement(entitlement, actor, request());
    expect((await prisma.remoteTerminalUserEntitlement.findUnique({ where: { id: entitlement } }))?.status).toBe(-1);
  });
  it.each(["RevokeDeviceBinding", "DeleteEntitlement", "ResetUnbindCount"] as const)(
    "refuses explicit %s denial without changing state",
    async (operation) => {
      await deny(operation);
      await expect(prepared(operation)).rejects.toMatchObject({ statusCode: 403 });
      expect(await prisma.remoteTerminalUserEntitlement.findUnique({ where: { id: entitlement } })).toMatchObject({
        status: 1,
        unbindResetAt: null,
      });
      expect(await prisma.remoteTerminalDeviceBinding.findUnique({ where: { id: binding } })).toMatchObject({
        status: 1,
        online: true,
      });
    },
  );
  it("loads only safe mutation metadata", async () => {
    const source = await prepared();
    expect(source?.target).toMatchObject({ id: binding, userId: customer, label: "fixture host" });
    expect(JSON.stringify(source?.target)).not.toMatch(/heartbeatToken|snapshot|PRIVATE|registrationToken/);
  });
  it("requires the persisted global management ceiling even when account policy allows everything", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(prepared()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses stale owner and scalar snapshots even without timestamp changes", async () => {
    const source = await prepared();
    await prisma.$executeRaw`UPDATE remote_terminal_device_bindings SET hostname='concurrent-name' WHERE id=${binding}`;
    await expect(repository.mutate(source!.target, source!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.remoteTerminalDeviceBinding.findUnique({ where: { id: binding } }))?.status).toBe(1);
  });
  it("refuses changed resource ownership rather than recomputing a permissive ARN", async () => {
    const source = await prepared();
    await prisma.remoteTerminalDeviceBinding.update({ where: { id: binding }, data: { userId: owner } });
    await expect(repository.mutate(source!.target, source!.guard)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses mismatched binding and entitlement ownership", async () => {
    await prisma.remoteTerminalUserEntitlement.update({ where: { id: entitlement }, data: { userId: owner } });
    const source = await prepared();
    await expect(repository.mutate(source!.target, source!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.remoteTerminalDeviceBinding.findUnique({ where: { id: binding } }))?.status).toBe(1);
  });
  it("refuses policy changes between preparation and persistence", async () => {
    const source = await prepared();
    await deny("RevokeDeviceBinding");
    await expect(repository.mutate(source!.target, source!.guard)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses timestamp-preserving group permission revocation", async () => {
    const source = await prepared();
    await prisma.$executeRaw`UPDATE \`groups\` SET permissions='[]' WHERE id=${groupId}`;
    await expect(repository.mutate(source!.target, source!.guard)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["RevokeDeviceBinding", "DeleteEntitlement", "ResetUnbindCount"] as const)(
    "rolls back %s when final authorization fails",
    async (operation) => {
      const source = await prepared(operation),
        recheck = source!.guard.users.recheck;
      let calls = 0;
      source!.guard.users.recheck = async () => {
        await recheck();
        if (++calls === 2) throw iamAccountDenied();
      };
      await expect(repository.mutate(source!.target, source!.guard)).rejects.toMatchObject({ statusCode: 403 });
      expect(calls).toBe(2);
      expect(await prisma.remoteTerminalDeviceBinding.findUnique({ where: { id: binding } })).toMatchObject({
        status: 1,
        online: true,
      });
      expect(await prisma.remoteTerminalUserEntitlement.findUnique({ where: { id: entitlement } })).toMatchObject({
        status: 1,
        unbindResetAt: null,
      });
    },
  );
  it("refuses expired request conditions and unavailable authorization data during commit", async () => {
    const source = await prepared();
    vi.spyOn(IamAuthorizationService.getInstance(), "authorize").mockRejectedValue(new Error("fixture unavailable"));
    await expect(repository.mutate(source!.target, source!.guard)).rejects.toThrow("fixture unavailable");
    expect((await prisma.remoteTerminalDeviceBinding.findUnique({ where: { id: binding } }))?.status).toBe(1);
  });
  it("refuses guard reuse across targets or resource kinds", async () => {
    const source = await prepared();
    await expect(repository.mutate({ ...source!.target, id: entitlement }, source!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      repository.mutate(source!.target, { ...source!.guard, operation: "DeleteEntitlement" }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses authorization revision drift and rolls back its transaction", async () => {
    const revision = vi
      .spyOn(revisions, "readIamAuthorizationRevision")
      .mockResolvedValueOnce("before")
      .mockResolvedValueOnce("changed");
    await expect(
      RemoteTerminalProductService.getInstance().adminRevokeDevice(binding, actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.remoteTerminalDeviceBinding.findUnique({ where: { id: binding } })).toMatchObject({
      status: 1,
      online: true,
    });
    expect(revision).toHaveBeenCalledTimes(2);
  });
});
