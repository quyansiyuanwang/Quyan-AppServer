import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import { RemoteTerminalProductRepository } from "@/store/remote-terminal-product/remote-terminal-product.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  remoteTerminalProductEntitlementArn,
  remoteTerminalProductBindingArn,
  remoteTerminalProductRegistrationTokenArn,
  remoteTerminalPublishedTemplateArn,
} from "@/iam/resources/remote-terminal-resources";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
let owner: string,
  actor: string,
  peer: string,
  template: string,
  entitlements: string[],
  bindings: string[],
  token: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "personal-read-" + randomUUID(),
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
  RemoteTerminalProductService.getInstance().listCurrentUserEntitlements(actor, page, pageSize, undefined, request());
async function deny(resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:remote_terminal:ListMyEntitlements", Resource: resource },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "personal-read-deny-" + randomUUID(),
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
  template = (
    await prisma.remoteTerminalProductTemplate.create({
      data: { name: "fixture-list-" + randomUUID(), devicePrice: 1, publishStatus: "published" },
    })
  ).id;
  entitlements = [];
  for (const [index, userId] of [actor, actor, peer].entries())
    entitlements.push(
      (
        await prisma.remoteTerminalUserEntitlement.create({
          data: {
            userId,
            templateId: template,
            assignedBy: userId,
            name: "fixture entitlement " + index,
            startAt: new Date("2026-01-01"),
            endAt: new Date(Date.UTC(2027, index, 1)),
            deviceLimit: 2,
            terminalLimit: 1,
          },
        })
      ).id,
    );
  token = (
    await prisma.remoteTerminalEntitlementToken.create({
      data: { entitlementId: entitlements[0]!, token: "PRIVATE-CREDENTIAL-" + randomUUID() },
    })
  ).id;
  bindings = [];
  for (let index = 0; index < 2; index++)
    bindings.push(
      (
        await prisma.remoteTerminalDeviceBinding.create({
          data: {
            entitlementId: entitlements[0]!,
            userId: actor,
            deviceId: "fixture-" + randomUUID(),
            fingerprint: randomUUID(),
            hostname: "fixture host",
            platform: "linux",
            arch: "x64",
            heartbeatToken: "PRIVATE-HEARTBEAT-FIXTURE",
            snapshot: {},
            registeredAt: new Date(),
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
describe("personal terminal entitlement resource projection", () => {
  it("returns only own rows and never hydrates registration secrets or legacy relations", async () => {
    const legacy = vi.spyOn(RemoteTerminalProductRepository.getInstance(), "listEntitlements"),
      selected = vi.spyOn(prisma.remoteTerminalEntitlementToken, "findUnique");
    const result = await read();
    expect(result.total).toBe(2);
    expect(result.records.map((row) => row.id)).toEqual(entitlements.slice(0, 2));
    expect(result.records[0]).toMatchObject({ registeredDeviceCount: 2, registrationToken: { id: token } });
    expect(result.records[0]!.registrationToken!.token).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("PRIVATE-");
    expect(legacy).not.toHaveBeenCalled();
    expect(selected.mock.calls.every(([input]) => !input.select || !("token" in input.select))).toBe(true);
  });
  it("filters primary Deny before counting and paging", async () => {
    await deny(remoteTerminalProductEntitlementArn(owner, actor, entitlements[0]!));
    const result = await read(1, 1);
    expect(result.total).toBe(1);
    expect(result.records.map((row) => row.id)).toEqual([entitlements[1]]);
    expect((await read(2, 1)).records).toEqual([]);
  });
  it("returns an empty collection when every entitlement is denied", async () => {
    await deny("acs:remote-terminal:*:" + owner + ":product-entitlement/" + actor + "/*");
    expect(await read()).toMatchObject({ total: 0, records: [] });
  });
  it("omits token metadata when its resource is denied", async () => {
    await deny(remoteTerminalProductRegistrationTokenArn(owner, actor, entitlements[0]!, token));
    expect((await read()).records[0]!.registrationToken).toBeUndefined();
  });
  it("omits the full registered-device count when any contributor is denied", async () => {
    await deny(remoteTerminalProductBindingArn(owner, actor, bindings[0]!));
    const result = await read();
    expect(result.records[0]!.registeredDeviceCount).toBeUndefined();
    expect(result.records[1]!.registeredDeviceCount).toBe(0);
  });
  it("omits independently denied published template names", async () => {
    await deny(remoteTerminalPublishedTemplateArn(owner, actor, template));
    expect((await read()).records.every((row) => row.templateName === undefined)).toBe(true);
  });
  it("does not expose cross-account assigning-user names", async () => {
    const external = await user();
    await prisma.remoteTerminalUserEntitlement.update({
      where: { id: entitlements[0] },
      data: { assignedBy: external },
    });
    expect((await read()).records[0]!.assignedByUsername).toBeUndefined();
  });
  it("refuses a mismatched contributing device owner", async () => {
    await prisma.remoteTerminalDeviceBinding.update({ where: { id: bindings[0] }, data: { userId: peer } });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("reevaluates conditions before returning a previously allowed record", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam),
      resource = remoteTerminalProductEntitlementArn(owner, actor, entitlements[0]!);
    let seen = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const results = await original(input);
      if (input.resources.includes(resource) && ++seen > 1)
        return results.map((result, index) =>
          input.resources[index] === resource
            ? { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] }
            : result,
        );
      return results;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
});
