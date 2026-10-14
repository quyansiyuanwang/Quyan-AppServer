import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { Permission } from "@quyan/shared";
import { PlatformTerminalDeviceReadIamService } from "@/services/remote-terminal/platform-terminal-device-read-iam.service";
import { PlatformTerminalDeviceReadRepository } from "@/store/remote-terminal-product/platform-terminal-device-read.repository";
import { PLATFORM_TERMINAL_DEVICE_PUBLIC_SELECT } from "@/store/remote-terminal-product/platform-terminal-device-read.store";
import {
  platformTerminalBindingArn,
  platformTerminalEntitlementArn,
} from "@/iam/resources/platform-terminal-entitlement-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import type { TypedRequest } from "@/types/express";
const action = "quyan:remote_terminal:ListDeviceBindings",
  originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, customer: string, groupId: string, entitlementId: string, bindingIds: string[];
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "device-management-" + randomUUID(),
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
  PlatformTerminalDeviceReadIamService.getInstance().list(
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
    name: "device-deny-" + randomUUID(),
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
        username: "device-global-" + randomUUID(),
        name: "fixture global device management",
        level: 0,
        accountOwnerId: null,
        permissions: [Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  entitlementId = (
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
  bindingIds = [];
  for (let index = 0; index < 2; index++)
    bindingIds.push(
      (
        await prisma.remoteTerminalDeviceBinding.create({
          data: {
            entitlementId,
            userId: customer,
            deviceId: "fixture-device-" + randomUUID(),
            fingerprint: randomUUID(),
            hostname: "fixture host-" + index,
            platform: "linux",
            arch: "x64",
            snapshot: { diagnostics: { availableShells: ["bash"] }, private: "PRIVATE-SNAPSHOT-FIXTURE" },
            heartbeatToken: "PRIVATE-HEARTBEAT-FIXTURE",
            registeredAt: new Date(),
            lastSeenAt: new Date("2026-02-0" + (index + 1)),
            createTime: new Date("2026-01-0" + (2 - index)),
          },
        })
      ).id,
    );
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
  await prisma.remoteTerminalUserEntitlement.deleteMany({ where: { id: entitlementId } });
});
describe("persisted platform terminal device projections", () => {
  it("qualifies cross-account management and hydrates only the page in last-seen order", async () => {
    const hydrate = vi.spyOn(PlatformTerminalDeviceReadRepository.getInstance(), "hydrate");
    expect(await read(1, 1)).toMatchObject({
      total: 2,
      records: [
        {
          record: { id: bindingIds[1], userId: customer },
          availableShells: ["bash"],
          entitlementName: "fixture entitlement",
        },
      ],
    });
    expect(hydrate.mock.calls[0]![1].map((row) => row.target.id)).toEqual([bindingIds[1]]);
  });
  it("projects the existing device DTO without snapshot or heartbeat credentials", async () => {
    const result = await RemoteTerminalProductService.getInstance().listDevices(
      1,
      20,
      customer,
      undefined,
      undefined,
      request(),
    );
    expect(result.total).toBe(2);
    expect(result.records[0]).toMatchObject({
      id: bindingIds[1],
      hostname: "fixture host-1",
      availableShells: ["bash"],
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain("PRIVATE-HEARTBEAT-FIXTURE");
    expect(text).not.toContain("PRIVATE-SNAPSHOT-FIXTURE");
    expect(result.records[0]).not.toHaveProperty("heartbeatToken");
    expect(result.records[0]).not.toHaveProperty("snapshot");
  });
  it("removes primary Deny before counting or reading protected fields", async () => {
    await deny(platformTerminalBindingArn(customer, bindingIds[1]!));
    expect(await read(1, 1)).toMatchObject({ total: 1, records: [{ record: { id: bindingIds[0] } }] });
  });
  it.each(["username", "entitlementName"] as const)(
    "omits denied %s while preserving the device record",
    async (key) => {
      await deny(
        key === "username" ? platformUserArn(customer) : platformTerminalEntitlementArn(customer, entitlementId),
      );
      const result = await read(1, 1);
      expect(result.total).toBe(2);
      expect(result.records[0]![key]).toBeUndefined();
    },
  );
  it("returns no records without a matching Allow", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockResolvedValue([]);
    expect(await read()).toMatchObject({ total: 0, records: [] });
  });
  it("does not select the heartbeat column or load full snapshots", async () => {
    const raw = vi.spyOn(prisma, "$queryRaw"),
      transaction = prisma.$transaction.bind(prisma),
      selects: unknown[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((callback: any, options: any) =>
      transaction(async (tx) => {
        return callback(
          new Proxy(tx, {
            get(target, key, receiver) {
              if (key === "$queryRaw")
                return (sql: any) => {
                  expect(sql.sql).not.toMatch(/`t`\.`heartbeatToken`|`u`\.`password`/);
                  return target.$queryRaw(sql);
                };
              const value = Reflect.get(target, key, receiver);
              if (key === "remoteTerminalDeviceBinding")
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
          }),
        );
      }, options)) as any);
    await read();
    expect(selects).toContainEqual(PLATFORM_TERMINAL_DEVICE_PUBLIC_SELECT);
    expect(selects.some((select: any) => select?.heartbeatToken || select?.snapshot)).toBe(false);
    for (const [sql] of raw.mock.calls) expect((sql as any).sql).not.toMatch(/`t`\.`heartbeatToken`|`u`\.`password`/);
  });
  it("rejects bindings whose user differs from the entitlement owner", async () => {
    await prisma.remoteTerminalDeviceBinding.update({ where: { id: bindingIds[0] }, data: { userId: owner } });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["record", "shells", "username", "entitlement"])(
    "rejects %s changes while the device timestamp remains unchanged",
    async (kind) => {
      const repository = PlatformTerminalDeviceReadRepository.getInstance(),
        original = repository.hydrate.bind(repository);
      vi.spyOn(repository, "hydrate").mockImplementationOnce(async (...args) => {
        const result = await original(...args),
          device = result.find((row) => row.record.id === bindingIds[0])!.record;
        if (kind === "record")
          await prisma.remoteTerminalDeviceBinding.update({
            where: { id: device.id },
            data: { hostname: "changed", updateTime: device.updateTime },
          });
        if (kind === "shells")
          await prisma.remoteTerminalDeviceBinding.update({
            where: { id: device.id },
            data: { snapshot: { diagnostics: { availableShells: ["sh"] } }, updateTime: device.updateTime },
          });
        if (kind === "username")
          await prisma.user.update({ where: { id: customer }, data: { username: "changed-" + randomUUID() } });
        if (kind === "entitlement")
          await prisma.remoteTerminalUserEntitlement.update({
            where: { id: entitlementId },
            data: { name: "changed" },
          });
        return result;
      });
      await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("ignores unrelated snapshot fields and credential values that do not contribute to the response", async () => {
    const repository = PlatformTerminalDeviceReadRepository.getInstance(),
      original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementationOnce(async (...args) => {
      const result = await original(...args),
        device = result.find((row) => row.record.id === bindingIds[0])!.record;
      await prisma.remoteTerminalDeviceBinding.update({
        where: { id: device.id },
        data: {
          snapshot: { diagnostics: { availableShells: ["bash"] }, private: "CHANGED-PRIVATE-FIXTURE" },
          heartbeatToken: "CHANGED-CREDENTIAL-FIXTURE",
          updateTime: device.updateTime,
        },
      });
      return result;
    });
    const result = await read();
    expect(result.total).toBe(2);
    expect(JSON.stringify(result)).not.toContain("PRIVATE-FIXTURE");
    expect(JSON.stringify(result)).not.toContain("CREDENTIAL-FIXTURE");
  });
  it("rejects data changes between metadata authorization and the row lock", async () => {
    const repository = PlatformTerminalDeviceReadRepository.getInstance(),
      original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementationOnce(async (...args) => {
      await prisma.remoteTerminalDeviceBinding.update({
        where: { id: bindingIds[0] },
        data: { hostname: "changed before hydration" },
      });
      return original(...args);
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects global ceiling revocation during hydration", async () => {
    const repository = PlatformTerminalDeviceReadRepository.getInstance(),
      original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      return result;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires request context for native admin service calls", async () => {
    await expect(RemoteTerminalProductService.getInstance().listDevices(1, 20)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("preserves the separate personal view instead of dispatching to platform administration", async () => {
    const result = await RemoteTerminalProductService.getInstance().listCurrentUserDevices(customer, 1, 20);
    expect(result.total).toBe(2);
    expect(result.records.every((row) => row.userId === customer)).toBe(true);
  });
  it("validates resource filters before metadata reads", async () => {
    await expect(read(1, 20, { entitlementId: "bad/id" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(read(1, 20, { status: 3 })).rejects.toMatchObject({ statusCode: 403 });
  });
});
