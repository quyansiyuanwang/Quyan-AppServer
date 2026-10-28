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
  controller = new RamController();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, foreign: string;
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "ram-page-user-" + randomUUID(),
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
const run = <T>(operation: (request: TypedRequest) => Promise<T>) =>
  new AsyncResource("user-session-page-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId: actor },
      headers: { "x-action": "*" },
      secure: true,
      ip: "127.0.0.1",
      authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });
const grant = async (action: string, resource: string | string[], effect: "Allow" | "Deny" = "Allow") => {
  const policy = await service.createPolicy(owner, {
    name: "page-grant-" + randomUUID(),
    document: { Version: "1", Statement: { Effect: effect, Action: action, Resource: resource } },
  });
  await service.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
};
const arn = (kind: string, id?: string) => "acs:quyan:*:" + owner + ":" + (id ? kind + "/" + id : kind);
const session = async (accountOwnerId = owner, subjectUserId = actor, roleOwner = accountOwnerId) => {
  const role = await prisma.ramRole.create({
    data: { accountOwnerId: roleOwner, name: "session-role-" + randomUUID() },
  });
  return prisma.ramRoleSession.create({
    data: {
      accountOwnerId,
      subjectUserId,
      roleId: role.id,
      sessionName: "fixture",
      expiresAt: new Date(Date.now() + 60000),
    },
  });
};
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  foreign = await user();
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe("bounded RAM identity and session views", () => {
  it("keeps user account constraints in SQL and rejects conflicting legacy parent ownership", async () => {
    const allowed = await user(owner),
      external = await user(foreign),
      conflicting = await user(foreign),
      legacy = await user(owner);
    await prisma.user.update({ where: { id: conflicting }, data: { parentUserId: owner } });
    await prisma.user.update({ where: { id: legacy }, data: { accountOwnerId: null } });
    await grant("quyan:ram:ReadUser", "*");
    const result = await run((request) => controller.listUsersPage(request, 1, 100));
    expect(result.items.map((item) => item.id).sort()).toEqual([actor, allowed, legacy].sort());
    expect(result.items.some((item) => [external, conflicting, owner].includes(item.id))).toBe(false);
    expect(result).not.toHaveProperty("total");
    expect(result.items.every((item) => item.accessKeySecret === null)).toBe(true);
  });
  it("advances denied user candidate pages and filters the old array endpoint as well", async () => {
    const allowed = await user(owner),
      denied = await user(owner);
    await prisma.user.update({ where: { id: actor }, data: { createTime: new Date("2010-01-01T00:00:00Z") } });
    await prisma.user.update({ where: { id: allowed }, data: { createTime: new Date("2020-01-01T00:00:00Z") } });
    await grant("quyan:ram:ReadUser", [arn("account"), arn("user", allowed), arn("user", denied)]);
    await grant("quyan:ram:ReadUser", arn("user", denied), "Deny");
    const first = await run((request) => controller.listUsersPage(request, 1, 1));
    expect(first.items).toEqual([]);
    expect(first.hasNext).toBe(true);
    const second = await run((request) => controller.listUsersPage(request, 2, 1));
    expect(second.items.map((item) => item.id)).toEqual([allowed]);
    expect((await run((request) => controller.listUsers(request))).map((item) => item.id)).toEqual([allowed]);
  });
  it("retains active group level restrictions and applies no fabricated group to an ungrouped actor", async () => {
    const low = await prisma.group.create({
      data: { username: "low-" + randomUUID(), accountOwnerId: owner, level: 10, permissions: [] },
    });
    const high = await prisma.group.create({
      data: { username: "high-" + randomUUID(), accountOwnerId: owner, level: 20, permissions: [] },
    });
    await prisma.user.update({ where: { id: actor }, data: { groupId: high.id } });
    const a = await user(owner, low.id),
      b = await user(owner, high.id),
      ungrouped = await user(owner);
    await grant("quyan:ram:ReadUser", "*");
    const result = await run((request) => controller.listUsersPage(request));
    expect(result.items.map((item) => item.id).sort()).toEqual([actor, b].sort());
    expect(result.items.some((item) => [a, ungrouped].includes(item.id))).toBe(false);
  });
  it("keeps sessions active and account-consistent and filters revoked, expired and foreign relations", async () => {
    const allowed = await session(),
      other = await session(foreign, foreign);
    const wrongRole = await session(owner, actor, foreign),
      wrongSubject = await session(owner, foreign);
    const revoked = await session(),
      expired = await session(),
      disabled = await session();
    await prisma.ramRoleSession.update({ where: { id: revoked.id }, data: { revokedAt: new Date() } });
    await prisma.ramRoleSession.update({
      where: { id: expired.id },
      data: { expiresAt: new Date("2020-01-01T00:00:00Z") },
    });
    await prisma.ramRoleSession.update({ where: { id: disabled.id }, data: { status: 0 } });
    await grant("quyan:ram:session:Read", "*");
    const result = await run((request) => controller.listSessionsPage(request, 1, 100));
    expect(result.items.map((item) => item.id)).toEqual([allowed.id]);
    expect(
      result.items.some((item) =>
        [other, wrongRole, wrongSubject, revoked, expired, disabled].some((s) => s.id === item.id),
      ),
    ).toBe(false);
    expect(result).not.toHaveProperty("total");
    expect(result.items[0]).not.toHaveProperty("tokenJtiHash");
  });
  it("applies session Deny to each row while retaining continuation and principal filters", async () => {
    const allowed = await session(),
      denied = await session();
    await prisma.ramRoleSession.update({
      where: { id: allowed.id },
      data: { createTime: new Date("2020-01-01T00:00:00Z") },
    });
    await grant("quyan:ram:session:Read", [
      arn("account"),
      arn("role-session", allowed.id),
      arn("role-session", denied.id),
    ]);
    await grant("quyan:ram:session:Read", arn("role-session", denied.id), "Deny");
    const first = await run((request) => controller.listSessionsPage(request, 1, 1, actor));
    expect(first.items).toEqual([]);
    expect(first.hasNext).toBe(true);
    const last = await run((request) => controller.listSessionsPage(request, 2, 1, actor));
    expect(last.items.map((item) => item.id)).toEqual([allowed.id]);
    expect(last.hasNext).toBe(false);
    expect((await run((request) => controller.listSessions(request, actor))).map((item) => item.id)).toEqual([
      allowed.id,
    ]);
    expect((await service.listRoleSessionPage(actor, { principalUserId: foreign })).items).toEqual([]);
  });
  it("returns empty unauthorized collections, bounds query inputs and preserves historical mode results", async () => {
    expect((await run((request) => controller.listUsersPage(request))).items).toEqual([]);
    expect((await run((request) => controller.listSessionsPage(request))).items).toEqual([]);
    await expect(service.listRamUserPage(actor, { page: 0 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.listRoleSessionPage(actor, { pageSize: 101 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.listRoleSessionPage(actor, { principalUserId: "" })).rejects.toMatchObject({
      statusCode: 400,
    });
    const group = await prisma.group.create({
      data: { username: "compat-" + randomUUID(), level: 10, permissions: [] },
    });
    const target = await user(owner, group.id),
      current = await session();
    await prisma.user.update({
      where: { id: actor },
      data: { groupId: group.id, permissionAdds: [Permission.RAM_USER_READ, Permission.RAM_SESSION_READ] },
    });
    for (const mode of ["legacy", "shadow"] as const) {
      env.security.iamAuthorizationMode = mode;
      expect((await run((request) => controller.listUsersPage(request))).items.map((item) => item.id).sort()).toEqual(
        [actor, target].sort(),
      );
      expect((await run((request) => controller.listSessionsPage(request))).items.map((item) => item.id)).toEqual([
        current.id,
      ]);
    }
  });
});
