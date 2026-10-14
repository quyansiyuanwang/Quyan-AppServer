import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import { RemoteTerminalProductRepository } from "@/store/remote-terminal-product/remote-terminal-product.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  remoteTerminalProductEntitlementArn,
  remoteTerminalProductBindingArn,
  remoteTerminalProductRegistrationTokenArn,
} from "@/iam/resources/remote-terminal-resources";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
let owner: string,
  actor: string,
  peer: string,
  entitlement: string,
  peerEntitlement: string,
  token: string,
  bindings: string[];
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "device-list-" + randomUUID(),
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
const read = (page = 1, pageSize = 10) =>
  RemoteTerminalProductService.getInstance().listCurrentUserDevices(actor, page, pageSize, undefined, request());
async function deny(resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:remote_terminal:ListMyDevices", Resource: resource },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "device-list-deny-" + randomUUID(),
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
  peer = await user(owner);
  const createEntitlement = async (userId: string) =>
    (
      await prisma.remoteTerminalUserEntitlement.create({
        data: {
          userId,
          name: "fixture entitlement",
          startAt: new Date("2026-01-01"),
          endAt: new Date("2027-01-01"),
          deviceLimit: 2,
          terminalLimit: 1,
        },
      })
    ).id;
  entitlement = await createEntitlement(actor);
  peerEntitlement = await createEntitlement(peer);
  token = (
    await prisma.remoteTerminalEntitlementToken.create({
      data: { entitlementId: entitlement, token: "PRIVATE-CREDENTIAL-" + randomUUID() },
    })
  ).id;
  bindings = [];
  for (const [index, userId] of [actor, actor, peer].entries())
    bindings.push(
      (
        await prisma.remoteTerminalDeviceBinding.create({
          data: {
            entitlementId: userId === actor ? entitlement : peerEntitlement,
            userId,
            registrationTokenId: userId === actor ? token : null,
            deviceId: "fixture-" + randomUUID(),
            fingerprint: randomUUID(),
            hostname: "fixture host " + index,
            platform: "linux",
            arch: "x64",
            heartbeatToken: "PRIVATE-HEARTBEAT-FIXTURE",
            snapshot: { diagnostics: { availableShells: ["bash"] }, credentials: "PRIVATE-SNAPSHOT-FIXTURE" },
            registeredAt: new Date(Date.UTC(2026, 9 - index, 1)),
            lastSeenAt: new Date(),
          },
        })
      ).id,
    );
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
});
describe("personal terminal device resource projection", () => {
  it("lists own devices without heartbeat tokens, registration secrets or private snapshots", async () => {
    const legacy = vi.spyOn(RemoteTerminalProductRepository.getInstance(), "listDeviceBindings"),
      select = vi.spyOn(prisma.remoteTerminalDeviceBinding, "findFirst");
    const result = await read();
    expect(result.total).toBe(2);
    expect(result.records.map((row) => row.id)).toEqual(bindings.slice(0, 2));
    expect(result.records[0]).toMatchObject({
      availableShells: ["bash"],
      entitlementName: "fixture entitlement",
      registrationTokenId: token,
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE-");
    expect(legacy).not.toHaveBeenCalled();
    expect(
      select.mock.calls.every(
        ([input]) => input?.select && !("heartbeatToken" in input.select) && !("snapshot" in input.select),
      ),
    ).toBe(true);
  });
  it("filters primary Deny before totals and pagination", async () => {
    await deny(remoteTerminalProductBindingArn(owner, actor, bindings[0]!));
    const result = await read(1, 1);
    expect(result.total).toBe(1);
    expect(result.records.map((row) => row.id)).toEqual([bindings[1]]);
    expect((await read(2, 1)).records).toEqual([]);
  });
  it("returns an empty list for a binding wildcard Deny", async () => {
    await deny("acs:remote-terminal:*:" + owner + ":product-binding/" + actor + "/*");
    expect(await read()).toMatchObject({ total: 0, records: [] });
  });
  it("omits a denied parent entitlement name without widening device authorization", async () => {
    await deny(remoteTerminalProductEntitlementArn(owner, actor, entitlement));
    expect((await read()).records.every((row) => row.entitlementName === undefined)).toBe(true);
  });
  it("omits denied token references", async () => {
    await deny(remoteTerminalProductRegistrationTokenArn(owner, actor, entitlement, token));
    expect((await read()).records.every((row) => row.registrationTokenId === undefined)).toBe(true);
  });
  it("omits denied user names", async () => {
    await deny("acs:quyan:*:" + owner + ":user/" + actor);
    expect((await read()).records.every((row) => row.username === undefined)).toBe(true);
  });
  it("refuses corrupted parent ownership", async () => {
    await prisma.remoteTerminalDeviceBinding.update({
      where: { id: bindings[0] },
      data: { entitlementId: peerEntitlement },
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses a token reference pointing at another entitlement", async () => {
    const foreign = await prisma.remoteTerminalEntitlementToken.create({
      data: { entitlementId: peerEntitlement, token: "PRIVATE-PEER-TOKEN-" + randomUUID() },
    });
    await prisma.remoteTerminalDeviceBinding.update({
      where: { id: bindings[0] },
      data: { registrationTokenId: foreign.id },
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
});
