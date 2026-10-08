import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { IamPolicyDocument, IamPrincipal } from "@quyan/shared";

import { RamController } from "@/api/controllers/v1/users/ram.controller";
import * as requestContext from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const service = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
const document: IamPolicyDocument = {
  Version: "1",
  Statement: { Effect: "Allow", Action: "quyan:ram:CreateUser", Resource: "acs:quyan:*:*:user/qrmr.cn" },
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
    vi.restoreAllMocks();
  });
  const principal = (userId: string, owner: string): IamPrincipal => ({
    subjectUserId: userId,
    principalUserId: userId,
    accountOwnerId: owner,
    subjectType: userId === owner ? "root" : "sub_user",
  });
  it.each([Permission.RAM_POLICY_CREATE, Permission.RAM_POLICY_UPDATE])(
    "allows document validation with either create or update permission: %s",
    async (permission) => {
      await prisma.user.update({ where: { id: ownerId }, data: { permissionAdds: [permission] } });
      const request = {
        user: { userId: ownerId, status: 1, updatedAt: new Date().toISOString() },
        authContext: { principalUserId: ownerId, accountOwnerId: ownerId, subjectType: "root" },
      } as TypedRequest;
      vi.spyOn(requestContext, "getRequestContext").mockReturnValue(request);
      expect((await new RamController().validatePolicy({ document })).valid).toBe(true);
    },
  );
  it("diagnoses malformed original text through the authenticated Controller without saving it", async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { permissionAdds: [Permission.RAM_POLICY_CREATE] } });
    const request = {
      user: { userId: ownerId, status: 1 },
      authContext: { principalUserId: ownerId, accountOwnerId: ownerId, subjectType: "root" },
    } as TypedRequest;
    vi.spyOn(requestContext, "getRequestContext").mockReturnValue(request);
    const result = await new RamController().diagnosePolicy({ documentText: "{\n!" }, request);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({ code: "json-syntax", line: 2, column: 1 });
    expect(await prisma.ramPolicy.count({ where: { accountOwnerId: ownerId } })).toBe(0);
  });
  it("rejects foreign-account resource policies even when the publisher owns this account", async () => {
    await expect(
      service.createPolicy(ownerId, {
        name: "foreign-resource",
        document: {
          Version: "1",
          Statement: {
            Effect: "Allow",
            Action: "quyan:ram:ReadUser",
            Resource: "acs:quyan:*:" + otherId + ":user/target",
          },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(
      (await service.simulatePolicy(ownerId, childId, "quyan:ram:ReadUser", "acs:quyan:*:" + otherId + ":user/target"))
        .decision,
    ).toBe("ImplicitDeny");
    expect(await prisma.ramPolicy.count({ where: { accountOwnerId: ownerId } })).toBe(0);
  });
  it("rejects document validation without either permission", async () => {
    const request = {
      user: { userId: ownerId, status: 1, updatedAt: new Date().toISOString() },
      authContext: { principalUserId: ownerId, accountOwnerId: ownerId, subjectType: "root" },
    } as TypedRequest;
    vi.spyOn(requestContext, "getRequestContext").mockReturnValue(request);
    await expect(new RamController().validatePolicy({ document })).rejects.toMatchObject({ statusCode: 403 });
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
  it("allows a sub-user to delegate only covered resource grants and refuses scope expansion", async () => {
    await prisma.user.update({
      where: { id: childId },
      data: { permissionAdds: [Permission.RAM_POLICY_CREATE, Permission.RAM_POLICY_ATTACH] },
    });
    const parent = await service.createPolicy(ownerId, {
      name: "delegator-source",
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:ram:UpdateUser",
          Resource: "acs:quyan:*:" + ownerId + ":user/*",
        },
      },
    });
    await service.attachPolicy(ownerId, { policyId: parent.id, targetType: "user", targetId: childId });
    const child = await service.createPolicy(childId, {
      name: "delegated-exact",
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:ram:UpdateUser",
          Resource: "acs:quyan:*:" + ownerId + ":user/" + childId,
        },
      },
    });
    await expect(
      service.attachPolicy(childId, { policyId: child.id, targetType: "user", targetId: childId }),
    ).resolves.toBeUndefined();
    await expect(
      service.createPolicy(childId, {
        name: "delegated-broad",
        document: {
          Version: "1",
          Statement: {
            Effect: "Allow",
            Action: "quyan:ram:DeleteUser",
            Resource: "*",
          },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const before = await prisma.ramPolicyVersion.count({ where: { policyId: child.id } });
    await expect(
      service.updatePolicy(childId, child.id, {
        expectedDocumentHash: child.documentHash,
        document: {
          Version: "1",
          Statement: { Effect: "Allow", Action: "*", Resource: "*" },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.ramPolicyVersion.count({ where: { policyId: child.id } })).toBe(before);
  });
  it("prevents delegated Deny from locking the owner and prevents sub-user recovery-policy mutations", async () => {
    const recovery = await service.createPolicy(ownerId, {
      name: "recovery",
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "*",
          Resource: "*",
        },
      },
    });
    await service.attachPolicy(ownerId, { policyId: recovery.id, targetType: "user", targetId: ownerId });
    const deny = await service.createPolicy(childId, {
      name: "deny",
      document: {
        Version: "1",
        Statement: {
          Effect: "Deny",
          Action: "*",
          Resource: "*",
        },
      },
    });
    await expect(
      service.attachPolicy(childId, { policyId: deny.id, targetType: "user", targetId: ownerId }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.attachPolicy(ownerId, { policyId: deny.id, targetType: "user", targetId: ownerId }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.updatePolicy(ownerId, recovery.id, {
        expectedDocumentHash: recovery.documentHash,
        document: {
          Version: "1",
          Statement: { Effect: "Deny", Action: "*", Resource: "*" },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.deletePolicy(childId, recovery.id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.detachPolicy(childId, { policyId: recovery.id, targetType: "user", targetId: ownerId }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.ramPolicyAttachment.count({ where: { policyId: recovery.id, status: 1 } })).toBe(1);
  });
  it("persists conditional policies and evaluates server principal context without ignoring missing request attributes", async () => {
    const conditional = await service.createPolicy(ownerId, {
      name: "conditional",
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:ram:ReadUser",
          Resource: "*",
          Condition: { StringEquals: { "quyan:PrincipalId": childId } },
        },
      },
    });
    await service.attachPolicy(ownerId, { policyId: conditional.id, targetType: "user", targetId: childId });
    expect((await service.simulatePolicy(ownerId, childId, "quyan:ram:ReadUser", "*")).decision).toBe("Allow");
    await service.updatePolicy(ownerId, conditional.id, {
      expectedDocumentHash: conditional.documentHash,
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:ram:ReadUser",
          Resource: "*",
          Condition: { Bool: { "acs:SecureTransport": true } },
        },
      },
    });
    expect(await service.simulatePolicy(ownerId, childId, "quyan:ram:ReadUser", "*")).toMatchObject({
      decision: "ImplicitDeny",
      reason: "missing-condition-context",
    });
  });
  it("requires enforce mode for document management and rejects uncovered subuser delegation", async () => {
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
    expect(versions.items.map((item) => item.isDefault)).toEqual([true, false]);
    await service.setDefaultPolicyVersion(ownerId, first.id, versions.items[1].id, second.documentHash!);
    expect((await service.listPolicyVersions(ownerId, first.id)).items.map((item) => item.isDefault)).toEqual([
      false,
      true,
    ]);
  });
  it("paginates immutable history, includes the current hash on every page and excludes inactive versions", async () => {
    const first = await service.createPolicy(ownerId, { name: "paged-history", document });
    let current = first;
    for (const sid of ["second", "third"])
      current = await service.updatePolicy(ownerId, first.id, {
        document: { Version: "1", Statement: { Sid: sid, Effect: "Allow", Action: "quyan:ram:*", Resource: "*" } },
        expectedDocumentHash: current.documentHash,
      });
    const firstPage = await service.listPolicyVersions(ownerId, first.id, { page: 1, pageSize: 1 });
    const lastPage = await service.listPolicyVersions(ownerId, first.id, { page: 3, pageSize: 1 });
    expect(firstPage).toMatchObject({ total: 3, page: 1, pageSize: 1, defaultDocumentHash: current.documentHash });
    expect(firstPage.items.map((item) => item.version)).toEqual([3]);
    expect(lastPage.items.map((item) => item.version)).toEqual([1]);
    expect(lastPage.defaultDocumentHash).toBe(current.documentHash);
    expect((await service.listPolicyVersions(ownerId, first.id, { page: 4, pageSize: 1 })).items).toEqual([]);
    await expect(service.listPolicyVersions(ownerId, first.id, { page: 0 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.listPolicyVersions(ownerId, first.id, { pageSize: 101 })).rejects.toMatchObject({
      statusCode: 400,
    });
    // Restore a version outside page 1 without loading the entire history.
    await service.setDefaultPolicyVersion(ownerId, first.id, lastPage.items[0].id, current.documentHash!);
    await expect(
      service.setDefaultPolicyVersion(ownerId, first.id, firstPage.items[0].id, current.documentHash!),
    ).rejects.toMatchObject({ statusCode: 409 });
    await prisma.ramPolicyVersion.update({ where: { id: firstPage.items[0].id }, data: { status: 0 } });
    expect((await service.listPolicyVersions(ownerId, first.id)).total).toBe(2);
  });
  it("rejects corrupted version documents rather than displaying them as validated history", async () => {
    const first = await service.createPolicy(ownerId, { name: "corrupt-history", document });
    await prisma.ramPolicyVersion.update({
      where: { id: (await prisma.ramPolicy.findUniqueOrThrow({ where: { id: first.id } })).defaultVersionId! },
      data: { documentHash: "0".repeat(64) },
    });
    await expect(service.listPolicyVersions(ownerId, first.id)).rejects.toMatchObject({ statusCode: 403 });
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
    await expect(service.simulatePolicy(ownerId, otherId, "quyan:ram:CreateUser", "*")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.ramPolicyAttachment.count({ where: { policyId: policy.id } })).toBe(0);
  });
  it("honors a user attachment, domain scoping and revocation immediately", async () => {
    const policy = await service.createPolicy(ownerId, { name: "user-policy", document });
    await service.attachPolicy(ownerId, { policyId: policy.id, targetType: "user", targetId: childId });
    const resource = "acs:quyan:*:" + ownerId + ":user/qrmr.cn";
    expect((await service.simulatePolicy(ownerId, childId, "quyan:ram:CreateUser", resource)).decision).toBe("Allow");
    expect(
      (await service.simulatePolicy(ownerId, childId, "quyan:ram:CreateUser", resource.replace("qrmr.cn", "other.cn")))
        .decision,
    ).toBe("ImplicitDeny");
    await service.detachPolicy(ownerId, { policyId: policy.id, targetType: "user", targetId: childId });
    expect((await service.simulatePolicy(ownerId, childId, "quyan:ram:CreateUser", resource)).decision).toBe(
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
    const resource = "acs:quyan:*:" + ownerId + ":user/qrmr.cn";
    expect((await service.simulatePolicy(ownerId, childId, "quyan:ram:CreateUser", resource)).decision).toBe("Allow");
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
    const request = { principal: assumed, action: "quyan:ram:CreateUser", resource };
    expect((await IamAuthorizationService.getInstance().authorize(request)).decision).toBe("Allow");
    const deny = await service.createPolicy(ownerId, {
      name: "group-deny",
      document: { Version: "1", Statement: { Effect: "Deny", Action: "quyan:ram:*", Resource: "*" } },
    });
    await service.attachPolicy(ownerId, { policyId: deny.id, targetType: "group", targetId: group.id });
    expect((await IamAuthorizationService.getInstance().authorize(request)).decision).toBe("ExplicitDeny");
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { status: 0 } });
    await expect(IamAuthorizationService.getInstance().authorize(request)).rejects.toMatchObject({ statusCode: 403 });
  });
});
