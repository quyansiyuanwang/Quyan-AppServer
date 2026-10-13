import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PermissionService } from "@/services/users/permission.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
const repository = RamPolicyRepository.getInstance(),
  permissions = PermissionService.getInstance(),
  iam = IamAuthorizationService.getInstance(),
  originalMode = env.security.iamAuthorizationMode;
let owner: string, foreign: string, actor: string, target: string, groupId: string, roleId: string;
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "policy-scope-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram_user" : "root",
        groupId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
async function attach(
  type: string,
  id: string,
  policyOwner = owner,
  attachmentOwner = owner,
  permission = Permission.RAM_USER_READ,
) {
  const policy = await prisma.ramPolicy.create({
    data: { accountOwnerId: policyOwner, name: "policy-scope-" + randomUUID(), permissions: [permission] },
  });
  return prisma.ramPolicyAttachment.create({
    data: { accountOwnerId: attachmentOwner, policyId: policy.id, targetType: type, targetId: id },
  });
}
const principal = (): IamPrincipal => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId: owner,
  subjectType: "sub_user",
});
const authorize = () =>
  iam.authorize({
    principal: principal(),
    action: "quyan:ram:ReadUser",
    resource: "acs:quyan:*:" + owner + ":user/" + target,
  });
beforeEach(async () => {
  env.security.iamAuthorizationMode = "legacy";
  owner = await user();
  foreign = await user();
  groupId = (await prisma.group.create({ data: { username: "policy-scope-group-" + randomUUID(), permissions: [] } }))
    .id;
  actor = await user(owner, groupId);
  target = await user(owner);
  roleId = (await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "policy-scope-role-" + randomUUID() } }))
    .id;
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe("account-scoped policy loading, UI projections and sessions", () => {
  it.each(["user", "group", "role"])("reads only local attachments and local policies for %s targets", async (type) => {
    const id = type === "user" ? actor : type === "group" ? groupId : roleId;
    const local = await attach(type, id);
    await attach(type, id, owner, foreign);
    await attach(type, id, foreign, owner);
    await attach(type, id, foreign, foreign);
    expect((await repository.listPoliciesForTarget(type, id, owner)).map((entry) => entry.policyId)).toEqual([
      local.policyId,
    ]);
    expect((await repository.listPoliciesForTargets(type, [id], owner)).map((entry) => entry.policyId)).toEqual([
      local.policyId,
    ]);
  });
  it.each(["legacy", "shadow", "enforce"] as const)(
    "ignores other-account policies on a shared group in %s mode without denying local grants",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const own = await attach("group", groupId);
      await attach("group", groupId, foreign, foreign, Permission.RAM_USER_DELETE);
      expect((await permissions.getUserFullPermissions(actor))?.effectivePermissions).toContain(
        Permission.RAM_USER_READ,
      );
      expect((await permissions.getUserFullPermissions(actor))?.effectivePermissions).not.toContain(
        Permission.RAM_USER_DELETE,
      );
      expect((await iam.loadPolicies(principal())).some((entry) => entry.policyId === own.policyId)).toBe(true);
      expect((await authorize()).decision).toBe("Allow");
    },
  );
  it.each(["user", "group"])("foreign attachments to %s cannot supply a legacy grant or native Allow", async (type) => {
    const id = type === "user" ? actor : groupId;
    await attach(type, id, foreign, owner);
    await attach(type, id, owner, foreign);
    expect((await permissions.getUserFullPermissions(actor))?.effectivePermissions).not.toContain(
      Permission.RAM_USER_READ,
    );
    expect((await authorize()).decision).toBe("ImplicitDeny");
  });
  it.each(["user", "group", "role"])(
    "rejects foreign and disabled %s targets even for locally owned attachment rows",
    async (type) => {
      let id: string;
      if (type === "user") id = await user(foreign);
      else if (type === "group")
        id = (
          await prisma.group.create({
            data: { username: "foreign-policy-group-" + randomUUID(), accountOwnerId: foreign, permissions: [] },
          })
        ).id;
      else
        id = (
          await prisma.ramRole.create({
            data: { accountOwnerId: foreign, name: "foreign-policy-role-" + randomUUID() },
          })
        ).id;
      await attach(type, id);
      expect(await repository.listPoliciesForTarget(type, id, owner)).toEqual([]);
      const localId = type === "user" ? actor : type === "group" ? groupId : roleId;
      await attach(type, localId);
      if (type === "user") await prisma.user.update({ where: { id: localId }, data: { status: 0 } });
      else if (type === "group") await prisma.group.update({ where: { id: localId }, data: { status: 0 } });
      else await prisma.ramRole.update({ where: { id: localId }, data: { status: 0 } });
      expect(await repository.listPoliciesForTarget(type, localId, owner)).toEqual([]);
    },
  );
  it("does not use a corrupted foreign group membership to project policies", async () => {
    const foreignGroup = (
      await prisma.group.create({
        data: { username: "foreign-member-" + randomUUID(), accountOwnerId: foreign, permissions: [] },
      })
    ).id;
    await prisma.user.update({ where: { id: actor }, data: { groupId: foreignGroup } });
    await attach("group", foreignGroup);
    expect((await permissions.getUserFullPermissions(actor))?.policyPermissions).toEqual([]);
  });
  it("retains an explicit local Deny while excluding foreign attachments", async () => {
    await attach("user", actor);
    await attach("group", groupId, foreign, foreign);
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.RAM_USER_READ] } });
    expect((await authorize()).decision).toBe("ExplicitDeny");
  });
  it.each(["missing", "subject", "session-account", "role-account", "revoked", "expired", "role-disabled"])(
    "refuses %s role sessions instead of falling back to identity grants",
    async (invalid) => {
      await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RAM_USER_READ] } });
      const foreignRole = (
        await prisma.ramRole.create({ data: { accountOwnerId: foreign, name: "foreign-session-role-" + randomUUID() } })
      ).id;
      const session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: invalid === "session-account" ? foreign : owner,
          subjectUserId: invalid === "subject" ? target : actor,
          roleId: invalid === "role-account" ? foreignRole : roleId,
          sessionName: "fixture",
          expiresAt: new Date(Date.now() + 60000),
          tokenJtiHash: randomUUID(),
        },
      });
      if (invalid === "revoked")
        await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      if (invalid === "expired")
        await prisma.ramRoleSession.update({ where: { id: session.id }, data: { expiresAt: new Date(0) } });
      if (invalid === "role-disabled") await prisma.ramRole.update({ where: { id: roleId }, data: { status: 0 } });
      await expect(
        permissions.getUserFullPermissions(actor, {
          assumedRoleSessionId: invalid === "missing" ? "absent-session" : session.id,
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it.each(["legacy", "shadow", "enforce"] as const)(
    "preserves valid same-account session permissions in %s without borrowing another account's policy",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      await attach("role", roleId);
      await attach("role", roleId, foreign, foreign, Permission.RAM_USER_DELETE);
      const session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          subjectUserId: actor,
          roleId,
          sessionName: "fixture",
          expiresAt: new Date(Date.now() + 60000),
          tokenJtiHash: randomUUID(),
        },
      });
      const projected = await permissions.getUserFullPermissions(actor, { assumedRoleSessionId: session.id });
      expect(projected?.effectivePermissions).toContain(Permission.RAM_USER_READ);
      expect(projected?.effectivePermissions).not.toContain(Permission.RAM_USER_DELETE);
    },
  );
});
