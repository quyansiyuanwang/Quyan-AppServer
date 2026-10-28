import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";
import type { IamManagementPageResult } from "@quyan/shared";
const service = RamService.getInstance(),
  originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, foreign: string, keyword: string;
const createUser = async (accountOwnerId?: string, name?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "search-user-" + randomUUID(),
        password: "fixture-only",
        name,
        userType: accountOwnerId ? "ram_user" : "root",
        accountOwnerId,
        parentUserId: accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const run = <T>(operation: () => Promise<T>) =>
  new AsyncResource("iam-search-fixture").runInAsyncScope(async () => {
    setRequestContext({
      user: { userId: actor },
      headers: {},
      secure: true,
      params: {},
      query: {},
      body: {},
      authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
    } as unknown as TypedRequest);
    return operation();
  });
const entities: {
  kind: string;
  action: string;
  create: (account: string, term: string) => Promise<string>;
  page: (query: {
    page?: number;
    pageSize?: number;
    keyword?: string;
  }) => Promise<IamManagementPageResult<{ id: string }>>;
}[] = [
  {
    kind: "user",
    action: "quyan:ram:ReadUser",
    create: (account: string, term: string) => createUser(account, term),
    page: (query: { page?: number; pageSize?: number; keyword?: string }) => service.listRamUserPage(actor, query),
  },
  {
    kind: "role",
    action: "quyan:ram:role:Read",
    create: async (account: string, term: string) =>
      (await prisma.ramRole.create({ data: { accountOwnerId: account, name: randomUUID(), description: term } })).id,
    page: (query: { page?: number; pageSize?: number; keyword?: string }) => service.listRolesPage(actor, query),
  },
  {
    kind: "policy",
    action: "quyan:ram:ReadPolicy",
    create: async (account: string, term: string) =>
      (
        await service.createPolicy(account, {
          name: randomUUID(),
          description: term,
          document: {
            Version: "1",
            Statement: {
              Effect: "Allow",
              Action: "quyan:ram:ReadUser",
              Resource: "acs:quyan:*:" + account + ":user/*",
            },
          },
        })
      ).id,
    page: (query: { page?: number; pageSize?: number; keyword?: string }) => service.listPoliciesPage(actor, query),
  },
  {
    kind: "resource-group",
    action: "quyan:ram:ListResourceGroups",
    create: async (account: string, term: string) =>
      (
        await prisma.ramResourceGroup.create({
          data: { accountOwnerId: account, name: randomUUID(), description: term },
        })
      ).id,
    page: (query: { page?: number; pageSize?: number; keyword?: string }) =>
      service.listResourceGroupPage(actor, query),
  },
];
async function grant(action: string, resources: string[], effect: "Allow" | "Deny") {
  const policy = await service.createPolicy(owner, {
    name: randomUUID(),
    document: { Version: "1", Statement: { Effect: effect, Action: action, Resource: resources } },
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
  owner = await createUser();
  actor = await createUser(owner);
  foreign = await createUser();
  keyword = "needle-" + randomUUID();
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe.each(entities)("IAM $kind server search", ({ kind, action, create, page }) => {
  it("filters before pagination, isolates accounts and never returns a matching denied resource", async () => {
    await create(owner, "other-" + randomUUID());
    const allowed = await create(owner, keyword),
      denied = await create(owner, keyword);
    await create(foreign, keyword);
    const arn = (id: string) => "acs:quyan:*:" + owner + ":" + kind + "/" + id;
    await grant(action, [arn(allowed), arn(denied)], "Allow");
    await grant(action, [arn(denied)], "Deny");
    const first = await run(() => page({ page: 1, pageSize: 1, keyword: "  " + keyword + "  " }));
    const second = await run(() => page({ page: 2, pageSize: 1, keyword }));
    expect(first.hasNext).toBe(true);
    expect(second.hasNext).toBe(false);
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual([allowed]);
    expect(first).not.toHaveProperty("total");
    expect((await run(() => page({ keyword: "absent-" + keyword }))).items).toEqual([]);
    await expect(run(() => page({ keyword: "x".repeat(101) }))).rejects.toMatchObject({ statusCode: 400 });
  });
});
it("can find a RAM user by its RAM login name without opening other account users", async () => {
  await prisma.user.update({ where: { id: actor }, data: { ramUsername: keyword } });
  await grant("quyan:ram:ReadUser", ["acs:quyan:*:" + owner + ":user/" + actor], "Allow");
  const result = await run(() => service.listRamUserPage(actor, { keyword }));
  expect(result.items.map((item) => item.id)).toEqual([actor]);
});
