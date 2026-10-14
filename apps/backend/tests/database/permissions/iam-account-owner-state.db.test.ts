import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { UserRepository } from "@/store/users/user.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
let owner: string, child: string, principal: IamPrincipal;
const service = IamAuthorizationService.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "owner-state-" + randomUUID(),
        password: "fixture-only-credential",
        accountOwnerId,
        ...(accountOwnerId ? { userType: "ram_user", parentUserId: accountOwnerId } : {}),
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const selfRequest = (identity = principal) => ({
  principal: identity,
  action: "quyan:permission:Manage",
  resource: "acs:quyan:*:" + owner + ":user/" + child,
});
beforeEach(async () => {
  owner = await user();
  child = await user(owner);
  principal = { subjectUserId: child, principalUserId: child, accountOwnerId: owner, subjectType: "sub_user" };
});
describe("central IAM account owner state", () => {
  it("uses a credential-free account identity lookup and keeps authenticated self grants", async () => {
    const metadata = await UserRepository.getInstance().findAccountIdentity(owner);
    expect(metadata).toEqual({ id: owner, status: 1, accountOwnerId: null });
    expect(Object.keys(metadata!)).toEqual(["id", "status", "accountOwnerId"]);
    expect((await service.authorize(selfRequest())).decision).toBe("Allow");
  });
  it.each([0, -1])("rejects an enabled sub-user when its account owner has status %s", async (status) => {
    await prisma.user.update({ where: { id: owner }, data: { status } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: child } })).status).toBe(1);
    await expect(service.authorize(selfRequest())).rejects.toMatchObject({
      statusCode: 403,
      messageKey: "permission.insufficientPermission",
    });
  });
  it.each([0, -1])("does not let AccessKey identity bypass account owner status %s", async (status) => {
    await prisma.user.update({ where: { id: owner }, data: { status } });
    await expect(service.authorize(selfRequest({ ...principal, subjectType: "access_key" }))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each([0, -1])("does not let a valid role session bypass account owner status %s", async (status) => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "Owner state role" } }),
      session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          roleId: role.id,
          subjectUserId: child,
          sessionName: "Owner state",
          tokenJtiHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60000),
        },
      }),
      rolePrincipal = {
        ...principal,
        subjectType: "assumed_role" as const,
        assumedRoleId: role.id,
        roleSessionId: session.id,
      };
    expect((await service.authorize(selfRequest(rolePrincipal))).decision).toBe("Allow");
    await prisma.user.update({ where: { id: owner }, data: { status } });
    await expect(service.authorize(selfRequest(rolePrincipal))).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not permit an attached Allow to override an unavailable account", async () => {
    const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } }),
      policy = await RamPolicyRepository.getInstance().createPolicy({
        accountOwnerId: owner,
        name: "Owner state policy",
        permissions: [],
        iamVersion: { ...parsed, createdBy: owner },
      });
    await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: owner,
        principalType: "user",
        principalId: child,
        policyId: policy.id,
        scopeType: "account",
        scopeKey: "account",
        createdBy: owner,
      },
    });
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(service.loadPolicies(principal)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects malformed owner-to-parent ownership even when the owner is active", async () => {
    const parent = await user();
    await prisma.user.update({ where: { id: owner }, data: { accountOwnerId: parent } });
    await expect(service.authorize(selfRequest())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects case aliases stored as an account owner's identity", async () => {
    await prisma.user.update({ where: { id: child }, data: { accountOwnerId: owner.toUpperCase() } });
    await expect(service.loadPolicies({ ...principal, accountOwnerId: owner.toUpperCase() })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rechecks the account's current state on repeated requests without a stale decision cache", async () => {
    expect((await service.authorize(selfRequest())).decision).toBe("Allow");
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(service.authorize(selfRequest())).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: owner }, data: { status: 1 } });
    expect((await service.authorize(selfRequest())).decision).toBe("Allow");
  });
  it("keeps root and ordinary default-group account owners available", async () => {
    const root = { ...principal, subjectUserId: owner, principalUserId: owner, subjectType: "root" as const };
    expect(
      (await service.authorize({ ...selfRequest(root), resource: "acs:quyan:*:" + owner + ":user/" + owner })).decision,
    ).toBe("Allow");
  });
});
