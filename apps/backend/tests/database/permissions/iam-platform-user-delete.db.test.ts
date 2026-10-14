import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { PlatformUserDeleteIamService } from "@/services/users/platform-user-delete-iam.service";
import { PlatformUserDeleteRepository } from "@/store/users/platform-user-delete.repository";
import { UserService } from "@/services/users/user.service";
import { UserRepository } from "@/store/users/user.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, target: string, other: string, groupId: string, targetGroupId: string;
const originalMode = env.security.iamAuthorizationMode,
  native = PlatformUserDeleteIamService.getInstance(),
  repository = PlatformUserDeleteRepository.getInstance(),
  userService = UserService.getInstance(),
  action = "quyan:user:DeleteUser";
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "delete-fixture-" + randomUUID(),
        password: "fixture-only-credential",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
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
const execute = (id = target, req = request()) => userService.deleteUser(id, actor, req);
async function bind(
  effect: "Allow" | "Deny",
  id = target,
  principalType = "user",
  principalId = actor,
  condition?: Record<string, Record<string, string>>,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: {
      Effect: effect,
      Action: action,
      Resource: platformUserArn(id),
      ...(condition ? { Condition: condition } : {}),
    },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "delete-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType,
      principalId,
      policyId: policy.id,
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
  target = await user();
  other = await user();
  groupId = (
    await prisma.group.create({
      data: {
        username: "delete-global-" + randomUUID(),
        name: "Operators",
        level: 1,
        permissions: [Permission.USER_DELETE],
        accountOwnerId: null,
      },
    })
  ).id;
  targetGroupId = (
    await prisma.group.create({
      data: {
        username: "delete-target-" + randomUUID(),
        name: "Targets",
        level: 2,
        permissions: [],
        accountOwnerId: null,
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  await prisma.user.updateMany({ where: { id: { in: [target, other, owner] } }, data: { groupId: targetGroupId } });
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
describe("atomic platform user deletion", () => {
  it("soft-deletes only the authorized target and releases its original username", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: target } });
    await execute();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: target } });
    expect(after.status).toBe(-1);
    expect(after.username).toMatch(new RegExp("^" + before.username + "_del_"));
    expect(after.password).toBe(before.password);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other } })).status).toBe(1);
  });
  it("allows deletion of disabled users with the same resource and level restrictions", async () => {
    await prisma.user.update({ where: { id: target }, data: { status: 0 } });
    await execute();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).status).toBe(-1);
  });
  it("denies a specific target without blocking a different authorized target", async () => {
    await bind("Deny");
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).status).toBe(1);
    await execute(other);
  });
  it.each(["personal", "private", "disabled", "wrong"])(
    "requires persisted global delete qualification: %s",
    async (kind) => {
      if (kind === "personal")
        await prisma.user.update({
          where: { id: actor },
          data: { groupId: null, permissionAdds: [Permission.USER_DELETE] },
        });
      if (kind === "private") await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      if (kind === "disabled") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      if (kind === "wrong")
        await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.USER_UPDATE] } });
      await bind("Allow");
      await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("blocks deletion of self and the current account's recovery owner", async () => {
    for (const id of [actor, owner]) await expect(execute(id)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([0, 1])("rejects targets at privilege level %s", async (level) => {
    await prisma.group.update({ where: { id: targetGroupId }, data: { level } });
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects unavailable and already deleted targets without leaking a profile", async () => {
    await expect(execute("missing")).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: target }, data: { status: -1 } });
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses role grants rather than inheriting the actor's global-group Allow", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "Delete role" } }),
      session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          roleId: role.id,
          subjectUserId: actor,
          sessionName: "Delete",
          tokenJtiHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60000),
        },
      }),
      req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    await expect(execute(target, req)).rejects.toMatchObject({ statusCode: 403 });
    await bind("Allow", target, "role", role.id);
    await expect(execute(other, req)).rejects.toMatchObject({ statusCode: 403 });
    await execute(target, req);
  });
  it("rejects a revoked role session before deletion", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "Delete revoked role" } }),
      session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          roleId: role.id,
          subjectUserId: actor,
          sessionName: "Delete",
          tokenJtiHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60000),
          status: 0,
        },
      }),
      req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    await bind("Allow", target, "role", role.id);
    await expect(execute(target, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("applies resource Deny to an authenticated AccessKey", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    await bind("Deny");
    await expect(execute(target, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects preserved-timestamp changes to the target's privilege group before SQL", async () => {
    const original = repository.remove.bind(repository),
      before = await prisma.group.findUniqueOrThrow({ where: { id: targetGroupId } });
    vi.spyOn(repository, "remove").mockImplementation(async (guard) => {
      await prisma.group.update({ where: { id: targetGroupId }, data: { level: 1, updateTime: before.updateTime } });
      return original(guard);
    });
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).status).toBe(1);
  });
  it("rejects changed actor levels even with preserved group timestamps", async () => {
    const original = repository.remove.bind(repository),
      before = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    vi.spyOn(repository, "remove").mockImplementation(async (guard) => {
      await prisma.group.update({ where: { id: groupId }, data: { level: 0, updateTime: before.updateTime } });
      return original(guard);
    });
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a newly inserted Deny between authorization and the write transaction", async () => {
    const original = repository.remove.bind(repository);
    vi.spyOn(repository, "remove").mockImplementation(async (guard) => {
      await bind("Deny");
      return original(guard);
    });
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back status and username when the final grant check fails after SQL", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: target } }),
      original = repository.remove.bind(repository);
    vi.spyOn(repository, "remove").mockImplementation(async (guard) => {
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
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target } })).toMatchObject({
      status: before.status,
      username: before.username,
    });
  });
  it("reevaluates trusted request conditions at commit and rolls back a newly denied deletion", async () => {
    await bind("Deny", target, "user", actor, { Bool: { "acs:SecureTransport": "false" } });
    const req = request(),
      original = repository.remove.bind(repository),
      before = await prisma.user.findUniqueOrThrow({ where: { id: target } });
    vi.spyOn(repository, "remove").mockImplementation(async (guard) => {
      const recheck = guard.users.recheck;
      let count = 0;
      return original({
        ...guard,
        users: {
          ...guard.users,
          recheck: async () => {
            if (++count > 1) Object.defineProperty(req, "secure", { value: false });
            await recheck();
          },
        },
      });
    });
    await expect(execute(target, req)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).username).toBe(before.username);
  });
  it("simulates a shadow deletion without saving status or a renamed username", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: target } });
    expect(await native.execute(target, actor, request(), false)).toBeUndefined();
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target } })).toMatchObject({
      status: before.status,
      username: before.username,
    });
  });
  it.each(["legacy", "shadow"] as const)("preserves legacy enforcement and deletes only once in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    await bind("Deny");
    const softDelete = vi.spyOn(UserRepository.getInstance(), "softDelete");
    await execute();
    expect(softDelete).toHaveBeenCalledTimes(1);
    vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
      hasPermission: false,
      checkedPermissions: [Permission.USER_DELETE],
      missingPermissions: [Permission.USER_DELETE],
    });
    await expect(execute(other)).rejects.toMatchObject({ statusCode: 403 });
  });
});
