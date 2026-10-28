import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { prisma } from "@/config/database";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  remoteTerminalProductEntitlementArn,
  remoteTerminalProductBindingArn,
  remoteTerminalProductRegistrationTokenArn,
  remoteTerminalPublishedTemplateArn,
} from "@/iam/resources/remote-terminal-resources";
import type { IamPrincipal } from "@quyan/shared";
const groups = RamResourceGroupRepository.getInstance();
let owner: string,
  actor: string,
  peer: string,
  foreign: string,
  entitlement: string,
  otherEntitlement: string,
  binding: string,
  token: string,
  template: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "terminal-group-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const arns = () => [
  remoteTerminalProductEntitlementArn(owner, actor, entitlement),
  remoteTerminalProductBindingArn(owner, actor, binding),
  remoteTerminalProductRegistrationTokenArn(owner, actor, entitlement, token),
  remoteTerminalPublishedTemplateArn(owner, actor, template),
];
const exists = (resource: string, account = owner) => groups.resourceExistsInAccount(resource, account);
beforeEach(async () => {
  vi.restoreAllMocks();
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
  const create = async (userId: string) =>
    (
      await prisma.remoteTerminalUserEntitlement.create({
        data: {
          userId,
          name: "fixture group entitlement",
          startAt: new Date("2026-01-01"),
          endAt: new Date("2026-02-01"),
          deviceLimit: 1,
          terminalLimit: 1,
        },
      })
    ).id;
  entitlement = await create(actor);
  otherEntitlement = await create(peer);
  token = (
    await prisma.remoteTerminalEntitlementToken.create({
      data: { entitlementId: entitlement, token: "PRIVATE-GROUP-TOKEN-" + randomUUID() },
    })
  ).id;
  binding = (
    await prisma.remoteTerminalDeviceBinding.create({
      data: {
        entitlementId: entitlement,
        userId: actor,
        registrationTokenId: token,
        deviceId: randomUUID(),
        fingerprint: randomUUID(),
        hostname: "fixture host",
        platform: "linux",
        arch: "x64",
        heartbeatToken: "PRIVATE-HEARTBEAT-TOKEN",
        snapshot: { privateFixture: "PRIVATE-SNAPSHOT" },
        registeredAt: new Date(),
        lastSeenAt: new Date(),
      },
    })
  ).id;
  template = (
    await prisma.remoteTerminalProductTemplate.create({
      data: { name: "terminal-group-offer-" + randomUUID(), status: 1, publishStatus: "published" },
    })
  ).id;
});
afterEach(() => vi.restoreAllMocks());
describe("terminal product resource-group ownership", () => {
  it("resolves all four product resources using metadata rather than existing credentials", async () => {
    const select = vi.spyOn(prisma.remoteTerminalEntitlementToken, "findFirst");
    for (const arn of arns()) expect(await exists(arn)).toBe(true);
    expect(select.mock.calls.every(([input]) => input?.select && !("token" in input.select))).toBe(true);
  });
  it("rejects foreign accounts, peer identity aliases and case aliases", async () => {
    for (const arn of arns()) {
      expect(await exists(arn, foreign)).toBe(false);
      expect(await exists(arn.replace(":" + owner + ":", ":" + foreign + ":"), foreign)).toBe(false);
      expect(await exists(arn.replace("/" + actor + "/", "/" + peer + "/"))).toBe(arn.includes("published-template/"));
      const parts = arn.split("/");
      parts[parts.length - 1] = parts[parts.length - 1]!.toUpperCase();
      expect(await exists(parts.join("/"))).toBe(false);
    }
  });
  it("keeps disabled and expired product metadata addressable but rejects deleted parents", async () => {
    await prisma.remoteTerminalUserEntitlement.update({ where: { id: entitlement }, data: { status: 0 } });
    for (const arn of arns().slice(0, 3)) expect(await exists(arn)).toBe(true);
    await prisma.remoteTerminalUserEntitlement.update({ where: { id: entitlement }, data: { status: -1 } });
    for (const arn of arns().slice(0, 3)) expect(await exists(arn)).toBe(false);
  });
  it("rejects inconsistent binding parents and incorrect token parent paths", async () => {
    await prisma.remoteTerminalDeviceBinding.update({
      where: { id: binding },
      data: { entitlementId: otherEntitlement },
    });
    expect(await exists(arns()[1]!)).toBe(false);
    expect(await exists(remoteTerminalProductRegistrationTokenArn(owner, actor, otherEntitlement, token))).toBe(false);
    expect(
      await exists(remoteTerminalProductRegistrationTokenArn(owner, actor, entitlement.toUpperCase(), token)),
    ).toBe(false);
  });
  it("does not accept unpublished offers or disabled user projections", async () => {
    await prisma.remoteTerminalProductTemplate.update({ where: { id: template }, data: { publishStatus: "draft" } });
    expect(await exists(arns()[3]!)).toBe(false);
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    for (const arn of arns()) expect(await exists(arn)).toBe(false);
  });
  it("reevaluates scoped product Deny immediately after membership removal", async () => {
    const arn = arns()[1]!,
      action = "quyan:remote_terminal:ListMyDevices";
    const group = await groups.create({ accountOwnerId: owner, name: "terminal-group-" + randomUUID() });
    const member = await groups.addMember({
      accountOwnerId: owner,
      resourceGroupId: group.id,
      resourceArn: arn,
      service: "remote-terminal",
      resourceType: "product-binding",
      resourceId: actor + "/" + binding,
    });
    const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: arn } });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "terminal-group-deny-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: owner,
        principalType: "user",
        principalId: actor,
        policyId: policy.id,
        scopeType: "resource-group",
        scopeResourceId: group.id,
        scopeKey: "resource-group:" + group.id,
        createdBy: owner,
      },
    });
    const principal: IamPrincipal = {
        subjectUserId: actor,
        principalUserId: actor,
        accountOwnerId: owner,
        subjectType: "sub_user",
      },
      iam = IamAuthorizationService.getInstance();
    expect((await iam.authorize({ principal, action, resource: arn })).decision).toBe("ExplicitDeny");
    await groups.removeMember(group.id, member.id);
    expect((await iam.authorize({ principal, action, resource: arn })).decision).toBe("Allow");
  });
});
