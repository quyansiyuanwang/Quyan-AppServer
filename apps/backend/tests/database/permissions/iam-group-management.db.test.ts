import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { GroupController } from "@/api/controllers/v1/users/group.controller";
import { RamService } from "@/services/users/ram.service";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";
import { Permission } from "@quyan/shared";
const controller = new GroupController(),
  ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, foreign: string;
const arn = (id: string) => "acs:quyan:*:" + owner + ":group/" + id;
const group = (accountOwnerId: string | null = owner, level = 99, permissions: Permission[] = []) =>
  prisma.group.create({
    data: {
      username: "iam-group-" + randomUUID(),
      name: "Group fixture",
      accountOwnerId,
      level,
      permissions,
    },
  });
async function grant(Action: string, Resource: string | string[], Effect: "Allow" | "Deny" = "Allow") {
  const policy = await ram.createPolicy(owner, {
    name: "group-policy-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action, Resource } },
  });
  await ram.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
const run = <T>(params: Record<string, string>, body: unknown, operation: (request: TypedRequest) => Promise<T>) =>
  new AsyncResource("iam-group-management-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId: actor },
      params,
      body,
      query: {},
      secure: true,
      ip: "127.0.0.1",
      headers: { "x-action": "quyan:group:Update", "x-account-id": foreign },
      authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "group-user-" + randomUUID(),
        password: "fixture-only",
        userType: accountOwnerId ? "ram_user" : "root",
        accountOwnerId,
        parentUserId: accountOwnerId,
        groupId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  foreign = await user();
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe("resource-authorized user group management", () => {
  it("allows only the granted group and keeps Read, Update and Delete distinct", async () => {
    const a = await group(),
      b = await group();
    await grant("quyan:group:Read", arn(a.id));
    await grant("quyan:group:Update", arn(a.id));
    expect((await run({ groupId: a.id }, {}, (req) => controller.getGroupById(a.id, req))).id).toBe(a.id);
    const body = { name: "Edited fixture" };
    await run({ groupId: a.id }, body, (req) => controller.updateGroup(body, req, a.id));
    await expect(run({ groupId: b.id }, body, (req) => controller.updateGroup(body, req, b.id))).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(run({ groupId: a.id }, {}, (req) => controller.deleteGroup(req, a.id))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.group.findUniqueOrThrow({ where: { id: b.id } })).name).toBe("Group fixture");
  });
  it("isolates candidates before pagination and permits advancing from an empty filtered page", async () => {
    await group(foreign, 100);
    await group(owner, 99);
    const allowed = await group(owner, 98);
    await grant("quyan:group:Read", ["acs:quyan:*:" + owner + ":account", arn(allowed.id)]);
    const first = await run({}, {}, (req) => controller.getAllGroups(req, 1, 1));
    expect(first).toEqual({ groups: [], page: 1, pageSize: 1, hasMore: true });
    expect(first).not.toHaveProperty("total");
    const second = await run({}, {}, (req) => controller.getAllGroups(req, 2, 1));
    expect(second.groups.map((g) => g.id)).toEqual([allowed.id]);
    expect(second.hasMore).toBe(false);
  });
  it("filters explicit Deny on individual list rows and bounds an unpaged request", async () => {
    const a = await group(owner, 99),
      b = await group(owner, 98);
    await grant("quyan:group:Read", "*");
    await grant("quyan:group:Read", arn(a.id), "Deny");
    const page = await run({}, {}, (req) => controller.getAllGroups(req));
    expect(page.pageSize).toBe(50);
    expect(page.groups.map((g) => g.id)).toEqual([b.id]);
    expect(page.total).toBeUndefined();
  });
  it("rejects foreign and unowned groups for both reads and writes despite wildcard Allow", async () => {
    const external = await group(foreign),
      unowned = await group(null);
    await grant("quyan:group:Read", "*");
    await grant("quyan:group:Update", "*");
    await grant("quyan:group:Delete", "*");
    for (const target of [external, unowned]) {
      await expect(
        run({ groupId: target.id }, {}, (req) => controller.getGroupById(target.id, req)),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        run({ groupId: target.id }, {}, (req) => controller.getGroupPermissions(target.id, req)),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        run({ groupId: target.id }, { name: "Forbidden" }, (req) =>
          controller.updateGroup({ name: "Forbidden" }, req, target.id),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        run({ groupId: target.id }, {}, (req) => controller.deleteGroup(req, target.id)),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
  });
  it("assigns new group ownership from the authenticated account", async () => {
    await grant("quyan:group:Create", "acs:quyan:*:" + owner + ":account");
    const body = { username: "new-group-" + randomUUID().slice(0, 15), level: 99 };
    const created = await run({}, { ...body, accountOwnerId: foreign }, (req) => controller.createGroup(body, req));
    expect((await prisma.group.findUniqueOrThrow({ where: { id: created.id } })).accountOwnerId).toBe(owner);
  });
  it("does not disclose members of a foreign account through group counts", async () => {
    const a = await group();
    await user(owner, a.id);
    await user(foreign, a.id);
    await grant("quyan:group:Read", ["acs:quyan:*:" + owner + ":account", arn(a.id)]);
    const page = await run({}, {}, (req) => controller.getAllGroups(req, 1, 10));
    expect(page.groups[0].userCount).toBe(1);
    expect((await run({ groupId: a.id }, {}, (req) => controller.getGroupById(a.id, req))).userCount).toBe(1);
    await grant("quyan:group:Update", arn(a.id));
    expect((await run({ groupId: a.id }, {}, (req) => controller.updateGroup({}, req, a.id))).userCount).toBe(1);
  });
  it("requires both target-operation grants and real delegation before changing group permissions", async () => {
    const a = await group();
    await grant("quyan:group:permission:Add", arn(a.id));
    const body = { permissions: [Permission.RAM_USER_READ] };
    await expect(
      run({ groupId: a.id }, body, (req) => controller.setGroupPermissions(body, req, a.id)),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.group.findUniqueOrThrow({ where: { id: a.id } })).permissions).toEqual([]);
    await grant("quyan:ram:ReadUser", ["acs:quyan:*:" + owner + ":account", "acs:quyan:*:" + owner + ":user/*"]);
    await run({ groupId: a.id }, body, (req) => controller.setGroupPermissions(body, req, a.id));
    await expect(
      run({ groupId: a.id }, { permissions: [] }, (req) =>
        controller.setGroupPermissions({ permissions: [] }, req, a.id),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:group:permission:Remove", arn(a.id));
    await run({ groupId: a.id }, { permissions: [] }, (req) =>
      controller.setGroupPermissions({ permissions: [] }, req, a.id),
    );
  });
  it("keeps the real account-owner recovery group visible but does not lend it to a sub-user", async () => {
    const recovery = await prisma.group.upsert({
      where: { username: env.security.superAdminGroupUsername },
      create: {
        username: env.security.superAdminGroupUsername,
        accountOwnerId: null,
        level: 0,
        permissions: [Permission.GROUP_READ],
      },
      update: { accountOwnerId: null, level: 0, permissions: [Permission.GROUP_READ] },
    });
    await prisma.user.update({ where: { id: owner }, data: { groupId: recovery.id } });
    actor = owner;
    expect((await run({}, {}, (req) => controller.getAllGroups(req, 1, 10))).groups.map((g) => g.id)).toContain(
      recovery.id,
    );
    actor = await user(owner, recovery.id);
    await expect(
      run({ groupId: recovery.id }, {}, (req) => controller.getGroupById(recovery.id, req)),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await run({}, {}, (req) => controller.getAllGroups(req, 1, 10))).groups).toEqual([]);
  });
  it("keeps keyword and RAM-permission filters inside the account boundary", async () => {
    const same = await group(owner, 99, [Permission.RAM_USER_READ]);
    const external = await group(foreign, 99, [Permission.RAM_USER_READ]);
    await prisma.group.updateMany({
      where: { id: { in: [same.id, external.id] } },
      data: { name: "matching fixture" },
    });
    await group(owner, 99, []);
    await grant("quyan:group:Read", "*");
    const page = await run({}, {}, (req) => controller.getAllGroups(req, 1, 10, "matching", true));
    expect(page.groups.map((g) => g.id)).toEqual([same.id]);
    await expect(run({}, {}, (req) => controller.getAllGroups(req, 1, 101))).rejects.toMatchObject({ statusCode: 400 });
  });
});
