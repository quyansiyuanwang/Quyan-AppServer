import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { RamService } from "@/services/users/ram.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { iamCollectionAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";
const service = RamService.getInstance(),
  mode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, role: string, policy: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "ram-admission-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram_user" : "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
    headers: { "x-action": "quyan:ram:DeleteUser" },
    secure: true,
  }) as unknown as TypedRequest;
async function run<T>(action: string, permission: Permission, operation: () => Promise<T>) {
  const req = request();
  return new AsyncResource("ram-collection-fixture").runInAsyncScope(async () => {
    setRequestContext(req);
    await new Promise<void>((resolve, reject) => {
      const result = iamCollectionAuthorizationMiddleware({
        action,
        resourceKind: "collection",
        resource: ramAccountResourceResolver,
        legacyPermissions: [permission],
      })(req, {} as never, (error) => (error ? reject(error) : resolve()));
      if (result) Promise.resolve(result).catch(reject);
    });
    return operation();
  });
}
const arn = (type: string, id: string) => "acs:quyan:*:" + owner + ":" + type + "/" + id;
async function grant(effect: "Allow" | "Deny", action: string, resource: string) {
  const grantPolicy = await service.createPolicy(owner, {
    name: "ram-collection-grant-" + randomUUID(),
    document: { Version: "1", Statement: { Effect: effect, Action: action, Resource: resource } },
  });
  await service.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: grantPolicy.id,
    scopeType: "account",
  });
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  role = (await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "ram-collection-role-" + randomUUID() } }))
    .id;
  policy = (
    await service.createPolicy(owner, {
      name: "ram-collection-policy-" + randomUUID(),
      document: {
        Version: "1",
        Statement: { Effect: "Allow", Action: "quyan:ram:UpdateUser", Resource: arn("user", peer) },
      },
    })
  ).id;
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("RAM collection resource admission", () => {
  it("admits a user-specific grant and excludes peers without requiring account access", async () => {
    const action = "quyan:ram:ReadUser";
    await grant("Allow", action, arn("user", actor));
    const principal = {
      subjectUserId: actor,
      principalUserId: actor,
      accountOwnerId: owner,
      subjectType: "sub_user" as const,
    };
    expect(
      (
        await IamAuthorizationService.getInstance().authorize({
          principal,
          action,
          resource: "acs:quyan:*:" + owner + ":account",
        })
      ).decision,
    ).toBe("ImplicitDeny");
    const page = await run(action, Permission.RAM_USER_READ, () => service.listRamUserPage(actor));
    expect(page.items.map((row) => row.id)).toEqual([actor]);
    expect(page).not.toHaveProperty("total");
    expect(await run(action, Permission.RAM_USER_READ, () => service.listRamUsers(actor))).toEqual(page.items);
  });
  it("admits role-specific and policy-specific grants without exposing other policies", async () => {
    await grant("Allow", "quyan:ram:role:Read", arn("role", role));
    await grant("Allow", "quyan:ram:ReadPolicy", arn("policy", policy));
    expect(
      (await run("quyan:ram:role:Read", Permission.RAM_ROLE_READ, () => service.listRolesPage(actor))).items.map(
        (row) => row.id,
      ),
    ).toEqual([role]);
    expect(
      (await run("quyan:ram:ReadPolicy", Permission.RAM_POLICY_READ, () => service.listPoliciesPage(actor))).items.map(
        (row) => row.id,
      ),
    ).toEqual([policy]);
  });
  it("returns empty collections for absent Allow and for explicit Deny", async () => {
    expect(
      (await run("quyan:ram:ReadUser", Permission.RAM_USER_READ, () => service.listRamUserPage(actor))).items,
    ).toEqual([]);
    await grant("Allow", "quyan:ram:ReadUser", arn("user", actor));
    await grant("Deny", "quyan:ram:ReadUser", arn("user", actor));
    expect(
      (await run("quyan:ram:ReadUser", Permission.RAM_USER_READ, () => service.listRamUserPage(actor))).items,
    ).toEqual([]);
  });
  it("keeps legacy denial authoritative while shadow diagnoses IAM", async () => {
    for (const selectedMode of ["legacy", "shadow"] as const) {
      env.security.iamAuthorizationMode = selectedMode;
      await expect(
        run("quyan:ram:ReadUser", Permission.RAM_USER_READ, () => service.listRamUserPage(actor)),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
  });
  it("admits only the specific group and applies scoped resource-group grants immediately", async () => {
    const createGroup = () =>
      prisma.group.create({
        data: {
          username: "collection-group-" + randomUUID(),
          name: "Scoped group",
          accountOwnerId: owner,
          permissions: [],
          level: 99,
        },
      });
    const allowed = await createGroup(),
      excluded = await createGroup();
    await grant("Allow", "quyan:group:Read", arn("group", allowed.id));
    const page = await run("quyan:group:Read", Permission.RAM_USER_READ, () => service.listVisibleGroupPage(actor));
    expect(page.items.map((row) => row.id)).toEqual([allowed.id]);
    expect(page).not.toHaveProperty("total");
    expect(await run("quyan:group:Read", Permission.RAM_USER_READ, () => service.listVisibleGroups(actor))).toEqual(
      page.items,
    );
    const scopedPolicy = await service.createPolicy(owner, {
      name: "scoped-group-list-" + randomUUID(),
      document: { Version: "1", Statement: { Effect: "Allow", Action: "quyan:group:Read", Resource: "*" } },
    });
    const resourceGroup = await service.createResourceGroup(owner, { name: "collection-scope-" + randomUUID() });
    await service.addResourceGroupMember(owner, resourceGroup.id, {
      resourceArn: arn("group", excluded.id),
    });
    await service.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: scopedPolicy.id,
      scopeType: "resource-group",
      scopeResourceId: resourceGroup.id,
    });
    expect(
      (await run("quyan:group:Read", Permission.RAM_USER_READ, () => service.listVisibleGroupPage(actor))).items.map(
        (row) => row.id,
      ),
    ).toEqual(expect.arrayContaining([allowed.id, excluded.id]));
    const member = await prisma.ramResourceGroupMember.findFirstOrThrow({
      where: { resourceGroupId: resourceGroup.id, resourceArn: arn("group", excluded.id) },
    });
    await service.removeResourceGroupMember(owner, resourceGroup.id, member.id);
    expect(
      (await run("quyan:group:Read", Permission.RAM_USER_READ, () => service.listVisibleGroupPage(actor))).items.map(
        (row) => row.id,
      ),
    ).toEqual([allowed.id]);
    await grant("Deny", "quyan:group:Read", arn("group", allowed.id));
    expect(
      (await run("quyan:group:Read", Permission.RAM_USER_READ, () => service.listVisibleGroupPage(actor))).items,
    ).toEqual([]);
  });
  it("fails closed when the active role session cannot be resolved", async () => {
    await grant("Allow", "quyan:ram:ReadUser", arn("user", actor));
    const req = request();
    req.authContext!.roleSessionId = "missing-session";
    req.authContext!.assumedRoleId = "missing-role";
    const denied = await new Promise<unknown>((resolve) => {
      void iamCollectionAuthorizationMiddleware({
        action: "quyan:ram:ReadUser",
        resourceKind: "collection",
        resource: ramAccountResourceResolver,
        legacyPermissions: [Permission.RAM_USER_READ],
      })(req, {} as never, (error) => resolve(error));
    });
    expect(denied).toMatchObject({ statusCode: 403 });
  });
});
