import { RamController } from "@/api/controllers/v1/users/ram.controller";
import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { PermissionService } from "@/services/users/permission.service";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";
import { Permission, type IamPolicyDocument } from "@quyan/shared";
const ram = RamService.getInstance(),
  permissions = PermissionService.getInstance();
const mode = env.security.iamAuthorizationMode;
let owner: string, child: string, other: string;
const grant = async (target: string, document: IamPolicyDocument, principalType: "user" | "role" = "user") => {
  const policy = await ram.createPolicy(owner, { name: "projection-" + randomUUID(), document });
  await ram.createAuthorization(owner, {
    principalType,
    principalId: target,
    policyId: policy.id,
    scopeType: "account",
  });
};
const statement = (Action: string, Resource = "*", Effect: "Allow" | "Deny" = "Allow"): IamPolicyDocument => ({
  Version: "1",
  Statement: { Effect, Action, Resource },
});
const run = <T>(context: Record<string, unknown>, operation: () => Promise<T>) =>
  new AsyncResource("projection-fixture").runInAsyncScope(async () => {
    setRequestContext({
      user: { userId: child },
      authContext: { principalUserId: child, accountOwnerId: owner, subjectType: "sub_user", ...context },
      headers: {},
    } as unknown as TypedRequest);
    return operation();
  });
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "projection-" + randomUUID(),
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
  other = await user(owner);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("effective-permission IAM projection", () => {
  it("authorizes the exact inspected user and refuses a different target", async () => {
    await grant(child, statement("quyan:ram:ReadUser", "acs:quyan:*:" + owner + ":user/" + other));
    const inspect = (userId: string) =>
      new AsyncResource("projection-target-fixture").runInAsyncScope(async () => {
        const request = {
          user: { userId: child },
          authContext: { principalUserId: child, accountOwnerId: owner, subjectType: "sub_user" },
          query: { userId },
          headers: {},
          secure: true,
        } as unknown as TypedRequest;
        setRequestContext(request);
        return new RamController().getUserEffectivePermissions(request, userId);
      });
    expect((await inspect(other)).userId).toBe(other);
    await expect(inspect(owner)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shows JSON-only account grants and honors explicit Deny in both effective-permission APIs", async () => {
    await grant(child, statement("quyan:ram:ReadUser"));
    expect((await ram.getUserEffectivePermissions(owner, child)).effectivePermissions).toContain(
      Permission.RAM_USER_READ,
    );
    expect((await permissions.getUserFullPermissions(child))!.effectivePermissions).toContain(Permission.RAM_USER_READ);
    await grant(child, statement("quyan:ram:ReadUser", "*", "Deny"));
    const result = await ram.getUserEffectivePermissions(owner, child);
    expect(result.authorizationMode).toBe("enforce");
    expect(result.effectivePermissions).not.toContain(Permission.RAM_USER_READ);
  });
  it("never projects a specific-resource Allow into global Permission", async () => {
    await grant(child, statement("quyan:ram:ReadUser", "acs:quyan:*:" + owner + ":user/" + child));
    expect((await ram.getUserEffectivePermissions(owner, child)).effectivePermissions).not.toContain(
      Permission.RAM_USER_READ,
    );
  });
  it("uses authenticated AccessKey identity attributes for the current user but not an inspected target", async () => {
    await grant(child, {
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:ram:ReadUser",
        Resource: "*",
        Condition: { StringEquals: { "quyan:PrincipalType": "access_key" } },
      },
    });
    expect((await run({}, () => permissions.getUserFullPermissions(child)))!.effectivePermissions).not.toContain(
      Permission.RAM_USER_READ,
    );
    expect(
      (await run({ subjectType: "access_key" }, () => permissions.getUserFullPermissions(child)))!.effectivePermissions,
    ).toContain(Permission.RAM_USER_READ);
    await grant(other, {
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:ram:ReadUser",
        Resource: "*",
        Condition: { StringEquals: { "quyan:PrincipalId": other } },
      },
    });
    expect(
      (await run({ subjectType: "access_key" }, () => permissions.getUserFullPermissions(other)))!.effectivePermissions,
    ).toContain(Permission.RAM_USER_READ);
  });
  it("automatically isolates the active role session and refuses a revoked session", async () => {
    await grant(child, statement("quyan:ram:DeleteUser"));
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "projection-role-" + randomUUID() },
    });
    await grant(role.id, statement("quyan:ram:ReadUser"), "role");
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: child,
        sessionName: "projection-fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const context = { subjectType: "assumed_role", roleSessionId: session.id, assumedRoleId: role.id };
    const result = await run(context, () => permissions.getUserFullPermissions(child));
    expect(result!.effectivePermissions).toContain(Permission.RAM_USER_READ);
    expect(result!.effectivePermissions).not.toContain(Permission.RAM_USER_DELETE);
    const overview = await run(context, () => ram.getUserEffectivePermissions(child, child));
    expect(overview.effectivePermissions).toEqual(result!.effectivePermissions);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(run(context, () => permissions.getUserFullPermissions(child))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("keeps legacy mode projection compatible with permission arrays", async () => {
    await prisma.user.update({ where: { id: child }, data: { permissionAdds: [Permission.RAM_USER_READ] } });
    env.security.iamAuthorizationMode = "legacy";
    expect((await ram.getUserEffectivePermissions(owner, child)).effectivePermissions).toContain(
      Permission.RAM_USER_READ,
    );
    expect((await ram.getUserEffectivePermissions(owner, child)).authorizationMode).toBe("legacy");
  });
});
