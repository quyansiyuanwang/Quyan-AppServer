import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { RamController } from "@/api/controllers/v1/users/ram.controller";
import { buildAcsResource, Permission, type IamPolicyDocument } from "@quyan/shared";
import { setRequestContext } from "@/util/request-context";
import type { IamManagementPageResult } from "@quyan/shared";
import type { RamRoleDto, RamPolicyDto } from "@/api/dto/users/ram.dto";
import type { TypedRequest } from "@/types/express";
const service = RamService.getInstance(),
  controller = new RamController();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, child: string, foreign: string;
const arn = (type: string, id?: string) =>
  buildAcsResource({ service: "quyan", region: "*", accountId: owner, path: id ? type + "/" + id : type });
const run = <T>(operation: (request: TypedRequest) => Promise<T>, accountOwnerId = owner) =>
  new AsyncResource("iam-entity-page-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId: child },
      ip: "127.0.0.1",
      secure: true,
      headers: { "x-action": "*" },
      authContext: { principalUserId: child, accountOwnerId, subjectType: "sub_user" },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });
async function grant(document: IamPolicyDocument) {
  const policy = await service.createPolicy(owner, { name: "entity-grant-" + randomUUID(), document });
  await prisma.ramPolicy.update({ where: { id: policy.id }, data: { createTime: new Date("2010-01-01T00:00:00Z") } });
  await service.createAuthorization(owner, {
    principalType: "user",
    principalId: child,
    policyId: policy.id,
    scopeType: "account",
  });
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const createUser = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "entity-page-" + randomUUID(),
          password: "fixture-only",
          userType: accountOwnerId ? "ram_user" : "root",
          accountOwnerId,
          parentUserId: accountOwnerId,
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await createUser();
  await prisma.user.update({
    where: { id: owner },
    data: { permissionAdds: [Permission.RAM_ROLE_READ, Permission.RAM_POLICY_READ] },
  });
  child = await createUser(owner);
  foreign = await createUser();
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
type EntityPage = IamManagementPageResult<RamRoleDto | RamPolicyDto>;
const entities: {
  kind: string;
  action: string;
  create: (account: string, time: Date) => Promise<string>;
  page: (actor: string, query?: { page?: number; pageSize?: number }) => Promise<EntityPage>;
  legacy: (actor: string) => Promise<(RamRoleDto | RamPolicyDto)[]>;
  endpoint: (request: TypedRequest, page: number, size: number) => Promise<EntityPage>;
}[] = [
  {
    kind: "role",
    action: "quyan:ram:role:Read",
    create: async (account: string, time: Date) => {
      const role = await service.createRole(account, { name: "paged-role-" + randomUUID() });
      await prisma.ramRole.update({ where: { id: role.id }, data: { createTime: time } });
      return role.id;
    },
    page: (actor: string, query: { page?: number; pageSize?: number } = {}) => service.listRolesPage(actor, query),
    legacy: (actor: string) => service.listRoles(actor),
    endpoint: (request: TypedRequest, page: number, size: number) => controller.listRolesPage(request, page, size),
  },
  {
    kind: "policy",
    action: "quyan:ram:ReadPolicy",
    create: async (account: string, time: Date) => {
      const policy = await service.createPolicy(account, {
        name: "paged-policy-" + randomUUID(),
        document: {
          Version: "1",
          Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: "acs:quyan:*:" + account + ":user/*" },
        },
      });
      await prisma.ramPolicy.update({ where: { id: policy.id }, data: { createTime: time } });
      return policy.id;
    },
    page: (actor: string, query: { page?: number; pageSize?: number } = {}) => service.listPoliciesPage(actor, query),
    legacy: (actor: string) => service.listPolicies(actor),
    endpoint: (request: TypedRequest, page: number, size: number) => controller.listPoliciesPage(request, page, size),
  },
];
describe.each(entities)("bounded $kind management", ({ kind, action, create, page, legacy, endpoint }) => {
  it("keeps candidate pages bounded, stable, active and inside one account", async () => {
    const time = new Date("2021-01-01T00:00:00Z");
    const ids = [await create(owner, time), await create(owner, time), await create(owner, time)].sort();
    await create(foreign, new Date("2025-01-01T00:00:00Z"));
    const disabled = await create(owner, time);
    if (kind === "role") await prisma.ramRole.update({ where: { id: disabled }, data: { status: 0 } });
    else await prisma.ramPolicy.update({ where: { id: disabled }, data: { status: 0 } });
    const first = await page(owner, { page: 1, pageSize: 2 });
    expect(first.items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    expect(first.hasNext).toBe(true);
    expect(first).not.toHaveProperty("total");
    const last = await page(owner, { page: 2, pageSize: 2 });
    expect(last.items.map((item) => item.id)).toEqual(ids.slice(2));
    expect(last.hasNext).toBe(false);
  });
  it("does not treat collection permission as row permission and advances across an empty filtered page", async () => {
    const allowed = await create(owner, new Date("2020-01-01T00:00:00Z"));
    const denied = await create(owner, new Date("2021-01-01T00:00:00Z"));
    await grant({
      Version: "1",
      Statement: [
        { Effect: "Allow", Action: action, Resource: [arn("account"), arn(kind, allowed), arn(kind, denied)] },
        { Effect: "Deny", Action: action, Resource: arn(kind, denied) },
      ],
    });
    const first = await run((request) => endpoint(request, 1, 1));
    expect(first.items).toEqual([]);
    expect(first.hasNext).toBe(true);
    const second = await run((request) => endpoint(request, 2, 1));
    expect(second.items.map((item) => item.id)).toEqual([allowed]);
    if (kind === "policy") expect(second.items[0]).toMatchObject({ document: { Version: "1" }, defaultVersion: 1 });
    expect((await run(() => legacy(child))).map((item) => item.id)).toEqual([allowed]);
    expect((await page(child)).items.map((item) => item.id)).toEqual([allowed]);
    await expect(run((request) => endpoint(request, 1, 1), foreign)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires row Allow even when the collection is readable", async () => {
    await create(owner, new Date("2021-01-01T00:00:00Z"));
    await grant({ Version: "1", Statement: { Effect: "Allow", Action: action, Resource: arn("account") } });
    expect((await run((request) => endpoint(request, 1, 10))).items).toEqual([]);
  });
  it("validates page bounds and preserves legacy/shadow array results", async () => {
    const target = await create(owner, new Date("2021-01-01T00:00:00Z"));
    await expect(page(owner, { page: 0 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(page(owner, { pageSize: 101 })).rejects.toMatchObject({ statusCode: 400 });
    for (const mode of ["legacy", "shadow"] as const) {
      env.security.iamAuthorizationMode = mode;
      expect((await legacy(child)).map((item) => item.id)).toEqual([target]);
      expect((await page(child, { pageSize: 1 })).items.map((item) => item.id)).toEqual([target]);
    }
  });
});
it("retains the permission summary of readable roles after pagination", async () => {
  const role = await service.createRole(owner, { name: "role-summary-" + randomUUID() });
  const policy = await service.createPolicy(owner, {
    name: "summary-policy-" + randomUUID(),
    permissions: [Permission.ARTICLE_READ],
  });
  await service.attachPolicy(owner, { policyId: policy.id, targetType: "role", targetId: role.id });
  expect((await service.listRolesPage(owner)).items[0]).toMatchObject({
    id: role.id,
    permissions: [Permission.ARTICLE_READ],
  });
});
