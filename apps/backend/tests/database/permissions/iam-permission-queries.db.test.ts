import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { ALL_PERMISSIONS, Permission } from "@quyan/shared";
import { PermissionController } from "@/api/controllers/v1/users/permission.controller";
import { RamService } from "@/services/users/ram.service";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";
import type { ResourceResolver } from "@/iam/request/resource-resolvers";
import {
  iamAuthenticatedUserResourceResolver,
  iamPermissionCheckUserResourceResolver,
  ramUserResourceResolver,
} from "@/iam/request/resource-resolvers";
import { iamAuthenticatedAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";

const controller = new PermissionController();
const ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, first: string, second: string, foreign: string;
const arn = (id: string) => "acs:quyan:*:" + owner + ":user/" + id;

beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "permission-query-" + randomUUID(),
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

async function grant(
  Resource: string,
  Effect: "Allow" | "Deny" = "Allow",
  principalType: "user" | "role" = "user",
  principalId = actor,
) {
  const policy = await ram.createPolicy(owner, {
    name: "permission-query-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action: "quyan:permission:Manage", Resource } },
  });
  await ram.createAuthorization(owner, { principalType, principalId, policyId: policy.id, scopeType: "account" });
}

const run = <T>(operation: (request: TypedRequest) => Promise<T>, auth = {}) =>
  new AsyncResource("permission-query-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId: actor },
      params: {},
      body: {},
      ip: "127.0.0.1",
      secure: true,
      headers: { "x-action": "quyan:permission:Manage", "x-account-id": owner },
      authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user", ...auth },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });
async function protect(request: TypedRequest, resource: ResourceResolver) {
  let error: unknown;
  await iamAuthenticatedAuthorizationMiddleware({
    action: "quyan:permission:Manage",
    resourceKind: "single-resource",
    resource,
  })(request, {} as never, (value?: unknown) => {
    error = value;
  });
  if (error) throw error;
}
const readAll = (auth = {}) =>
  run(async (request) => {
    await protect(request, iamAuthenticatedUserResourceResolver);
    return controller.getAllPermissions(request);
  }, auth);
const readUser = (userId: string, auth = {}) =>
  run(async (request) => {
    request.params = { userId };
    await protect(request, ramUserResourceResolver);
    return controller.getUserPermissions(userId, request);
  }, auth);
const check = (userId: string, auth = {}) =>
  run(async (request) => {
    const body = { userId, permissions: [Permission.RAM_USER_READ] };
    Object.assign(request, { body });
    await protect(request, iamPermissionCheckUserResourceResolver);
    return controller.checkPermissions(request, body);
  }, auth);

describe("resource-scoped permission queries", () => {
  it("lets ordinary identities read their own projection without granting account-wide View", async () => {
    expect((await readAll()).permissions).toEqual([]);
    expect((await readUser(actor)).userId).toBe(actor);
    expect((await check(actor)).hasPermission).toBe(false);
    await expect(readUser(first)).rejects.toMatchObject({ statusCode: 403 });
    await expect(check(first)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("allows one concrete user without revealing other users or the full permission catalog", async () => {
    await grant(arn(first));
    expect((await readUser(first)).userId).toBe(first);
    expect((await check(first)).hasPermission).toBe(false);
    expect((await readAll()).permissions).toEqual([]);
    await expect(readUser(second)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses account View only to expose the full catalog, without treating it as every user", async () => {
    await grant("acs:quyan:*:" + owner + ":account");
    expect((await readAll()).permissions.map((permission) => permission.value)).toEqual(ALL_PERMISSIONS);
    await expect(readUser(first)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a foreign user even when an owner-scoped ARN contains that user's ID", async () => {
    await grant(arn(foreign));
    await expect(readUser(foreign)).rejects.toMatchObject({ statusCode: 404 });
    await expect(check(foreign)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects disabled targets even with a matching View", async () => {
    await grant(arn(first));
    await prisma.user.update({ where: { id: first }, data: { status: 0 } });
    await expect(readUser(first)).rejects.toMatchObject({ statusCode: 404 });
  });
  it("allows an explicit Deny to block self inspection and returns no policy JSON", async () => {
    await grant(arn(actor), "Deny");
    for (const operation of [readAll, () => readUser(actor), () => check(actor)]) {
      const error = await operation().then(
        () => undefined,
        (value: unknown) => value,
      );
      expect(error).toMatchObject({ statusCode: 403 });
      expect(JSON.stringify(error)).not.toContain('"Statement"');
    }
  });
  it("does not trust a spoofed principal or action header", async () => {
    await expect(
      run(async (request) => {
        request.headers["x-user-id"] = first;
        request.headers["x-account-id"] = foreign;
        request.params = { userId: first };
        await protect(request, ramUserResourceResolver);
        return controller.getUserPermissions(first, request);
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses the same self baseline for AccessKey identities", async () => {
    expect((await readUser(actor, { subjectType: "access_key" })).userId).toBe(actor);
    await expect(readUser(first, { subjectType: "access_key" })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps role-session self inspection, excludes caller grants, and honors role Deny", async () => {
    await grant(arn(first));
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "query-role-" + randomUUID() } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Permission query fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    expect((await readUser(actor, auth)).userId).toBe(actor);
    await expect(readUser(first, auth)).rejects.toMatchObject({ statusCode: 403 });
    await grant(arn(actor), "Deny", "role", role.id);
    await expect(readUser(actor, auth)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed after the role session is revoked", async () => {
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "query-revoked-" + randomUUID() },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Revoked query fixture",
        expiresAt: new Date(Date.now() + 60000),
        revokedAt: new Date(),
      },
    });
    await expect(readUser(actor, { roleSessionId: session.id, assumedRoleId: role.id })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each(["legacy", "shadow"] as const)("preserves original authenticated self access in %s mode", async (mode) => {
    await grant(arn(actor), "Deny");
    env.security.iamAuthorizationMode = mode;
    expect((await readUser(actor)).userId).toBe(actor);
    expect((await check(actor)).hasPermission).toBe(false);
    await expect(readUser(first)).rejects.toMatchObject({ statusCode: 404 });
  });
});
