import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { RamRoleRepository } from "@/store/users/ram-role.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamTrustPolicy } from "@/iam/trust/trust-policy";
const service = RamService.getInstance(),
  iam = IamAuthorizationService.getInstance();
const oldMode = env.security.iamAuthorizationMode;
let owner: string, child: string, other: string;
const roleArn = (id: string) => "acs:quyan:*:" + owner + ":role/" + id;
const userArn = (id: string) => "acs:quyan:*:" + owner + ":user/" + id;
const trust = (id = child, effect = "Allow", resource = roleArn("*")) => ({
  Version: "1",
  Statement: {
    Effect: effect,
    Action: "quyan:ram:AssumeRole",
    Resource: resource,
    Principal: { RAM: "acs:quyan::" + owner + ":user/" + id },
  },
});
async function grant(
  targetId: string,
  action: string,
  resource: string,
  effect: "Allow" | "Deny" = "Allow",
  principalType: "user" | "role" = "user",
) {
  const policy = await service.createPolicy(owner, {
    name: "trust-fixture-" + randomUUID(),
    document: { Version: "1", Statement: { Effect: effect, Action: action, Resource: resource } },
  });
  await service.createAuthorization(owner, {
    principalType,
    principalId: targetId,
    policyId: policy.id,
    scopeType: "account",
  });
  return policy;
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = (accountOwnerId?: string) =>
    prisma.user.create({
      data: {
        username: "trust-user-" + randomUUID(),
        password: "test-fixture-only",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram" : "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
  owner = (await user()).id;
  child = (await user(owner)).id;
  other = (await user(owner)).id;
  await grant(owner, "quyan:ram:UpdateRoleTrustPolicy", "*");
});
afterEach(() => {
  env.security.iamAuthorizationMode = oldMode;
});
describe("role trust and identity authorization intersection", () => {
  it("requires both identity and trust Allow, without requiring a legacy role binding", async () => {
    const role = await service.createRole(owner, { name: "trusted-role", trustPolicy: trust() });
    await expect(service.assumeRole(child, { roleId: role.id })).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.ramRoleSession.count({ where: { roleId: role.id } })).toBe(0);
    await grant(child, "quyan:ram:AssumeRole", roleArn(role.id));
    const result = await service.assumeRole(child, { roleId: role.id, durationSeconds: 900 });
    expect(typeof result.accessToken).toBe("string");
    expect(result.session.roleId).toBe(role.id);
    expect(await prisma.ramUserRoleBinding.count({ where: { roleId: role.id, userId: child } })).toBe(0);
  });
  it("denies a wrong principal, trust Deny and identity Deny without creating sessions", async () => {
    const role = await service.createRole(owner, { name: "denied-role", trustPolicy: trust(other) });
    await grant(child, "quyan:ram:AssumeRole", roleArn(role.id));
    expect((await service.simulatePolicy(owner, child, "quyan:ram:AssumeRole", roleArn(role.id))).decision).toBe(
      "ImplicitDeny",
    );
    await expect(service.assumeRole(child, { roleId: role.id })).rejects.toMatchObject({ statusCode: 403 });
    await service.updateRole(owner, role.id, { trustPolicy: trust(child, "Deny") });
    await expect(service.assumeRole(child, { roleId: role.id })).rejects.toMatchObject({ statusCode: 403 });
    await service.updateRole(owner, role.id, { trustPolicy: trust() });
    await grant(child, "quyan:ram:AssumeRole", roleArn(role.id), "Deny");
    expect((await service.simulatePolicy(owner, child, "quyan:ram:AssumeRole", roleArn(role.id))).decision).toBe(
      "ExplicitDeny",
    );
    await expect(service.assumeRole(child, { roleId: role.id })).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.ramRoleSession.count({ where: { roleId: role.id } })).toBe(0);
  });
  it("rejects malformed, nonexistent and cross-account trust principals", async () => {
    for (const document of [
      { Version: "1", Statement: { Effect: "Allow", Action: "quyan:ram:AssumeRole", Resource: "*" } },
      trust("missing-user"),
    ])
      await expect(
        service.createRole(owner, { name: "bad-" + randomUUID(), trustPolicy: document }),
      ).rejects.toMatchObject({ statusCode: 400 });
    const foreign = await prisma.user.create({
      data: {
        username: "foreign-" + randomUUID(),
        password: "fixture-only",
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    await expect(
      service.createRole(owner, {
        name: "cross-account",
        trustPolicy: {
          ...trust(foreign.id),
          Statement: {
            ...trust(foreign.id).Statement,
            Principal: { RAM: "acs:quyan::" + foreign.id + ":user/" + foreign.id },
          },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("keeps legacy binding behavior only outside enforce and rejects absent trust under enforce", async () => {
    const role = await service.createRole(owner, { name: "legacy-role" });
    await grant(child, "quyan:ram:AssumeRole", roleArn(role.id));
    await service.bindRoleToUser(owner, role.id, child);
    await expect(service.assumeRole(child, { roleId: role.id })).rejects.toMatchObject({ statusCode: 403 });
    env.security.iamAuthorizationMode = "legacy";
    expect((await service.assumeRole(child, { roleId: role.id })).session.roleId).toBe(role.id);
  });
});
describe("role session and trust delegation boundaries", () => {
  it("does not inherit the caller's identity or unrelated role grants and respects revocation", async () => {
    const role = await service.createRole(owner, { name: "reader-role", trustPolicy: trust() });
    await grant(child, "quyan:ram:AssumeRole", roleArn(role.id));
    await grant(child, "quyan:ram:DeleteUser", "*");
    await grant(role.id, "quyan:ram:ReadUser", userArn(other), "Allow", "role");
    const otherRole = await service.createRole(owner, { name: "other-role" });
    await grant(otherRole.id, "quyan:ram:UpdateUser", "*", "Allow", "role");
    await service.bindRoleToUser(owner, otherRole.id, child);
    const result = await service.assumeRole(child, { roleId: role.id });
    const principal = {
      subjectUserId: child,
      principalUserId: child,
      accountOwnerId: owner,
      subjectType: "assumed_role" as const,
      assumedRoleId: role.id,
      roleSessionId: result.session.id,
    };
    expect((await iam.authorize({ principal, action: "quyan:ram:ReadUser", resource: userArn(other) })).decision).toBe(
      "Allow",
    );
    for (const action of ["quyan:ram:UpdateUser", "quyan:ram:DeleteUser"])
      expect((await iam.authorize({ principal, action, resource: userArn(other) })).decision).toBe("ImplicitDeny");
    await service.revokeRoleSession(owner, result.session.id);
    await expect(iam.loadPolicies(principal)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("prevents trust publication from delegating role grants outside the publisher's effective scope", async () => {
    const role = await service.createRole(owner, { name: "scoped-delegation-role", trustPolicy: trust() });
    const powerful = await service.createPolicy(owner, {
      name: "powerful-" + randomUUID(),
      document: { Version: "1", Statement: { Effect: "Allow", Action: "quyan:ram:DeleteUser", Resource: "*" } },
    });
    await service.createAuthorization(owner, {
      principalType: "role",
      principalId: role.id,
      policyId: powerful.id,
      scopeType: "resource",
      scopeArn: userArn(other),
    });
    await grant(child, "quyan:ram:UpdateRoleTrustPolicy", roleArn(role.id));
    await grant(child, "quyan:ram:AssumeRole", roleArn(role.id));
    await expect(
      service.updateRole(child, role.id, { trustPolicy: trust(other, "Allow", roleArn(role.id)) }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("checks optimistic trust hashes and refuses a stale trust snapshot before issuing a session", async () => {
    const role = await service.createRole(owner, { name: "versioned-trust-role", trustPolicy: trust() });
    const stale = await prisma.ramRole.findUniqueOrThrow({ where: { id: role.id } });
    const hash = parseIamTrustPolicy(stale.trustPolicy).documentHash;
    await service.updateRole(owner, role.id, { trustPolicy: trust(other) });
    await expect(
      service.updateRole(owner, role.id, { trustPolicy: trust(), expectedTrustPolicyHash: hash }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      RamRoleRepository.getInstance().createRoleSession({
        accountOwnerId: owner,
        subjectUserId: child,
        roleId: role.id,
        sessionName: "stale",
        expiresAt: new Date(Date.now() + 60000),
        expectedRoleUpdateTime: stale.updateTime,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.ramRoleSession.count({ where: { roleId: role.id } })).toBe(0);
  });
});
