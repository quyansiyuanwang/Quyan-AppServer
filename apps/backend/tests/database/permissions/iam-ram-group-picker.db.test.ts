import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { RamController } from "@/api/controllers/v1/users/ram.controller";
import { buildAcsResource, Permission } from "@quyan/shared";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";
const service = RamService.getInstance(),
  controller = new RamController();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, foreign: string;
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "ram-picker-user-" + randomUUID(),
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
const group = (accountOwnerId: string | null = owner, level = 10, name = "picker fixture") =>
  prisma.group.create({
    data: {
      username: "ram-picker-group-" + randomUUID(),
      name,
      accountOwnerId,
      level,
      permissions: [],
    },
  });
const arn = (id?: string) =>
  buildAcsResource({ service: "quyan", region: "*", accountId: owner, path: id ? "group/" + id : "account" });
const run = <T>(
  operation: (request: TypedRequest) => Promise<T>,
  type: "root" | "sub_user" | "access_key" = "sub_user",
) =>
  new AsyncResource("ram-group-picker-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId: actor },
      headers: { "x-action": "quyan:ram:ReadUser", "x-account-id": foreign },
      secure: true,
      ip: "127.0.0.1",
      query: {},
      params: {},
      authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: type },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });
async function grant(resources: string | string[], effect: "Allow" | "Deny" = "Allow", action = "quyan:group:Read") {
  const policy = await service.createPolicy(owner, {
    name: "picker-policy-" + randomUUID(),
    document: {
      Version: "1",
      Statement: { Effect: effect, Action: action, Resource: resources },
    },
  });
  await service.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  foreign = await user();
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe("RAM group choices share account and IAM boundaries", () => {
  it("isolates candidates and user counts in the database before returning group options", async () => {
    const a = await group();
    await group(foreign);
    await group(null);
    await user(owner, a.id);
    await user(foreign, a.id);
    await grant("*");
    const result = await run((request) => controller.listVisibleGroupPage(request, 1, 10));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: a.id, userCount: 1 });
    expect(result).not.toHaveProperty("total");
    expect(result.hasNext).toBe(false);
    expect((await run((request) => controller.listVisibleGroups(request))).map((item) => item.id)).toEqual([a.id]);
  });
  it("allows an empty denied page to advance to a later permitted group", async () => {
    const first = await group(owner, 20),
      second = await group(owner, 10);
    await grant([arn(), arn(first.id), arn(second.id)]);
    await grant(arn(first.id), "Deny");
    const denied = await run((request) => controller.listVisibleGroupPage(request, 1, 1));
    expect(denied.items).toEqual([]);
    expect(denied.hasNext).toBe(true);
    const allowed = await run((request) => controller.listVisibleGroupPage(request, 2, 1));
    expect(allowed.items.map((item) => item.id)).toEqual([second.id]);
    expect(allowed.hasNext).toBe(false);
    expect((await service.listVisibleGroupPage(actor)).items.map((item) => item.id)).toEqual([second.id]);
  });
  it("requires both collection and group read grants instead of borrowing user read permission", async () => {
    const candidate = await group();
    await grant(arn(), "Allow", "quyan:ram:ReadUser");
    await expect(run((request) => controller.listVisibleGroupPage(request))).rejects.toMatchObject({ statusCode: 403 });
    await grant(arn());
    expect((await run((request) => controller.listVisibleGroupPage(request))).items).toEqual([]);
    await grant(arn(candidate.id));
    expect((await run((request) => controller.listVisibleGroupPage(request))).items.map((item) => item.id)).toEqual([
      candidate.id,
    ]);
  });
  it("keeps keyword, active status and the historical group level rule inside the account scope", async () => {
    const membership = await group(owner, 20, "actor group");
    await prisma.user.update({ where: { id: actor }, data: { groupId: membership.id } });
    const allowed = await group(owner, 30, "team match");
    await group(owner, 10, "team match");
    await group(foreign, 30, "team match");
    const disabled = await group(owner, 30, "team match");
    await prisma.group.update({ where: { id: disabled.id }, data: { status: 0 } });
    await grant("*");
    const result = await run((request) => controller.listVisibleGroupPage(request, 1, 10, "team"));
    expect(result.items.map((item) => item.id)).toEqual([allowed.id]);
  });
  it("restricts the unowned recovery group to the real root identity, not a sub-user or AccessKey", async () => {
    const recovery = await prisma.group.upsert({
      where: { username: env.security.superAdminGroupUsername },
      create: {
        username: env.security.superAdminGroupUsername,
        accountOwnerId: null,
        level: 0,
        permissions: [Permission.GROUP_READ, Permission.RAM_USER_READ],
      },
      update: { accountOwnerId: null, level: 0, permissions: [Permission.GROUP_READ, Permission.RAM_USER_READ] },
    });
    await prisma.user.update({ where: { id: owner }, data: { groupId: recovery.id } });
    actor = owner;
    expect(
      (await run((request) => controller.listVisibleGroupPage(request), "root")).items.map((item) => item.id),
    ).toContain(recovery.id);
    expect((await run((request) => controller.listVisibleGroupPage(request), "access_key")).items).toEqual([]);
    actor = await user(owner, recovery.id);
    expect((await run((request) => controller.listVisibleGroupPage(request))).items).toEqual([]);
  });
  it("bounds the new API and retains legacy/shadow entry permission and group choices", async () => {
    await expect(service.listVisibleGroupPage(actor, { page: 0 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.listVisibleGroupPage(actor, { pageSize: 101 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.listVisibleGroupPage(actor, { keyword: "x".repeat(101) })).rejects.toMatchObject({
      statusCode: 400,
    });
    const candidate = await group(owner, 99, "legacy choice"),
      external = await group(foreign, 99, "legacy choice");
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RAM_USER_READ] } });
    for (const mode of ["legacy", "shadow"] as const) {
      env.security.iamAuthorizationMode = mode;
      const first = await run((request) => controller.listVisibleGroupPage(request, 1, 1, "legacy choice"));
      expect(first.items).toHaveLength(1);
      expect(first.hasNext).toBe(true);
      const second = await run((request) => controller.listVisibleGroupPage(request, 2, 1, "legacy choice"));
      expect([first.items[0]!.id, second.items[0]!.id].sort()).toEqual([candidate.id, external.id].sort());
      expect(second.hasNext).toBe(false);
    }
  });
});
