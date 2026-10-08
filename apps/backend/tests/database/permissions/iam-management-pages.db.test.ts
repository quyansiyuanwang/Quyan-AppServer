import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";
const service = RamService.getInstance();
const mode = env.security.iamAuthorizationMode;
let owner: string, child: string, foreign: string;
const run = <T>(operation: () => Promise<T>) =>
  new AsyncResource("management-page-fixture").runInAsyncScope(async () => {
    setRequestContext({
      user: { userId: child },
      authContext: { principalUserId: child, accountOwnerId: owner, subjectType: "sub_user" },
      headers: {},
      secure: true,
    } as unknown as TypedRequest);
    return operation();
  });
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "mgmt-page-" + randomUUID(),
          password: "fixture-only",
          userType: accountOwnerId ? "ram_user" : "root",
          accountOwnerId,
          parentUserId: accountOwnerId,
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  child = await user(owner);
  foreign = await user();
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("bounded IAM management views", () => {
  it("pages summaries without loading nested members and returns opaque continuation instead of raw totals", async () => {
    for (const accountOwnerId of [owner, owner, owner, foreign])
      await service.createResourceGroup(accountOwnerId, { name: "page-group-" + randomUUID() });
    const first = await service.listResourceGroupPage(owner, { page: 1, pageSize: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.hasNext).toBe(true);
    expect(first).not.toHaveProperty("total");
    expect(first.items.every((item) => item.accountOwnerId === owner && !("members" in item))).toBe(true);
    const last = await service.listResourceGroupPage(owner, { page: 2, pageSize: 2 });
    expect(last.items).toHaveLength(1);
    expect(last.hasNext).toBe(false);
    expect(last.items[0]!.id).not.toBe(first.items[0]!.id);
  });
  it("permits empty filtered candidate pages and still lets clients advance to a later allowed group", async () => {
    const older = await service.createResourceGroup(owner, { name: "allowed-" + randomUUID() });
    const newer = await service.createResourceGroup(owner, { name: "denied-" + randomUUID() });
    await prisma.ramResourceGroup.update({
      where: { id: older.id },
      data: { createTime: new Date("2020-01-01T00:00:00Z") },
    });
    const policy = await service.createPolicy(owner, {
      name: "page-grant-" + randomUUID(),
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:ram:ListResourceGroups",
          Resource: "acs:quyan:*:" + owner + ":resource-group/" + older.id,
        },
      },
    });
    await service.createAuthorization(owner, {
      principalType: "user",
      principalId: child,
      policyId: policy.id,
      scopeType: "account",
    });
    const first = await run(() => service.listResourceGroupPage(child, { page: 1, pageSize: 1 }));
    expect(first.items).toEqual([]);
    expect(first.hasNext).toBe(true);
    const second = await run(() => service.listResourceGroupPage(child, { page: 2, pageSize: 1 }));
    expect(second.items.map((item) => item.id)).toEqual([older.id]);
    expect(second.hasNext).toBe(false);
    expect(first.items.some((item) => item.id === newer.id)).toBe(false);
  });
  it("pages resource-group members on the server and rejects another account", async () => {
    const group = await service.createResourceGroup(owner, { name: "members-" + randomUUID() });
    for (const id of [owner, child])
      await service.addResourceGroupMember(owner, group.id, { resourceArn: "acs:quyan:*:" + owner + ":user/" + id });
    const first = await service.listResourceGroupMemberPage(owner, group.id, { page: 1, pageSize: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.hasNext).toBe(true);
    const last = await service.listResourceGroupMemberPage(owner, group.id, { page: 2, pageSize: 1 });
    expect(last.items).toHaveLength(1);
    expect(last.hasNext).toBe(false);
    expect(last.items[0]!.id).not.toBe(first.items[0]!.id);
    await expect(service.listResourceGroupMemberPage(foreign, group.id)).rejects.toMatchObject({ statusCode: 403 });
    await service.removeResourceGroupMember(owner, group.id, first.items[0]!.id);
    expect((await service.listResourceGroupMemberPage(owner, group.id)).items).toHaveLength(1);
  });
  it("keeps authorization candidate pages account-scoped with stable continuation and validates bounds", async () => {
    for (const target of [child, child, child]) {
      const policy = await service.createPolicy(owner, {
        name: "page-auth-" + randomUUID(),
        document: { Version: "1", Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: "*" } },
      });
      await service.createAuthorization(owner, {
        principalType: "user",
        principalId: target,
        policyId: policy.id,
        scopeType: "account",
      });
    }
    const first = await service.listAuthorizationPage(owner, {
      principalType: "user",
      principalId: child,
      page: 1,
      pageSize: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.hasNext).toBe(true);
    expect(first).not.toHaveProperty("total");
    expect((await service.listAuthorizationPage(owner, { page: 2, pageSize: 2 })).items).toHaveLength(1);
    expect((await service.listAuthorizationPage(foreign)).items).toEqual([]);
    await expect(service.listAuthorizationPage(owner, { pageSize: 101 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.listResourceGroupMemberPage(owner, "unused", { page: 0 })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
