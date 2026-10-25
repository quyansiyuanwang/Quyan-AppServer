import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { UserRepository } from "@/store/users/user.repository";
import { GroupRepository } from "@/store/users/group.repository";
import { PermissionService } from "@/services/users/permission.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { PermissionController } from "@/api/controllers/v1/users/permission.controller";
import { GroupController } from "@/api/controllers/v1/users/group.controller";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const users = UserRepository.getInstance();
const groups = GroupRepository.getInstance();
const service = PermissionService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, target: string, targetGroup: string;

beforeEach(async () => {
  env.security.iamAuthorizationMode = "legacy";
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined);
  owner = (
    await prisma.user.create({
      data: {
        username: "permission-cas-owner-" + randomUUID(),
        password: "fixture-only",
        userType: "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
  const actorGroup = await prisma.group.create({
    data: {
      username: "permission-cas-actor-" + randomUUID(),
      name: "Permission CAS fixture",
      accountOwnerId: owner,
      level: 1,
      permissions: [Permission.PERMISSION_ADD, Permission.GROUP_PERMISSION_ADD, Permission.RAM_USER_READ],
    },
  });
  targetGroup = (
    await prisma.group.create({
      data: {
        username: "permission-cas-target-" + randomUUID(),
        name: "Permission CAS target",
        accountOwnerId: owner,
        level: 99,
        permissions: [],
      },
    })
  ).id;
  actor = (
    await prisma.user.create({
      data: {
        username: "permission-cas-actor-" + randomUUID(),
        password: "fixture-only",
        userType: "ram_user",
        accountOwnerId: owner,
        parentUserId: owner,
        groupId: actorGroup.id,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
  target = (
    await prisma.user.create({
      data: {
        username: "permission-cas-target-" + randomUUID(),
        password: "fixture-only",
        userType: "ram_user",
        accountOwnerId: owner,
        parentUserId: owner,
        groupId: targetGroup,
        permissionAdds: [],
        permissionRemoves: [Permission.RAM_USER_READ],
      },
    })
  ).id;
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});

const run = <T>(operation: (request: TypedRequest) => Promise<T>) =>
  new AsyncResource("permission-cas-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId: actor },
      params: { groupId: targetGroup },
      body: { permissions: [Permission.RAM_USER_READ] },
      headers: {},
      secure: true,
      ip: "127.0.0.1",
      authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });

const mutations = [
  ["add", () => service.addUserPermissions(actor, target, [Permission.RAM_USER_READ])],
  ["remove", () => service.removeUserPermissions(actor, target, [Permission.RAM_USER_READ])],
  ["replace", () => service.setUserPermissionConfig(actor, target, { permissionAdds: [], permissionRemoves: [] })],
  ["clear", () => service.clearUserPermissionConfig(actor, target)],
] as const;

describe.each(["legacy", "shadow", "enforce"] as const)("permission snapshots in %s mode", (mode) => {
  it.each(mutations)("rejects %s when another writer adds a Deny after checks", async (_name, mutate) => {
    env.security.iamAuthorizationMode = mode;
    const original = users.compareAndSetPermissions.bind(users);
    vi.spyOn(users, "compareAndSetPermissions").mockImplementationOnce(async (expected, data) => {
      // Deliberately retain updateTime: raw JSON equality must still reject this stale write.
      await prisma.user.update({
        where: { id: target },
        data: {
          permissionRemoves: [Permission.RAM_USER_READ, Permission.RAM_USER_CREATE],
          updateTime: expected.updateTime,
        },
      });
      return original(expected, data);
    });
    await expect(mutate()).rejects.toMatchObject({ statusCode: 409 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).permissionRemoves).toEqual([
      Permission.RAM_USER_READ,
      Permission.RAM_USER_CREATE,
    ]);
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });

  it.each(["permissions", "groups"] as const)("binds the %s endpoint diff to its write snapshot", async (entry) => {
    env.security.iamAuthorizationMode = mode;
    const original = service.setGroupPermissions.bind(service);
    vi.spyOn(service, "setGroupPermissions").mockImplementationOnce(async (...args) => {
      // This now needs Remove, which the actor does not have. The checked Add-only diff is stale.
      await prisma.group.update({
        where: { id: targetGroup },
        data: {
          permissions: [Permission.RAM_USER_READ, Permission.RAM_USER_CREATE],
        },
      });
      return original(...args);
    });
    const body = { permissions: [Permission.RAM_USER_READ] };
    await expect(
      run((request) =>
        entry === "permissions"
          ? new PermissionController().setGroupPermissions(request, targetGroup, body)
          : new GroupController().setGroupPermissions(body, request, targetGroup),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await prisma.group.findUniqueOrThrow({ where: { id: targetGroup } })).permissions).toEqual([
      Permission.RAM_USER_READ,
      Permission.RAM_USER_CREATE,
    ]);
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
});

describe("repository permission compare-and-set", () => {
  it("permits exactly one of two writes using the same user snapshot", async () => {
    const snapshot = await users.findByIdWithGroup(target);
    if (!snapshot) throw new Error("Missing fixture");
    const results = await Promise.all([
      users.compareAndSetPermissions(snapshot, { permissionAdds: [Permission.RAM_USER_READ] }),
      users.compareAndSetPermissions(snapshot, {
        permissionRemoves: [Permission.RAM_USER_READ, Permission.RAM_USER_CREATE],
      }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const after = await users.findByIdWithGroup(target);
    expect(after!.updateTime.getTime()).toBeGreaterThan(snapshot.updateTime.getTime());
  });

  it.each([[], JSON.stringify([]), null])(
    "compares raw group JSON rather than its parsed permission list (%j)",
    async (permissions) => {
      const { Prisma } = await import("@prisma/client");
      await prisma.group.update({ where: { id: targetGroup }, data: { permissions: permissions ?? Prisma.JsonNull } });
      const snapshot = await groups.findById(targetGroup);
      if (!snapshot) throw new Error("Missing fixture");
      const results = await Promise.all([
        groups.compareAndSetPermissions(snapshot, [Permission.RAM_USER_READ]),
        groups.compareAndSetPermissions(snapshot, [Permission.RAM_USER_CREATE]),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await groups.compareAndSetPermissions(snapshot, [])).toBe(false);
    },
  );

  it("rejects target group hierarchy changes even when the user itself is unchanged", async () => {
    const snapshot = await users.findByIdWithGroup(target);
    if (!snapshot) throw new Error("Missing fixture");
    await prisma.group.update({ where: { id: targetGroup }, data: { level: 1 } });
    expect(await users.compareAndSetPermissions(snapshot, { permissionAdds: [Permission.RAM_USER_READ] })).toBe(false);
  });

  it("rejects ownership changes without trusting a same-timestamp snapshot", async () => {
    const snapshot = await users.findByIdWithGroup(target);
    if (!snapshot) throw new Error("Missing fixture");
    await prisma.user.update({
      where: { id: target },
      data: { accountOwnerId: actor, updateTime: snapshot.updateTime },
    });
    expect(await users.compareAndSetPermissions(snapshot, { permissionAdds: [Permission.RAM_USER_READ] })).toBe(false);
  });

  it("accepts a fresh snapshot after a conflict instead of retrying unchecked state", async () => {
    const snapshot = await groups.findById(targetGroup);
    if (!snapshot) throw new Error("Missing fixture");
    expect(await groups.compareAndSetPermissions(snapshot, [Permission.RAM_USER_READ])).toBe(true);
    expect(await groups.compareAndSetPermissions(snapshot, [])).toBe(false);
    const fresh = await groups.findById(targetGroup);
    expect(await groups.compareAndSetPermissions(fresh!, [Permission.RAM_USER_CREATE])).toBe(true);
  });
});
