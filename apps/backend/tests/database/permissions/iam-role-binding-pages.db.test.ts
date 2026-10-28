import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { RamController } from "@/api/controllers/v1/users/ram.controller";
import { Permission } from "@quyan/shared";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";
const service = RamService.getInstance(),
  controller = new RamController(),
  mode = env.security.iamAuthorizationMode;
let owner: string, actor: string, foreign: string, roleId: string;
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "binding-page-" + randomUUID(),
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
const group = (accountOwnerId = owner) =>
  prisma.group.create({ data: { username: "binding-group-" + randomUUID(), accountOwnerId, permissions: [] } });
const role = (accountOwnerId = owner) =>
  prisma.ramRole.create({ data: { accountOwnerId, name: "binding-role-" + randomUUID() } });
const arn = (kind: string, id: string) => "acs:quyan:*:" + owner + ":" + kind + "/" + id;
async function grant(resource: string | string[], effect: "Allow" | "Deny" = "Allow") {
  const policy = await service.createPolicy(owner, {
    name: "binding-grant-" + randomUUID(),
    document: { Version: "1", Statement: { Effect: effect, Action: "quyan:ram:binding:Read", Resource: resource } },
  });
  await service.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
const bindUser = (userId: string, accountOwnerId = owner, id = roleId) =>
  prisma.ramUserRoleBinding.create({ data: { accountOwnerId, roleId: id, userId } });
const bindGroup = (groupId: string, accountOwnerId = owner) =>
  prisma.ramGroupRoleBinding.create({ data: { accountOwnerId, roleId, groupId } });
const run = <T>(operation: (request: TypedRequest) => Promise<T>) =>
  new AsyncResource("binding-page-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId: actor },
      headers: {},
      ip: "127.0.0.1",
      secure: true,
      params: { roleId },
      query: {},
      authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  foreign = await user();
  roleId = (await role()).id;
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("bounded resource-authorized role binding relations", () => {
  it("requires both parent role access and row target access, retaining Deny and empty-page continuation", async () => {
    const allowed = await user(owner),
      denied = await user(owner);
    const a = await bindUser(allowed),
      b = await bindUser(denied);
    await prisma.ramUserRoleBinding.update({
      where: { id: a.id },
      data: { createTime: new Date("2020-01-01T00:00:00Z") },
    });
    await grant([arn("role", roleId), arn("user", allowed), arn("user", denied)]);
    await grant(arn("user", denied), "Deny");
    const first = await run((request) => controller.listRoleBindingsPage(roleId, request, 1, 1));
    expect(first.items).toEqual([]);
    expect(first.hasNext).toBe(true);
    const next = await run((request) => controller.listRoleBindingsPage(roleId, request, 2, 1));
    expect(next.items.map((item) => item.id)).toEqual([a.id]);
    expect(next.hasNext).toBe(false);
    expect((await run((request) => controller.listRoleBindings(roleId, request))).map((item) => item.id)).toEqual([
      a.id,
    ]);
    expect((await service.listRoleBindingPage(actor, roleId)).items.map((item) => item.id)).toEqual([a.id]);
    expect(next).not.toHaveProperty("total");
    expect(next.items.some((item) => item.id === b.id)).toBe(false);
  });
  it("does not expose any target when only the parent role is readable", async () => {
    const a = await user(owner);
    await bindUser(a);
    await grant(arn("role", roleId));
    expect((await run((request) => controller.listRoleBindingsPage(roleId, request))).items).toEqual([]);
  });
  it("checks parent access for internal callers and cannot borrow another role's collection grant", async () => {
    const a = await user(owner);
    await bindUser(a);
    await grant(arn("user", a));
    await expect(service.listRoleBindingPage(actor, roleId)).rejects.toMatchObject({ statusCode: 403 });
    const other = await role(foreign);
    await expect(service.listRoleBindingPage(actor, other.id)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("paginates direct users then groups without loading unbounded lists and keeps permission summaries", async () => {
    const a = await user(owner),
      b = await user(owner),
      g = await group();
    const bindings = [await bindUser(a), await bindUser(b)];
    const c = await bindGroup(g.id);
    await grant("*");
    const summary = await service.createPolicy(owner, {
      name: "summary-" + randomUUID(),
      permissions: [Permission.ARTICLE_READ],
    });
    await service.attachPolicy(owner, { policyId: summary.id, targetType: "role", targetId: roleId });
    const first = await run((request) => controller.listRoleBindingsPage(roleId, request, 1, 2));
    expect(first.items.map((item) => item.id).sort()).toEqual(bindings.map((item) => item.id).sort());
    expect(
      first.items.every((item) => item.source === "user" && item.permissions.includes(Permission.ARTICLE_READ)),
    ).toBe(true);
    expect(first.hasNext).toBe(true);
    const last = await run((request) => controller.listRoleBindingsPage(roleId, request, 2, 2));
    expect(last.items.map((item) => item.id)).toEqual([c.id]);
    expect(last.items[0]!.source).toBe("group");
    expect(last.hasNext).toBe(false);
  });
  it("excludes foreign, disabled and inconsistent binding records before the candidate page", async () => {
    const same = await user(owner),
      external = await user(foreign),
      disabled = await user(owner);
    const g = await group(),
      foreignGroup = await group(foreign);
    const allowed = await bindUser(same),
      validGroup = await bindGroup(g.id);
    await bindUser(external);
    await bindUser(same, foreign);
    await bindGroup(foreignGroup.id);
    const revoked = await bindUser(disabled);
    await prisma.ramUserRoleBinding.update({ where: { id: revoked.id }, data: { status: 0 } });
    const deletedUser = await user(owner);
    await bindUser(deletedUser);
    await prisma.user.update({ where: { id: deletedUser }, data: { status: -1 } });
    const disabledGroup = await group();
    await bindGroup(disabledGroup.id);
    await prisma.group.update({ where: { id: disabledGroup.id }, data: { status: 0 } });
    await grant("*");
    const result = await run((request) => controller.listRoleBindingsPage(roleId, request, 1, 100));
    expect(result.items.map((item) => item.id).sort()).toEqual([allowed.id, validGroup.id].sort());
    expect(result.hasNext).toBe(false);
  });
  it("validates filtered users against the account and selects their direct and inherited bindings", async () => {
    const g = await group(),
      a = await user(owner, g.id),
      other = await user(owner);
    const direct = await bindUser(a),
      inherited = await bindGroup(g.id);
    await bindUser(other);
    await grant("*");
    const result = await run((request) => controller.listRoleBindingsPage(roleId, request, 1, 100, a));
    expect(result.items.map((item) => item.id).sort()).toEqual([direct.id, inherited.id].sort());
    await expect(service.listRoleBindingPage(actor, roleId, { userId: foreign })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.listRoleBindingPage(actor, roleId, { page: 0 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.listRoleBindingPage(actor, roleId, { pageSize: 101 })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(service.listRoleBindingPage(actor, roleId, { userId: "" })).rejects.toMatchObject({ statusCode: 400 });
  });
  it("preserves legacy/shadow entry gates while paging real account-scoped bindings", async () => {
    const a = await user(owner);
    const b = await bindUser(a);
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RAM_BINDING_READ] } });
    for (const authorizationMode of ["legacy", "shadow"] as const) {
      env.security.iamAuthorizationMode = authorizationMode;
      expect(
        (await run((request) => controller.listRoleBindingsPage(roleId, request))).items.map((item) => item.id),
      ).toEqual([b.id]);
    }
  });
});
