import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { PermissionService } from "@/services/users/permission.service";
import { Permission, type IamPolicyDocument } from "@quyan/shared";
const ram = RamService.getInstance(),
  permissions = PermissionService.getInstance();
const mode = env.security.iamAuthorizationMode;
let owner: string, child: string, target: string, foreign: string;
const grant = async (document: IamPolicyDocument) => {
  const policy = await ram.createPolicy(owner, { name: "legacy-delegate-" + randomUUID(), document });
  await ram.createAuthorization(owner, {
    principalType: "user",
    principalId: child,
    policyId: policy.id,
    scopeType: "account",
  });
};
const reader = (Resource: string | string[]): IamPolicyDocument => ({
  Version: "1",
  Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource },
});
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "legacy-delegate-" + randomUUID(),
          password: "fixture-only",
          userType: accountOwnerId ? "ram_user" : "root",
          accountOwnerId,
          parentUserId: accountOwnerId,
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  child = await user(owner);
  target = await user(owner);
  foreign = await user();
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("legacy grants preserve IAM delegation scope", () => {
  it("does not treat an account-target menu projection as proof of authority over every user", async () => {
    await grant(reader("acs:quyan:*:" + owner + ":account"));
    expect((await permissions.getUserFullPermissions(child))!.effectivePermissions).toContain(Permission.RAM_USER_READ);
    await expect(permissions.assertCanGrantPermissions(child, [Permission.RAM_USER_READ])).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(permissions.addUserPermissions(child, target, [Permission.RAM_USER_READ])).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).permissionAdds).toEqual([]);
  });
  it("allows a legacy grant only when the operator covers all registered resource patterns", async () => {
    await grant(reader(["acs:quyan:*:" + owner + ":account", "acs:quyan:*:" + owner + ":user/*"]));
    await expect(permissions.addUserPermissions(child, target, [Permission.RAM_USER_READ])).resolves.toBeUndefined();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).permissionAdds).toContain(
      Permission.RAM_USER_READ,
    );
  });
  it("blocks deleting a legacy Deny through set or clear unless the expanded permission can be delegated", async () => {
    await grant(reader("acs:quyan:*:" + owner + ":account"));
    await prisma.user.update({ where: { id: target }, data: { permissionRemoves: [Permission.RAM_USER_READ] } });
    await expect(permissions.setUserPermissionConfig(child, target, { permissionRemoves: [] })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(permissions.clearUserPermissionConfig(child, target)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).permissionRemoves).toEqual([
      Permission.RAM_USER_READ,
    ]);
    await expect(
      permissions.setUserPermissionConfig(child, target, { permissionRemoves: [Permission.RAM_USER_READ] }),
    ).resolves.toBeUndefined();
  });
  it("refuses cross-account users and ordinary actors changing account recovery identities", async () => {
    await grant(reader("*"));
    await expect(permissions.addUserPermissions(child, foreign, [Permission.RAM_USER_READ])).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(permissions.setUserPermissionConfig(child, owner, {})).rejects.toMatchObject({ statusCode: 403 });
  });
  it("preserves account-owner recovery and rejects foreign group configuration", async () => {
    await prisma.user.update({ where: { id: target }, data: { permissionRemoves: [Permission.RAM_USER_READ] } });
    await expect(permissions.clearUserPermissionConfig(owner, target)).resolves.toBeUndefined();
    const group = await prisma.group.create({
      data: {
        accountOwnerId: foreign,
        username: "foreign-group-" + randomUUID(),
        name: "Foreign fixture",
        permissions: [],
        level: 99,
      },
    });
    await expect(permissions.setGroupPermissions(group.id, [], child)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("runtime delegation boundaries", () => {
  const platformAction = "quyan:oauth:ListSystemClients";
  const platformResource = "acs:platform:*:platform:oauth-client/client";
  const platformCandidate: IamPolicyDocument = {
    Version: "1",
    Statement: { Effect: "Allow", Action: platformAction, Resource: platformResource },
  };
  it("cannot turn a stored wildcard into a delegatable cross-account grant", async () => {
    await grant(reader("*"));
    expect(await ram.checkPolicyDelegation(child, reader("acs:quyan:*:" + owner + ":user/" + target))).toMatchObject({
      allowed: true,
    });
    expect(await ram.checkPolicyDelegation(child, reader("*"))).toMatchObject({ allowed: false });
    await expect(
      ram.checkPolicyDelegation(child, reader("acs:quyan:*:" + foreign + ":user/" + foreign)),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("requires persisted global-group qualification even with an explicitly bound platform policy", async () => {
    await grant({ Version: "1", Statement: { Effect: "Allow", Action: platformAction, Resource: "*" } });
    expect(await ram.checkPolicyDelegation(child, platformCandidate)).toMatchObject({ allowed: false });
    await prisma.user.update({
      where: { id: child },
      data: { permissionAdds: [Permission.OAUTH_CLIENT_SYSTEM_MANAGE] },
    });
    expect(await ram.checkPolicyDelegation(child, platformCandidate)).toMatchObject({ allowed: false });
    const group = await prisma.group.create({
      data: {
        accountOwnerId: owner,
        name: "private ceiling fixture",
        username: "delegation-private-" + randomUUID(),
        level: 10,
        permissions: [Permission.OAUTH_CLIENT_SYSTEM_MANAGE],
      },
    });
    await prisma.user.update({ where: { id: child }, data: { groupId: group.id } });
    expect(await ram.checkPolicyDelegation(child, platformCandidate)).toMatchObject({ allowed: false });
  });
  it("allows the qualified platform subset and keeps legacy explicit Deny", async () => {
    const group = await prisma.group.create({
      data: {
        accountOwnerId: null,
        name: "global qualification fixture",
        username: "delegation-global-" + randomUUID(),
        level: 10,
        permissions: [Permission.OAUTH_CLIENT_SYSTEM_MANAGE],
      },
    });
    await prisma.user.update({ where: { id: child }, data: { groupId: group.id } });
    expect(await ram.checkPolicyDelegation(child, platformCandidate)).toMatchObject({ allowed: true });
    expect(
      await ram.checkPolicyDelegation(child, {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:user:DeleteUser",
          Resource: "acs:platform:*:platform:user/target",
        },
      }),
    ).toMatchObject({ allowed: false });
    await prisma.user.update({
      where: { id: child },
      data: { permissionRemoves: [Permission.OAUTH_CLIENT_SYSTEM_MANAGE] },
    });
    expect(await ram.checkPolicyDelegation(child, platformCandidate)).toMatchObject({ allowed: false });
  });
});
