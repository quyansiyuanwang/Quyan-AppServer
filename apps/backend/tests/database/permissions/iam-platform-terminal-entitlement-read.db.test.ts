import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { Permission, maskSecret } from "@quyan/shared";
import { PlatformTerminalEntitlementReadIamService } from "@/services/remote-terminal/platform-terminal-entitlement-read-iam.service";
import { PlatformTerminalEntitlementReadRepository } from "@/store/remote-terminal-product/platform-terminal-entitlement-read.repository";
import {
  platformTerminalEntitlementArn,
  platformTerminalBindingArn,
  platformTerminalRegistrationTokenArn,
} from "@/iam/resources/platform-terminal-entitlement-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import type { TypedRequest } from "@/types/express";
const action = "quyan:remote_terminal:ListEntitlements",
  originalMode = env.security.iamAuthorizationMode;
let owner: string,
  actor: string,
  customer: string,
  groupId: string,
  templateId: string,
  entitlementId: string,
  otherId: string,
  tokenId: string,
  bindingId: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "entitlement-iam-" + randomUUID(),
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
    headers: { "x-action": "client:Fake" },
    secure: true,
    ip: "192.0.2.30",
  }) as unknown as TypedRequest;
const read = (page = 1, pageSize = 20, filters = {}) =>
  PlatformTerminalEntitlementReadIamService.getInstance().list(
    request(),
    { page, pageSize },
    filters,
    (view) => view,
    async () => {
      throw new Error("legacy must not run");
    },
  );
async function deny(resource: string) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: resource } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "entitlement-deny-" + randomUUID(),
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
        username: "entitlement-global-" + randomUUID(),
        name: "fixture global entitlement management",
        level: 0,
        accountOwnerId: null,
        permissions: [Permission.REMOTE_TERMINAL_ASSIGNMENT_READ],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  templateId = (
    await prisma.remoteTerminalProductTemplate.create({ data: { name: "fixture-template-" + randomUUID() } })
  ).id;
  const data = {
    userId: customer,
    templateId,
    assignedBy: actor,
    name: "fixture entitlement",
    startAt: new Date("2026-01-01"),
    endAt: new Date("2027-01-01"),
    deviceLimit: 2,
    terminalLimit: 1,
  };
  entitlementId = (
    await prisma.remoteTerminalUserEntitlement.create({ data: { ...data, createTime: new Date("2026-01-02") } })
  ).id;
  otherId = (
    await prisma.remoteTerminalUserEntitlement.create({
      data: { ...data, name: "second entitlement", endAt: new Date("2027-02-01"), createTime: new Date("2026-01-03") },
    })
  ).id;
  tokenId = (
    await prisma.remoteTerminalEntitlementToken.create({
      data: { entitlementId, token: "fixture-bearer-" + randomUUID(), label: "fixture-token-metadata" },
    })
  ).id;
  bindingId = (
    await prisma.remoteTerminalDeviceBinding.create({
      data: {
        entitlementId,
        userId: customer,
        registrationTokenId: tokenId,
        deviceId: "fixture-device-" + randomUUID(),
        fingerprint: randomUUID(),
        hostname: "fixture host",
        platform: "linux",
        arch: "x64",
        snapshot: { private: "fixture snapshot" },
        heartbeatToken: "fixture-only-heartbeat",
        registeredAt: new Date(),
        lastSeenAt: new Date(),
      },
    })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
  await prisma.remoteTerminalUserEntitlement.deleteMany({ where: { id: { in: [entitlementId, otherId] } } });
  await prisma.remoteTerminalProductTemplate.deleteMany({ where: { id: templateId } });
});
describe("persisted platform entitlement read protocol", () => {
  it("supports cross-account platform administration with the persisted management ceiling", async () => {
    const result = await read(1, 1);
    expect(result).toMatchObject({
      total: 2,
      records: [
        {
          record: { id: entitlementId, userId: customer },
          templateName: expect.any(String),
          registeredDeviceCount: 1,
          registrationToken: { id: tokenId, label: "fixture-token-metadata" },
        },
      ],
    });
    expect(result.records[0]!.registrationToken).not.toHaveProperty("token");
  });
  it("projects native DTO scalars without ever exposing the token", async () => {
    const result = await RemoteTerminalProductService.getInstance().listEntitlements(
      1,
      20,
      customer,
      undefined,
      undefined,
      request(),
    );
    const row = result.records.find((row) => row.id === entitlementId)!;
    expect(row).toMatchObject({
      name: "fixture entitlement",
      deviceLimit: 2,
      terminalLimit: 1,
      registeredDeviceCount: 1,
      registrationToken: { id: tokenId, maskedToken: maskSecret(undefined) },
    });
    expect(row.registrationToken).not.toHaveProperty("token");
  });
  it("filters primary Deny before hydration and authorized counting", async () => {
    await deny(platformTerminalEntitlementArn(customer, entitlementId));
    const hydrate = vi.spyOn(PlatformTerminalEntitlementReadRepository.getInstance(), "hydrate");
    expect(await read(1, 1)).toMatchObject({ total: 1, records: [{ record: { id: otherId } }] });
    expect(hydrate.mock.calls[0]![1].map((row) => row.target.id)).toEqual([otherId]);
  });
  it("returns no records for an unmatched Allow instead of reverting to global access", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockResolvedValue([]);
    expect(await read()).toMatchObject({ total: 0, records: [] });
  });
  it.each(["user", "assigner", "template", "token", "binding"])("omits denied %s contributions", async (kind) => {
    const resource =
      kind === "user"
        ? platformUserArn(customer)
        : kind === "assigner"
          ? platformUserArn(actor)
          : kind === "template"
            ? platformTemplateArn("remote-terminal", templateId)
            : kind === "token"
              ? platformTerminalRegistrationTokenArn(customer, entitlementId, tokenId)
              : platformTerminalBindingArn(customer, bindingId);
    await deny(resource);
    const result = await read(1, 1),
      row = result.records[0]!;
    expect(result.total).toBe(2);
    expect(row.record.id).toBe(entitlementId);
    const key =
      kind === "user"
        ? "username"
        : kind === "assigner"
          ? "assignedByUsername"
          : kind === "template"
            ? "templateName"
            : kind === "token"
              ? "registrationToken"
              : "registeredDeviceCount";
    expect(row[key as keyof typeof row]).toBeUndefined();
    if (kind === "binding") expect(result.records[0]!.registeredDeviceCount).not.toBe(0);
  });
  it("does not read credentials in metadata or hydration queries", async () => {
    const raw = vi.spyOn(prisma, "$queryRaw"),
      transaction = prisma.$transaction.bind(prisma),
      selects: unknown[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((callback: any, options: any) =>
      transaction(async (tx) => {
        const wrapped = new Proxy(tx, {
          get(target, key, receiver) {
            if (key === "$queryRaw")
              return (sql: any) => {
                expect(sql.sql).not.toMatch(/`k`\.`token`|`u`\.`password`/);
                return target.$queryRaw(sql);
              };
            const value = Reflect.get(target, key, receiver);
            if (["remoteTerminalEntitlementToken", "user", "remoteTerminalProductTemplate"].includes(String(key)))
              return new Proxy(value, {
                get(delegate, method, delegateReceiver) {
                  if (method === "findMany")
                    return (args: any) => {
                      selects.push(args.select);
                      return delegate.findMany(args);
                    };
                  return Reflect.get(delegate, method, delegateReceiver);
                },
              });
            return value;
          },
        });
        return callback(wrapped);
      }, options)) as any);
    await read();
    for (const [sql] of raw.mock.calls) expect((sql as any).sql).not.toMatch(/`k`\.`token`|`u`\.`password`/);
    expect(selects).toContainEqual({ id: true, username: true });
    expect(selects.some((select: any) => select?.label && !select?.token)).toBe(true);
  });
  it("rejects corrupted cross-owner device bindings", async () => {
    await prisma.remoteTerminalDeviceBinding.update({ where: { id: bindingId }, data: { userId: owner } });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["primary", "username", "template", "token", "binding"])(
    "rejects %s edits without a parent timestamp change",
    async (kind) => {
      const repository = PlatformTerminalEntitlementReadRepository.getInstance(),
        original = repository.hydrate.bind(repository);
      vi.spyOn(repository, "hydrate").mockImplementationOnce(async (...args) => {
        const result = await original(...args);
        if (kind === "primary")
          await prisma.remoteTerminalUserEntitlement.update({
            where: { id: entitlementId },
            data: {
              note: "changed",
              updateTime: result.find((row) => row.record.id === entitlementId)!.record.updateTime,
            },
          });
        if (kind === "username")
          await prisma.user.update({ where: { id: customer }, data: { username: "changed-" + randomUUID() } });
        if (kind === "template")
          await prisma.remoteTerminalProductTemplate.update({
            where: { id: templateId },
            data: { name: "changed-" + randomUUID() },
          });
        if (kind === "token")
          await prisma.remoteTerminalEntitlementToken.update({ where: { id: tokenId }, data: { label: "changed" } });
        if (kind === "binding")
          await prisma.remoteTerminalDeviceBinding.update({ where: { id: bindingId }, data: { status: -1 } });
        return result;
      });
      await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("rejects a persisted global group change during hydration", async () => {
    const repository = PlatformTerminalEntitlementReadRepository.getInstance(),
      original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      return result;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires authenticated HTTP context for native public service calls", async () => {
    await expect(RemoteTerminalProductService.getInstance().listEntitlements(1, 20)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rejects unsafe filters before querying metadata", async () => {
    await expect(read(1, 20, { userId: "bad/id" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(read(1, 20, { status: 3 })).rejects.toMatchObject({ statusCode: 403 });
  });
});
