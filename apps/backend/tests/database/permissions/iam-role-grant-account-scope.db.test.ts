import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { RamRoleRepository } from "@/store/users/ram-role.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { PermissionService } from "@/services/users/permission.service";
const repository = RamRoleRepository.getInstance(),
  iam = IamAuthorizationService.getInstance();
let owner: string, foreign: string, actor: string, target: string, groupId: string, roleId: string;
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "role-scope-" + randomUUID(),
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
const group = async (accountOwnerId?: string) =>
  (
    await prisma.group.create({
      data: { username: "role-scope-group-" + randomUUID(), accountOwnerId, permissions: [] },
    })
  ).id;
const role = async (accountOwnerId = owner) =>
  (await prisma.ramRole.create({ data: { accountOwnerId, name: "role-scope-role-" + randomUUID() } })).id;
const bind = (accountOwnerId = owner, id = roleId, userId = actor) =>
  prisma.ramUserRoleBinding.create({ data: { accountOwnerId, roleId: id, userId } });
const bindGroup = (accountOwnerId = owner, id = roleId, gid = groupId) =>
  prisma.ramGroupRoleBinding.create({ data: { accountOwnerId, roleId: id, groupId: gid } });
async function attach(
  policyOwner = owner,
  attachmentOwner = owner,
  id = roleId,
  permissions = [Permission.RAM_USER_READ],
) {
  const policy = await prisma.ramPolicy.create({
    data: { accountOwnerId: policyOwner, name: "role-scope-policy-" + randomUUID(), permissions },
  });
  return prisma.ramPolicyAttachment.create({
    data: { accountOwnerId: attachmentOwner, policyId: policy.id, targetType: "role", targetId: id },
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
  owner = await user();
  foreign = await user();
  groupId = await group();
  actor = await user(owner, groupId);
  target = await user(owner);
  roleId = await role();
});
describe("persisted account isolation for role grants and legacy projections", () => {
  it("reads valid user and shared-group roles without borrowing the other account's roles", async () => {
    const direct = await bind(),
      groupRole = await role();
    const grouped = await bindGroup(owner, groupRole);
    const otherRole = await role(foreign);
    await bindGroup(foreign, otherRole);
    await attach();
    await attach(owner, owner, groupRole, [Permission.RAM_USER_UPDATE]);
    await attach(foreign, foreign, otherRole, [Permission.RAM_USER_DELETE]);
    const bindings = await repository.listRoleBindingsForUser(actor, groupId);
    expect(bindings.map((entry) => entry.id).sort()).toEqual([direct.id, grouped.id].sort());
    expect(bindings.flatMap((entry) => entry.permissions).sort()).toEqual(
      [Permission.RAM_USER_READ, Permission.RAM_USER_UPDATE].sort(),
    );
    expect((await authorize()).decision).toBe("Allow");
    const ui = await PermissionService.getInstance().getUserFullPermissions(actor);
    expect(ui?.effectivePermissions).toContain(Permission.RAM_USER_READ);
    expect(ui?.effectivePermissions).not.toContain(Permission.RAM_USER_DELETE);
  });
  it.each(["binding", "role"])(
    "excludes a foreign %s even when the other relation belongs to the local account",
    async (wrong) => {
      const id = wrong === "role" ? await role(foreign) : roleId;
      await bind(wrong === "binding" ? foreign : owner, id);
      await attach(owner, owner, id);
      expect(await repository.listRoleBindingsForUser(actor, groupId)).toEqual([]);
      expect((await authorize()).decision).toBe("ImplicitDeny");
      expect((await PermissionService.getInstance().getUserFullPermissions(actor))?.effectivePermissions).not.toContain(
        Permission.RAM_USER_READ,
      );
    },
  );
  it.each(["binding", "role"])("excludes a foreign group %s", async (wrong) => {
    const id = wrong === "role" ? await role(foreign) : roleId;
    await bindGroup(wrong === "binding" ? foreign : owner, id);
    await attach(owner, owner, id);
    expect(await repository.listRoleBindingsForUser(actor, groupId)).toEqual([]);
    expect((await authorize()).decision).toBe("ImplicitDeny");
  });
  it.each(["attachment", "policy"])("never projects a foreign %s as legacy role permissions", async (wrong) => {
    await bind();
    await attach(wrong === "policy" ? foreign : owner, wrong === "attachment" ? foreign : owner);
    const bindings = await repository.listRoleBindingsForUser(actor, groupId);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.permissions).toEqual([]);
    expect((await PermissionService.getInstance().getUserFullPermissions(actor))?.effectivePermissions).not.toContain(
      Permission.RAM_USER_READ,
    );
    expect((await authorize()).decision).toBe("ImplicitDeny");
  });
  it("preserves valid private-group delegation projections with account filtering", async () => {
    const privateGroup = await group(owner);
    const valid = await bindGroup(owner, roleId, privateGroup);
    const otherRole = await role(foreign);
    await bindGroup(foreign, otherRole, privateGroup);
    const attachment = await attach();
    expect((await repository.listRoleBindingsForUser("", privateGroup)).map((entry) => entry.id)).toEqual([valid.id]);
    expect(await iam.loadGroupPolicies(owner, privateGroup)).toEqual(
      expect.arrayContaining([expect.objectContaining({ policyId: attachment.policyId })]),
    );
    expect(await repository.listRoleBindingsForUser("", groupId)).toEqual([]);
  });
  it("cannot supply another active group ID to inherit its role", async () => {
    const otherGroup = await group(owner);
    await bindGroup(owner, roleId, otherGroup);
    await attach();
    expect(await repository.listRoleBindingsForUser(actor, otherGroup)).toEqual([]);
    expect((await authorize()).decision).toBe("ImplicitDeny");
  });
  it("does not inherit a foreign private group's roles through a corrupt user membership", async () => {
    const otherGroup = await group(foreign);
    await prisma.user.update({ where: { id: actor }, data: { groupId: otherGroup } });
    await bindGroup(owner, roleId, otherGroup);
    await attach();
    expect(await repository.listRoleBindingsForUser(actor, otherGroup)).toEqual([]);
  });
  it.each([0, -1])("returns no roles for an inactive subject (%s)", async (status) => {
    await bind();
    await bindGroup();
    await attach();
    await prisma.user.update({ where: { id: actor }, data: { status } });
    expect(await repository.listRoleBindingsForUser(actor, groupId)).toEqual([]);
  });
  it.each(["group", "role", "user-binding", "group-binding", "attachment", "policy"])(
    "excludes inactive %s grants",
    async (kind) => {
      const direct = await bind(),
        grouped = await bindGroup(),
        attachment = await attach();
      if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      if (kind === "role") await prisma.ramRole.update({ where: { id: roleId }, data: { status: 0 } });
      if (kind === "user-binding")
        await prisma.ramUserRoleBinding.update({ where: { id: direct.id }, data: { status: 0 } });
      if (kind === "group-binding")
        await prisma.ramGroupRoleBinding.update({ where: { id: grouped.id }, data: { status: 0 } });
      if (kind === "attachment")
        await prisma.ramPolicyAttachment.update({ where: { id: attachment.id }, data: { status: 0 } });
      if (kind === "policy") await prisma.ramPolicy.update({ where: { id: attachment.policyId }, data: { status: 0 } });
      const bindings = await repository.listRoleBindingsForUser(actor, groupId);
      if (kind === "role") expect(bindings).toEqual([]);
      if (["group", "group-binding"].includes(kind)) expect(bindings.map((entry) => entry.source)).toEqual(["user"]);
      if (kind === "user-binding") expect(bindings.map((entry) => entry.source)).toEqual(["group"]);
      if (["attachment", "policy"].includes(kind)) expect(bindings.flatMap((entry) => entry.permissions)).toEqual([]);
    },
  );
});
