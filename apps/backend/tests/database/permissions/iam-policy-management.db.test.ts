import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { IamPolicyDocument, IamPrincipal } from "@quyan/shared";

const service = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
const document: IamPolicyDocument = {
  Version: "1",
  Statement: { Effect: "Allow", Action: "alidns:AddDomainRecord", Resource: "acs:alidns:*:*:domain/qrmr.cn" },
};

describe("RAM IAM policy management security", () => {
  let ownerId: string;
  let childId: string;
  let otherId: string;
  beforeEach(async () => {
    env.security.iamAuthorizationMode = "enforce";
    const user = async (prefix: string, accountOwnerId?: string) =>
      prisma.user.create({
        data: {
          username: prefix + randomUUID(),
          password: "test-fixture-only",
          accountOwnerId,
          parentUserId: accountOwnerId,
          userType: accountOwnerId ? "ram_user" : "root",
          permissionAdds: [],
          permissionRemoves: [],
        },
      });
    ownerId = (await user("iam-root-")).id;
    childId = (await user("iam-child-", ownerId)).id;
    otherId = (await user("iam-other-")).id;
  });
  afterEach(() => {
    env.security.iamAuthorizationMode = originalMode;
  });
  const principal = (userId: string, owner: string): IamPrincipal => ({
    subjectUserId: userId,
    principalUserId: userId,
    accountOwnerId: owner,
    subjectType: userId === owner ? "root" : "sub_user",
  });
  it("validates strict syntax and reports broad wildcard risk without saving a policy", async () => {
    const result = await service.validatePolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "*", Resource: "*" },
    });
    expect(result.valid).toBe(true);
    expect(result.broadWildcard).toBe(true);
    await expect(service.validatePolicy({ ...document, Condition: {} } as IamPolicyDocument)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await prisma.ramPolicy.count({ where: { accountOwnerId: ownerId } })).toBe(0);
  });
  it("requires enforce mode for document management and rejects subuser delegation", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await expect(service.createPolicy(ownerId, { name: "shadow", document })).rejects.toMatchObject({
      statusCode: 403,
    });
    env.security.iamAuthorizationMode = "enforce";
    await expect(service.createPolicy(childId, { name: "subuser", document })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.ramPolicy.count({ where: { accountOwnerId: ownerId } })).toBe(0);
  });
  it("appends validated versions, requires the current hash, and can restore the initial default", async () => {
    const first = await service.createPolicy(ownerId, { name: "history", document });
    expect(first.permissions).toEqual([]);
    expect(first.defaultVersion).toBe(1);
    await expect(service.updatePolicy(ownerId, first.id, { document })).rejects.toMatchObject({ statusCode: 409 });
    const deny: IamPolicyDocument = { Version: "1", Statement: { Effect: "Deny", Action: "*", Resource: "*" } };
    const second = await service.updatePolicy(ownerId, first.id, {
      document: deny,
      expectedDocumentHash: first.documentHash,
    });
    expect(second.defaultVersion).toBe(2);
    const versions = await service.listPolicyVersions(ownerId, first.id);
    expect(versions.map((item) => item.isDefault)).toEqual([true, false]);
    await service.setDefaultPolicyVersion(ownerId, first.id, versions[1].id, second.documentHash!);
    expect((await service.listPolicyVersions(ownerId, first.id)).map((item) => item.isDefault)).toEqual([false, true]);
  });
  it("rejects format downgrades and mixed formats", async () => {
    const policy = await service.createPolicy(ownerId, { name: "formats", document });
    await expect(service.updatePolicy(ownerId, policy.id, { permissions: [] })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(service.updatePolicy(ownerId, policy.id, { permissions: [], document })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(service.createPolicy(ownerId, { name: "mixed", permissions: [], document })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
  it("preserves legacy shadow permissions when converting an existing policy", async () => {
    const old = await prisma.ramPolicy.create({
      data: { accountOwnerId: ownerId, name: "legacy", activeName: "legacy", permissions: [Permission.USER_READ] },
    });
    const converted = await service.updatePolicy(ownerId, old.id, { document });
    expect(converted.permissions).toEqual([Permission.USER_READ]);
    expect(converted.defaultVersion).toBe(1);
  });
  it("rejects cross-account version reads, attachments and simulation", async () => {
    const policy = await service.createPolicy(ownerId, { name: "scoped", document });
    await expect(service.listPolicyVersions(otherId, policy.id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.attachPolicy(ownerId, { policyId: policy.id, targetType: "user", targetId: otherId }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.simulatePolicy(ownerId, otherId, "alidns:AddDomainRecord", "*")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.ramPolicyAttachment.count({ where: { policyId: policy.id } })).toBe(0);
  });
  it("honors a user attachment, domain scoping and revocation immediately", async () => {
    const policy = await service.createPolicy(ownerId, { name: "user-policy", document });
    await service.attachPolicy(ownerId, { policyId: policy.id, targetType: "user", targetId: childId });
    const resource = "acs:alidns:*:" + ownerId + ":domain/qrmr.cn";
    expect((await service.simulatePolicy(ownerId, childId, "alidns:AddDomainRecord", resource)).decision).toBe("Allow");
    expect(
      (
        await service.simulatePolicy(
          ownerId,
          childId,
          "alidns:AddDomainRecord",
          resource.replace("qrmr.cn", "other.cn"),
        )
      ).decision,
    ).toBe("ImplicitDeny");
    await service.detachPolicy(ownerId, { policyId: policy.id, targetType: "user", targetId: childId });
    expect((await service.simulatePolicy(ownerId, childId, "alidns:AddDomainRecord", resource)).decision).toBe(
      "ImplicitDeny",
    );
  });
  it("merges group, bound-role and assumed-role policies with Deny priority and revoked sessions", async () => {
    const group = await prisma.group.create({
      data: { username: "iam-group-" + randomUUID(), accountOwnerId: ownerId, permissions: [] },
    });
    await prisma.user.update({ where: { id: childId }, data: { groupId: group.id } });
    const role = await prisma.ramRole.create({ data: { accountOwnerId: ownerId, name: "iam-role" } });
    await prisma.ramGroupRoleBinding.create({ data: { accountOwnerId: ownerId, groupId: group.id, roleId: role.id } });
    const allow = await service.createPolicy(ownerId, { name: "role-allow", document });
    await service.attachPolicy(ownerId, { policyId: allow.id, targetType: "role", targetId: role.id });
    const resource = "acs:alidns:*:" + ownerId + ":domain/qrmr.cn";
    expect((await service.simulatePolicy(ownerId, childId, "alidns:AddDomainRecord", resource)).decision).toBe("Allow");
    await prisma.ramGroupRoleBinding.deleteMany({ where: { roleId: role.id } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: ownerId,
        subjectUserId: childId,
        roleId: role.id,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const assumed: IamPrincipal = {
      ...principal(childId, ownerId),
      subjectType: "assumed_role",
      assumedRoleId: role.id,
      roleSessionId: session.id,
    };
    const request = { principal: assumed, action: "alidns:AddDomainRecord", resource };
    expect((await IamAuthorizationService.getInstance().authorize(request)).decision).toBe("Allow");
    const deny = await service.createPolicy(ownerId, {
      name: "group-deny",
      document: { Version: "1", Statement: { Effect: "Deny", Action: "alidns:*", Resource: "*" } },
    });
    await service.attachPolicy(ownerId, { policyId: deny.id, targetType: "group", targetId: group.id });
    expect((await IamAuthorizationService.getInstance().authorize(request)).decision).toBe("ExplicitDeny");
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { status: 0 } });
    await expect(IamAuthorizationService.getInstance().authorize(request)).rejects.toMatchObject({ statusCode: 403 });
  });
});
