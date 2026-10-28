import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { PlatformUserUpdateIamService } from "@/services/users/platform-user-update-iam.service";
import { PlatformUserUpdateRepository } from "@/store/users/platform-user-update.repository";
import { UserService } from "@/services/users/user.service";
import { UserRepository } from "@/store/users/user.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformUserArn, platformUserGroupArn } from "@/iam/resources/platform-user-resources";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
let owner: string,
  actor: string,
  target: string,
  foreign: string,
  groupId: string,
  oldGroup: string,
  destination: string;
const mode = env.security.iamAuthorizationMode,
  adminName = env.security.superAdminGroupUsername;
const native = PlatformUserUpdateIamService.getInstance(),
  repository = PlatformUserUpdateRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "update-fixture-" + randomUUID(),
        password: "fixture-only-credential",
        userType: accountOwnerId ? "ram_user" : "root",
        accountOwnerId,
        parentUserId: accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const group = async (accountOwnerId: string | null, level = 10, permissions: Permission[] = []) =>
  (
    await prisma.group.create({
      data: { username: "update-group-" + randomUUID(), name: "Update fixture", accountOwnerId, level, permissions },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*", "x-account-id": "forged" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const execute = (data: Record<string, unknown> = { name: "Updated" }, id = target, req = request()) =>
  native.execute(id, data, actor, req);
async function policy(Action: string, Resource: string, Effect = "Deny", principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect, Action, Resource } });
  const created = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "update-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType,
      principalId,
      policyId: created.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  target = await user(owner);
  foreign = await user();
  groupId = await group(null, 5, [Permission.USER_UPDATE]);
  oldGroup = await group(owner);
  destination = await group(owner);
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  await prisma.user.update({ where: { id: target }, data: { groupId: oldGroup, email: "old@example.test" } });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  env.security.superAdminGroupUsername = adminName;
  vi.restoreAllMocks();
});
describe("atomic platform user updates", () => {
  it("updates only the authorized profile and returns no credential fields", async () => {
    const result = await execute();
    expect(result?.user).toMatchObject({ id: target, name: "Updated", status: 1 });
    expect(result?.user).not.toHaveProperty("password");
    expect(result?.user).not.toHaveProperty("permissionAdds");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).name).not.toBe("Updated");
  });
  it.each(["quyan:user:UpdateUser", "quyan:user:SetUserEmail", "quyan:user:SetUserStatus"])(
    "respects an independent %s Deny",
    async (action) => {
      await policy(action, platformUserArn(target));
      const data = action.endsWith("SetUserEmail")
        ? { email: "new@example.test" }
        : action.endsWith("SetUserStatus")
          ? { status: 0 }
          : { name: "Denied" };
      await expect(execute(data)).rejects.toMatchObject({ statusCode: 403 });
      expect(await prisma.user.findUniqueOrThrow({ where: { id: target } })).toMatchObject({
        name: null,
        email: "old@example.test",
        status: 1,
      });
      if (action !== "quyan:user:UpdateUser") await expect(execute({ name: "Safe" })).resolves.toBeDefined();
    },
  );
  it("updates a disabled target and separately authorizes enabling it", async () => {
    await prisma.user.update({ where: { id: target }, data: { status: 0 } });
    expect((await execute())?.user.status).toBe(0);
    expect((await execute({ status: 1 }))?.user.status).toBe(1);
  });
  it("requires group grants on both target and destination", async () => {
    await policy("quyan:user:AssignUserGroup", platformUserGroupArn(destination));
    await expect(execute({ groupId: destination })).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).groupId).toBe(oldGroup);
    await expect(execute({ name: "Allowed" })).resolves.toBeDefined();
  });
  it("assigns a nonprivileged same-account group after proving all grants", async () => {
    expect((await execute({ groupId: destination }))?.user.id).toBe(target);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).groupId).toBe(destination);
  });
  it("rejects privileges not covered by the operator, then accepts the covered group", async () => {
    await prisma.group.update({ where: { id: destination }, data: { permissions: [Permission.RAM_USER_READ] } });
    await expect(execute({ groupId: destination })).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RAM_USER_READ] } });
    await expect(execute({ groupId: destination })).resolves.toBeDefined();
  });
  it("includes role-derived group privileges in the proof", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "update-role-" + randomUUID() } });
    await prisma.ramGroupRoleBinding.create({ data: { accountOwnerId: owner, roleId: role.id, groupId: destination } });
    await policy("quyan:ram:DeleteUser", "acs:quyan:*:" + owner + ":user/*", "Allow", "role", role.id);
    await expect(execute({ groupId: destination })).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).groupId).toBe(oldGroup);
  });
  it("does not underestimate an unknown policy/scope intersection when assigning a group", async () => {
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:ram:UpdateUser", Resource: "acs:quyan:*:" + owner + ":user/c*" },
    });
    const created = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "intersection-policy-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    const scopeArn = "acs:quyan:*:" + owner + ":user/*x";
    await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: owner,
        principalType: "group",
        principalId: destination,
        policyId: created.id,
        scopeType: "resource",
        scopeArn,
        scopeKey: "resource:" + scopeArn,
        createdBy: owner,
      },
    });
    await expect(execute({ groupId: destination })).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).groupId).toBe(oldGroup);
  });
  it("does not remove a group Deny to uncover direct target privileges", async () => {
    await policy("quyan:ram:DeleteUser", "acs:quyan:*:" + owner + ":user/*", "Deny", "group", oldGroup);
    await expect(execute({ groupId: destination })).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).groupId).toBe(oldGroup);
  });
  it("never assigns a private group belonging to another account", async () => {
    const wrong = await group(foreign);
    await expect(execute({ groupId: wrong })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects deleted users, resource aliases and unavailable account owners", async () => {
    await expect(execute({}, target.toUpperCase())).rejects.toMatchObject({ statusCode: 403 });
    await expect(execute({ groupId: destination.toUpperCase() })).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: target }, data: { status: -1 } });
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("cannot update a child of an unavailable account", async () => {
    const other = await user(foreign),
      g = await group(foreign);
    await prisma.user.update({ where: { id: other }, data: { groupId: g } });
    await prisma.user.update({ where: { id: foreign }, data: { status: 0 } });
    await expect(execute({}, other)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires the persisted global ceiling instead of personal permission additions", async () => {
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.USER_UPDATE], groupId: destination },
    });
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not promote a target to a more privileged level through an empty group", async () => {
    const stronger = await group(owner, 6);
    await expect(execute({ groupId: stronger })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses peer mutations and protects self recovery fields", async () => {
    await prisma.group.update({ where: { id: oldGroup }, data: { level: 5 } });
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
    for (const data of [{ status: 0 }, { email: "reset@example.test" }, { groupId: destination }])
      await expect(execute(data, actor)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("handles the main account's own name update without a stale owner snapshot", async () => {
    actor = owner;
    await prisma.user.update({ where: { id: owner }, data: { groupId } });
    expect((await execute({ name: "Root name" }, owner))?.user.name).toBe("Root name");
  });
  it("handles a successful self name update with an expected post-image", async () => {
    expect((await execute({ name: "Own name" }, actor))?.user.name).toBe("Own name");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).name).toBe("Own name");
  });
  it("root recovery requires the real configured global administrator and still respects Deny", async () => {
    actor = owner;
    const rootGroup = await group(null, 0, [Permission.USER_UPDATE]);
    const root = await prisma.group.findUniqueOrThrow({ where: { id: rootGroup } });
    env.security.superAdminGroupUsername = root.username;
    await prisma.user.update({ where: { id: actor }, data: { groupId: rootGroup } });
    const admin = await group(null, 0, Object.values(Permission));
    await policy("quyan:user:AssignUserGroup", platformUserGroupArn(admin));
    await expect(execute({ groupId: admin })).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
    await expect(execute({ groupId: admin })).resolves.toBeDefined();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).groupId).toBe(admin);
  });
  it("bootstrap cannot delegate a privilege explicitly denied to the acting administrator", async () => {
    actor = owner;
    const rootGroup = await group(null, 0, [Permission.USER_UPDATE]);
    env.security.superAdminGroupUsername = (
      await prisma.group.findUniqueOrThrow({ where: { id: rootGroup } })
    ).username;
    await prisma.user.update({ where: { id: actor }, data: { groupId: rootGroup } });
    await prisma.group.update({ where: { id: destination }, data: { permissions: [Permission.RAM_USER_READ] } });
    await policy("quyan:ram:ReadUser", "*");
    await expect(execute({ groupId: destination })).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).groupId).toBe(oldGroup);
  });
  it("bootstrap group replacement preserves another owner's existing IAM recovery authority", async () => {
    actor = owner;
    const rootGroup = await group(null, 0, [Permission.USER_UPDATE]);
    env.security.superAdminGroupUsername = (
      await prisma.group.findUniqueOrThrow({ where: { id: rootGroup } })
    ).username;
    await prisma.user.update({ where: { id: actor }, data: { groupId: rootGroup } });
    const recovery = await group(foreign, 10, [Permission.RAM_USER_READ]);
    await prisma.user.update({ where: { id: foreign }, data: { groupId: recovery } });
    const empty = await group(null),
      preserved = await group(null, 10, [Permission.RAM_USER_READ]);
    await expect(execute({ groupId: empty }, foreign)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: foreign } })).groupId).toBe(recovery);
    await expect(execute({ groupId: preserved }, foreign)).resolves.toBeDefined();
  });
  it("role sessions must hold each sensitive variant's Action", async () => {
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "update-session-" + randomUUID() },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        subjectUserId: actor,
        roleId: role.id,
        sessionName: "test",
        tokenJtiHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await policy("quyan:user:UpdateUser", platformUserArn(target), "Allow", "role", role.id);
    const req = request();
    req.authContext!.roleSessionId = session.id;
    req.authContext!.assumedRoleId = role.id;
    await expect(execute({ name: "Role name" }, target, req)).resolves.toBeDefined();
    await expect(execute({ email: "role@example.test" }, target, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(execute({ status: 0 }, target, req)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(execute({}, target, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects policy or group changes between authorization and transaction", async () => {
    const original = repository.update.bind(repository);
    vi.spyOn(repository, "update").mockImplementation(async (guard) => {
      await policy("quyan:user:UpdateUser", platformUserArn(target));
      return original(guard);
    });
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).name).toBeNull();
  });
  it("rejects destination permission changes even if its timestamp is preserved", async () => {
    const original = repository.update.bind(repository),
      before = await prisma.group.findUniqueOrThrow({ where: { id: destination } });
    vi.spyOn(repository, "update").mockImplementation(async (guard) => {
      await prisma.group.update({
        where: { id: destination },
        data: { permissions: [Permission.RAM_USER_READ], updateTime: before.updateTime },
      });
      return original(guard);
    });
    await expect(execute({ groupId: destination })).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).groupId).toBe(oldGroup);
  });
  it("protects the current account owner's recovery fields", async () => {
    await prisma.user.update({ where: { id: owner }, data: { groupId: oldGroup, email: "owner@example.test" } });
    for (const data of [{ status: 0 }, { email: "reset@example.test" }, { groupId: destination }])
      await expect(execute(data, owner)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: owner } })).toMatchObject({
      status: 1,
      email: "owner@example.test",
      groupId: oldGroup,
    });
  });
  it("rolls back name, email, status and group when final grants are revoked", async () => {
    const original = repository.update.bind(repository);
    vi.spyOn(repository, "update").mockImplementation(async (guard) => {
      const recheck = guard.users.recheck;
      let count = 0;
      return original({
        ...guard,
        users: {
          ...guard.users,
          recheck: async () => {
            if (++count > 1) throw iamAccountDenied();
            await recheck();
          },
        },
      });
    });
    await expect(
      execute({ name: "Rollback", email: "rollback@example.test", status: 0, groupId: destination }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target } })).toMatchObject({
      name: null,
      email: "old@example.test",
      status: 1,
      groupId: oldGroup,
    });
  });
  it("performs shadow comparison without a second update", async () => {
    expect(await native.execute(target, { name: "Shadow" }, actor, request(), false)).toBeUndefined();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).name).toBeNull();
  });
  it.each(["legacy", "shadow"] as const)("keeps old enforcement and writes once in %s", async (next) => {
    env.security.iamAuthorizationMode = next;
    await policy("quyan:user:UpdateUser", platformUserArn(target));
    const update = vi.spyOn(UserRepository.getInstance(), "updateById");
    await UserService.getInstance().updateUser(target, { name: "Legacy" }, actor, request());
    expect(update).toHaveBeenCalledTimes(1);
    vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
      hasPermission: false,
      checkedPermissions: [Permission.USER_UPDATE],
      missingPermissions: [Permission.USER_UPDATE],
    });
    await expect(
      UserService.getInstance().updateUser(target, { name: "Denied" }, actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
