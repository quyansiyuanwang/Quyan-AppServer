import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { PermissionController } from "@/api/controllers/v1/users/permission.controller";
import { RamService } from "@/services/users/ram.service";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";
import { Permission } from "@quyan/shared";

const service = RamService.getInstance();
const controller = new PermissionController();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, first: string, second: string, foreign: string;
const arn = (kind: string, id: string) => "acs:quyan:*:" + owner + ":" + kind + "/" + id;
async function grant(action: string, Resource: string | string[], Effect: "Allow" | "Deny" = "Allow") {
  const policy = await service.createPolicy(owner, {
    name: "legacy-control-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action: action, Resource } },
  });
  await service.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
const run = <T>(params: Record<string, string>, body: unknown, operation: (request: TypedRequest) => Promise<T>) =>
  new AsyncResource("iam-legacy-control-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId: actor },
      params,
      body,
      headers: { "x-action": "quyan:permission:Add", "x-account-id": foreign },
      secure: true,
      ip: "127.0.0.1",
      authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });
const group = (permissions: Permission[] = [], accountOwnerId = owner) =>
  prisma.group.create({
    data: {
      username: "legacy-control-group-" + randomUUID(),
      name: "Group fixture",
      accountOwnerId,
      level: 99,
      permissions,
    },
  });
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "legacy-control-user-" + randomUUID(),
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
  actor = await user(owner);
  first = await user(owner);
  second = await user(owner);
  foreign = await user();
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe("legacy permission endpoints authorize concrete IAM targets", () => {
  it("allows configuring one user without requiring an account-wide menu grant", async () => {
    await grant("quyan:permission:Add", arn("user", first));
    await run({ userId: first }, {}, (req) => controller.setUserPermissions(req, first, {}));
    await run({ userId: first }, { permissions: [] }, (req) =>
      controller.addUserPermissions(req, first, { permissions: [] }),
    );
    await expect(
      run({ userId: second }, {}, (req) => controller.setUserPermissions(req, second, {})),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      run({ userId: first }, { permissions: [] }, (req) =>
        controller.removeUserPermissions(req, first, { permissions: [] }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps exact target management separate from proof that a grant can be delegated", async () => {
    await grant("quyan:permission:Add", arn("user", first));
    const body = { permissions: [Permission.RAM_USER_READ] };
    await expect(
      run({ userId: first }, body, (req) => controller.addUserPermissions(req, first, body)),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first } })).permissionAdds).toEqual([]);
    await grant("quyan:ram:ReadUser", ["acs:quyan:*:" + owner + ":account", "acs:quyan:*:" + owner + ":user/*"]);
    await run({ userId: first }, body, (req) => controller.addUserPermissions(req, first, body));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first } })).permissionAdds).toEqual(body.permissions);
  });
  it("requires both Add and Remove on the same user when clearing overrides", async () => {
    await grant("quyan:permission:Add", arn("user", first));
    await expect(
      run({ userId: first }, {}, (req) => controller.clearUserPermissions(req, first)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:permission:Remove", arn("user", second));
    await expect(
      run({ userId: first }, {}, (req) => controller.clearUserPermissions(req, first)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:permission:Remove", arn("user", first));
    await run({ userId: first }, {}, (req) => controller.clearUserPermissions(req, first));
  });
  it("reads only the granted group and rejects cross-account ownership despite wildcard Allow", async () => {
    const a = await group([Permission.RAM_USER_READ]),
      b = await group(),
      external = await group([], foreign);
    await grant("quyan:permission:Manage", arn("group", a.id));
    expect(await run({ groupId: a.id }, {}, (req) => controller.getGroupPermissions(req, a.id))).toEqual({
      permissions: [Permission.RAM_USER_READ],
    });
    await expect(run({ groupId: b.id }, {}, (req) => controller.getGroupPermissions(req, b.id))).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant("quyan:permission:Manage", "*");
    await expect(
      run({ groupId: external.id }, {}, (req) => controller.getGroupPermissions(req, external.id)),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("checks added and removed group permissions independently and respects explicit Deny", async () => {
    const a = await group(),
      b = await group();
    await grant("quyan:permission:Add", arn("group", a.id));
    await grant("quyan:ram:ReadUser", ["acs:quyan:*:" + owner + ":account", "acs:quyan:*:" + owner + ":user/*"]);
    const body = { permissions: [Permission.RAM_USER_READ] };
    await run({ groupId: a.id }, body, (req) => controller.setGroupPermissions(req, a.id, body));
    await expect(
      run({ groupId: b.id }, body, (req) => controller.setGroupPermissions(req, b.id, body)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      run({ groupId: a.id }, { permissions: [] }, (req) =>
        controller.setGroupPermissions(req, a.id, { permissions: [] }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:permission:Remove", arn("group", a.id));
    await grant("quyan:permission:Add", arn("group", a.id), "Deny");
    await run({ groupId: a.id }, { permissions: [] }, (req) =>
      controller.setGroupPermissions(req, a.id, { permissions: [] }),
    );
    await expect(
      run({ groupId: a.id }, body, (req) => controller.setGroupPermissions(req, a.id, body)),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.group.findUniqueOrThrow({ where: { id: a.id } })).permissions).toEqual([]);
  });
  it("fails closed when a target cannot be resolved", async () => {
    await grant("quyan:permission:Add", "*");
    await expect(
      run({ userId: "bad/id" }, {}, (req) => controller.setUserPermissions(req, "bad/id", {})),
    ).rejects.toMatchObject({ statusCode: 403, messageKey: "iam.resourceResolutionFailed" });
  });
  it("retains legacy enforcement in shadow and legacy modes", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.PERMISSION_ADD] } });
    for (const mode of ["legacy", "shadow"] as const) {
      env.security.iamAuthorizationMode = mode;
      await run({ userId: second }, {}, (req) => controller.setUserPermissions(req, second, {}));
    }
  });
  it("does not let Add-only configuration replace a grant with Deny or drop existing grants", async () => {
    await grant("quyan:permission:Add", arn("user", first));
    await prisma.user.update({ where: { id: first }, data: { permissionAdds: [Permission.RAM_USER_READ] } });
    for (const body of [{ permissionAdds: [] }, { permissionRemoves: [Permission.RAM_USER_READ] }])
      await expect(
        run({ userId: first }, body, (req) => controller.setUserPermissions(req, first, body)),
      ).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first } })).permissionAdds).toEqual([
      Permission.RAM_USER_READ,
    ]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first } })).permissionRemoves).toEqual([]);
    await grant("quyan:permission:Remove", arn("user", first), "Deny");
    await expect(
      run({ userId: first }, { permissionAdds: [] }, (req) =>
        controller.setUserPermissions(req, first, { permissionAdds: [] }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("lets a Remove-only actor reduce access but never restore a removed Deny", async () => {
    await grant("quyan:permission:Remove", arn("user", first));
    await prisma.user.update({ where: { id: first }, data: { permissionAdds: [Permission.RAM_USER_READ] } });
    await run({ userId: first }, { permissionAdds: [], permissionRemoves: [Permission.RAM_USER_READ] }, (req) =>
      controller.setUserPermissions(req, first, { permissionAdds: [], permissionRemoves: [Permission.RAM_USER_READ] }),
    );
    await grant("quyan:ram:ReadUser", ["acs:quyan:*:" + owner + ":account", "acs:quyan:*:" + owner + ":user/*"]);
    await expect(
      run({ userId: first }, { permissionRemoves: [] }, (req) =>
        controller.setUserPermissions(req, first, { permissionRemoves: [] }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:permission:Add", arn("user", first));
    await run({ userId: first }, { permissionRemoves: [] }, (req) =>
      controller.setUserPermissions(req, first, { permissionRemoves: [] }),
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first } })).permissionRemoves).toEqual([]);
  });
  it("keeps the historical Add gate for replacement in legacy and shadow", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.PERMISSION_REMOVE] } });
    for (const mode of ["legacy", "shadow"] as const) {
      env.security.iamAuthorizationMode = mode;
      await expect(
        run({ userId: first }, {}, (req) => controller.setUserPermissions(req, first, {})),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
  });
});
