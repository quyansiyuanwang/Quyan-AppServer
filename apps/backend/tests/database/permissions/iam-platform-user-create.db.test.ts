import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_GROUP_USERNAME, DEFAULT_USER_GROUP_PERMISSIONS, Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { hashPassword, verifyPassword } from "@/util/crypto";
import { PlatformUserCreateIamService } from "@/services/users/platform-user-create-iam.service";
import { PlatformUserCreateRepository } from "@/store/users/platform-user-create.repository";
import { UserService } from "@/services/users/user.service";
import { UserRepository } from "@/store/users/user.repository";
import { GroupRepository } from "@/store/users/group.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PermissionService } from "@/services/users/permission.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  platformUserArn,
  platformUserGroupArn,
  platformUserDirectoryArn,
} from "@/iam/resources/platform-user-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, groupId: string, defaultId: string, destination: string;
const mode = env.security.iamAuthorizationMode,
  adminName = env.security.superAdminGroupUsername;
const native = PlatformUserCreateIamService.getInstance(),
  repository = PlatformUserCreateRepository.getInstance();
const password = hashPassword("create-fixture-password");
const data = () => ({
  username: "create_" + randomUUID().replace(/-/g, "").slice(0, 10),
  password,
  email: "created@example.test",
  name: "Created",
});
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*", "x-account-id": "forged" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const group = async (accountOwnerId: string | null, level = 10, permissions: Permission[] = []) =>
  (
    await prisma.group.create({
      data: { username: "create-group-" + randomUUID(), name: "Create fixture", accountOwnerId, level, permissions },
    })
  ).id;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "create-fixture-" + randomUUID(),
        password: "fixture-only-credential",
        userType: accountOwnerId ? "ram_user" : "root",
        accountOwnerId,
        parentUserId: accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
async function policy(Action: string, Resource: string, Effect = "Deny", principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect, Action, Resource } });
  const created = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "create-policy-" + randomUUID(),
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
  groupId = await group(null, 5, [Permission.USER_CREATE]);
  destination = await group(null, 10);
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  defaultId = (
    await prisma.group.upsert({
      where: { username: DEFAULT_USER_GROUP_USERNAME },
      create: {
        username: DEFAULT_USER_GROUP_USERNAME,
        name: "Baseline fixture",
        accountOwnerId: null,
        level: 10,
        permissions: [...DEFAULT_USER_GROUP_PERMISSIONS],
      },
      update: { status: 1, accountOwnerId: null, level: 10, permissions: [...DEFAULT_USER_GROUP_PERMISSIONS] },
    })
  ).id;
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  env.security.superAdminGroupUsername = adminName;
  vi.restoreAllMocks();
});
describe("atomic platform user creation", () => {
  it("creates a real root identity with the exact seeded baseline and no credential response", async () => {
    const input = data(),
      result = await native.execute(
        { ...input, id: actor, accountOwnerId: owner, status: 0, permissionAdds: ["*"] },
        actor,
        request(),
      );
    expect(result).toMatchObject({ username: input.username, name: "Created", status: 1 });
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("permissionAdds");
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: result.id } });
    expect(stored).toMatchObject({
      accountOwnerId: null,
      parentUserId: null,
      userType: "root",
      groupId: defaultId,
      permissionAdds: [],
      permissionRemoves: [],
    });
    expect(verifyPassword("create-fixture-password", stored.password)).toBe(true);
    expect(stored.id).not.toBe(actor);
  });
  it("requires the collection and generated user grants separately", async () => {
    await policy("quyan:user:CreateUser", platformUserDirectoryArn());
    const input = data();
    await expect(native.execute(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUnique({ where: { username: input.username } })).toBeNull();
  });
  it("rolls back the inserted user if the generated resource is denied", async () => {
    await policy("quyan:user:CreateUser", "acs:platform:*:platform:user/*");
    const input = data();
    await expect(native.execute(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUnique({ where: { username: input.username } })).toBeNull();
  });
  it("does not treat collection-only Allow as permission for the generated user", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.USER_READ] } });
    await policy("quyan:user:CreateUser", platformUserDirectoryArn(), "Allow");
    const input = data();
    await expect(native.execute(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUnique({ where: { username: input.username } })).toBeNull();
  });
  it("requires assignment on the explicit destination and generated user", async () => {
    const input = { ...data(), groupId: destination },
      result = await native.execute(input, actor, request());
    expect(result.id).toBeTruthy();
    await policy("quyan:user:AssignUserGroup", platformUserGroupArn(destination));
    const denied = { ...data(), groupId: destination };
    await expect(native.execute(denied, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUnique({ where: { username: denied.username } })).toBeNull();
  });
  it("rolls back if user-side group assignment is denied", async () => {
    await policy("quyan:user:AssignUserGroup", "acs:platform:*:platform:user/*");
    const input = { ...data(), groupId: destination };
    await expect(native.execute(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUnique({ where: { username: input.username } })).toBeNull();
  });
  it("does not grant the registration exception to explicitly chosen default groups", async () => {
    const input = { ...data(), groupId: defaultId };
    await expect(native.execute(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUnique({ where: { username: input.username } })).toBeNull();
  });
  it.each(["more-powerful", "peer", "disabled", "private", "case-mismatch"])(
    "rejects an unsafe destination: %s",
    async (kind) => {
      const id = kind === "private" ? await group(owner) : destination;
      if (kind === "more-powerful") await prisma.group.update({ where: { id }, data: { level: 1 } });
      if (kind === "peer") await prisma.group.update({ where: { id }, data: { level: 5 } });
      if (kind === "disabled") await prisma.group.update({ where: { id }, data: { status: 0 } });
      const input = { ...data(), groupId: kind === "case-mismatch" ? id.toUpperCase() : id };
      await expect(native.execute(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
      expect(await prisma.user.findUnique({ where: { username: input.username } })).toBeNull();
    },
  );
  it("cannot hide additional default group privileges under the baseline exception", async () => {
    await prisma.group.update({
      where: { id: defaultId },
      data: { permissions: [...DEFAULT_USER_GROUP_PERMISSIONS, Permission.USER_UPDATE] },
    });
    const input = data();
    await expect(native.execute(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUnique({ where: { username: input.username } })).toBeNull();
  });
  it("does not delegate an actor's explicitly denied baseline through registration", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.RELAY_CHANNEL_SUBMIT] } });
    const input = data();
    await expect(native.execute(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUnique({ where: { username: input.username } })).toBeNull();
  });
  it("rejects global management rights manufactured only by account policy", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await policy("quyan:user:CreateUser", "*", "Allow");
    const input = data();
    await expect(native.execute(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUnique({ where: { username: input.username } })).toBeNull();
  });
  it.each([
    "disabled-actor",
    "disabled-owner",
    "disabled-actor-group",
    "private-actor-group",
    "missing-context",
    "oauth",
    "readonly",
  ])("fails closed for %s", async (kind) => {
    const req = request();
    if (kind === "disabled-actor") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    if (kind === "disabled-owner") await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    if (kind === "disabled-actor-group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
    if (kind === "private-actor-group")
      await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    if (kind === "oauth") req.oauthAccessToken = {} as never;
    if (kind === "readonly") req.user = { ...req.user!, impersonatorId: owner, impersonationMode: "view" };
    const input = data();
    await expect(native.execute(input, actor, kind === "missing-context" ? undefined : req)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.user.findUnique({ where: { username: input.username } })).toBeNull();
  });
  it("rechecks the target group before inserting", async () => {
    const create = repository.create.bind(repository);
    vi.spyOn(repository, "create").mockImplementation(async (guard) => {
      await prisma.group.update({ where: { id: guard.destination.id }, data: { status: 0 } });
      return create(guard);
    });
    const input = data();
    await expect(native.execute(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUnique({ where: { username: input.username } })).toBeNull();
  });
  it("rechecks authorization revisions before SQL", async () => {
    const create = repository.create.bind(repository);
    vi.spyOn(repository, "create").mockImplementation(async (guard) => {
      await policy("quyan:user:CreateUser", "*", "Deny");
      return create(guard);
    });
    const input = data();
    await expect(native.execute(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUnique({ where: { username: input.username } })).toBeNull();
  });
  it("rolls back after final authorization changes following insertion", async () => {
    const create = repository.create.bind(repository);
    vi.spyOn(repository, "create").mockImplementation(async (guard) => {
      let count = 0;
      return create({
        ...guard,
        authorizeCreated: async (id) => {
          if (++count === 2) throw iamAccountDenied();
          await guard.authorizeCreated(id);
        },
      });
    });
    const input = data();
    await expect(native.execute(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUnique({ where: { username: input.username } })).toBeNull();
  });
  it("returns a safe conflict for duplicate username without changing an existing user", async () => {
    const input = data(),
      first = await native.execute(input, actor, request());
    await expect(native.execute({ ...input, name: "Overwritten" }, actor, request())).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ name: "Created" });
  });
  it("uses the same native policy path for access keys", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    expect((await native.execute(data(), actor, req)).id).toBeTruthy();
  });
  it("uses only the assumed role grants and rejects revoked sessions", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "Create role" } }),
      session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          roleId: role.id,
          subjectUserId: actor,
          sessionName: "Create",
          tokenJtiHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60000),
        },
      }),
      req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    const denied = data();
    await expect(native.execute(denied, actor, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUnique({ where: { username: denied.username } })).toBeNull();
    await policy("quyan:user:CreateUser", "*", "Allow", "role", role.id);
    expect((await native.execute(data(), actor, req)).id).toBeTruthy();
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const revoked = data();
    await expect(native.execute(revoked, actor, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUnique({ where: { username: revoked.username } })).toBeNull();
  });
  it("does not let a role session activate configured recovery", async () => {
    actor = owner;
    await prisma.user.update({ where: { id: actor }, data: { groupId } });
    env.security.superAdminGroupUsername = (await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).username;
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "No recovery role" } }),
      session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          roleId: role.id,
          subjectUserId: actor,
          sessionName: "Create",
          tokenJtiHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60000),
        },
      }),
      req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    await policy("quyan:user:CreateUser", "*", "Allow", "role", role.id);
    await policy("quyan:user:AssignUserGroup", "*", "Allow", "role", role.id);
    const privileged = await group(null, 5, [Permission.USER_UPDATE]),
      input = { ...data(), groupId: privileged };
    await expect(native.execute(input, actor, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUnique({ where: { username: input.username } })).toBeNull();
  });
  it("does not let sub-users claim configured root recovery", async () => {
    const privileged = await group(null, 5, [Permission.USER_UPDATE]);
    const name = (await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).username;
    env.security.superAdminGroupUsername = name;
    const input = { ...data(), groupId: privileged };
    await expect(native.execute(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("allows the configured actual root to create a recovery administrator", async () => {
    actor = owner;
    await prisma.user.update({ where: { id: actor }, data: { groupId } });
    env.security.superAdminGroupUsername = (await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).username;
    const privileged = await group(null, 5, [Permission.USER_UPDATE]);
    const result = await native.execute({ ...data(), groupId: privileged }, actor, request());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: result.id } })).groupId).toBe(privileged);
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.USER_UPDATE] } });
    await expect(native.execute({ ...data(), groupId: privileged }, actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("does not convert CREATE membership into permission to update existing users", async () => {
    const result = await native.execute(data(), actor, request());
    await expect(
      UserService.getInstance().updateUser(result.id, { name: "Unexpected" }, actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("enforces native creation inside UserService without falling back to the legacy repository", async () => {
    const create = vi.spyOn(UserRepository.getInstance(), "create"),
      input = data();
    const result = await UserService.getInstance().createUser(input, actor, request());
    expect(result.id).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("preserves old enforcement and writes once in %s", async (next) => {
    env.security.iamAuthorizationMode = next;
    await policy("quyan:user:CreateUser", "*", "Deny");
    const create = vi.spyOn(UserRepository.getInstance(), "create"),
      nativeCreate = vi.spyOn(repository, "create"),
      input = data();
    const result = await UserService.getInstance().createUser(input, actor, request());
    expect(result.id).toBeTruthy();
    expect(create).toHaveBeenCalledTimes(1);
    expect(nativeCreate).not.toHaveBeenCalled();
    vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
      hasPermission: false,
      checkedPermissions: [Permission.USER_CREATE],
      missingPermissions: [Permission.USER_CREATE],
    });
    await expect(UserService.getInstance().createUser(data(), actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("shadow checks the real created identity without another user row", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const authorize = vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany"),
      input = data();
    const result = await UserService.getInstance().createUser(input, actor, request());
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:user:CreateUser", resources: [platformUserArn(result.id)] }),
    );
    expect(await prisma.user.count({ where: { username: input.username } })).toBe(1);
  });
  it("finds only the global seeded default group", async () => {
    await prisma.group.update({ where: { id: defaultId }, data: { accountOwnerId: owner } });
    expect(await GroupRepository.getInstance().findDefaultUserGroup()).toBeNull();
    await expect(native.execute(data(), actor, request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
