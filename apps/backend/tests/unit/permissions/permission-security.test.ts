import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { permissionService } from "../../../src/services/users/permission.service";
import { RamService } from "../../../src/services/users/ram.service";
import { prisma } from "../../../src/config/database";
import { Permission } from "../../../src/constant/permission";
import { BadRequestError, ForbiddenError } from "../../../src/util/errors";
import { AccountStatus } from "../../../src/util/auth/account-status";

const ramService = RamService.getInstance();
const testPolicyNames = [
  "test_allowed_policy",
  "test_forbidden_dirty_policy",
  "test_forbidden_policy",
  "test_dedup_policy",
  "test_mixed_policy",
  "test_update_policy",
  "test_dirty_user_policy",
  "test_dirty_role_policy",
  "test_dirty_group_policy",
  "test_recreate_policy",
  "test_cross_account_policy",
];

const crossAccountUsernames = ["test_other_owner", "test_other_ram_user"];
const crossAccountGroupUsernames = ["test_other_group"];
const crossAccountRoleNames = ["test_other_role"];

describe("权限修改安全检查", () => {
  let adminUser: any;
  let normalUser: any;
  let targetUser: any;
  let adminGroup: any;
  let normalGroup: any;

  beforeAll(async () => {
    // 创建测试用的组（level越高权限越低）
    adminGroup = await prisma.group.create({
      data: {
        username: "test_admin_group",
        name: "管理员组",
        level: 1, // 低level = 高权限
        permissions: JSON.stringify([
          Permission.PERMISSION_ADD,
          Permission.PERMISSION_REMOVE,
          Permission.USER_READ,
          Permission.RAM_POLICY_CREATE,
          Permission.RAM_POLICY_UPDATE,
          Permission.RAM_POLICY_ATTACH,
        ]),
      },
    });

    normalGroup = await prisma.group.create({
      data: {
        username: "test_normal_group",
        name: "普通用户组",
        level: 10, // 高level = 低权限
        permissions: JSON.stringify([]),
      },
    });

    // 创建测试用户
    adminUser = await prisma.user.create({
      data: {
        username: "test_admin",
        password: "test_password",
        groupId: adminGroup.id,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });

    normalUser = await prisma.user.create({
      data: {
        username: "test_normal",
        password: "test_password",
        groupId: normalGroup.id,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });

    targetUser = await prisma.user.create({
      data: {
        username: "test_target",
        password: "test_password",
        groupId: normalGroup.id,
        accountOwnerId: adminUser.id,
        parentUserId: adminUser.id,
        userType: "ram_user",
        ramUsername: "test_target",
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
  });

  beforeEach(async () => {
    const crossAccountUsers = await prisma.user.findMany({
      where: { username: { in: crossAccountUsernames } },
      select: { id: true },
    });
    const crossAccountGroups = await prisma.group.findMany({
      where: { username: { in: crossAccountGroupUsernames } },
      select: { id: true },
    });
    const crossAccountRoles = await prisma.ramRole.findMany({
      where: { name: { in: crossAccountRoleNames } },
      select: { id: true },
    });

    await prisma.ramPolicyAttachment.deleteMany({
      where: {
        OR: [
          { policy: { name: { in: testPolicyNames } } },
          {
            targetId: {
              in: [
                ...crossAccountUsers.map((user) => user.id),
                ...crossAccountGroups.map((group) => group.id),
                ...crossAccountRoles.map((role) => role.id),
              ],
            },
          },
        ],
      },
    });

    await prisma.ramRole.deleteMany({ where: { name: { in: crossAccountRoleNames } } });
    await prisma.user.deleteMany({ where: { username: { in: crossAccountUsernames } } });
    await prisma.group.deleteMany({ where: { username: { in: crossAccountGroupUsernames } } });

    await prisma.ramPolicy.deleteMany({
      where: {
        name: {
          in: testPolicyNames,
        },
      },
    });

    await prisma.user.updateMany({
      where: {
        username: {
          in: ["test_admin", "test_normal", "test_target"],
        },
      },
      data: {
        permissionAdds: [],
        permissionRemoves: [],
      },
    });

    await prisma.group.update({
      where: { id: normalGroup.id },
      data: { permissions: [] },
    });
  });

  afterAll(async () => {
    // 清理测试数据
    await prisma.ramPolicyAttachment.deleteMany({
      where: {
        policy: { name: { in: testPolicyNames } },
      },
    });

    const crossAccountUsers = await prisma.user.findMany({
      where: { username: { in: crossAccountUsernames } },
      select: { id: true },
    });
    const crossAccountGroups = await prisma.group.findMany({
      where: { username: { in: crossAccountGroupUsernames } },
      select: { id: true },
    });
    const crossAccountRoles = await prisma.ramRole.findMany({
      where: { name: { in: crossAccountRoleNames } },
      select: { id: true },
    });

    await prisma.ramPolicyAttachment.deleteMany({
      where: {
        targetId: {
          in: [
            ...crossAccountUsers.map((user) => user.id),
            ...crossAccountGroups.map((group) => group.id),
            ...crossAccountRoles.map((role) => role.id),
          ],
        },
      },
    });

    await prisma.ramPolicy.deleteMany({
      where: {
        name: {
            in: testPolicyNames,
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        username: {
          in: ["test_admin", "test_normal", "test_target", ...crossAccountUsernames],
        },
      },
    });

    await prisma.group.deleteMany({
      where: {
        username: {
          in: ["test_admin_group", "test_normal_group", ...crossAccountGroupUsernames],
        },
      },
    });

    await prisma.ramRole.deleteMany({ where: { name: { in: crossAccountRoleNames } } });
  });

  describe("用户不能修改自己的权限", () => {
    it("应该阻止用户添加自己的权限", async () => {
      await expect(
        permissionService.addUserPermissions(normalUser.id, normalUser.id, [Permission.USER_READ]),
      ).rejects.toThrow(ForbiddenError);
    });

    it("应该阻止用户移除自己的权限", async () => {
      await expect(
        permissionService.removeUserPermissions(normalUser.id, normalUser.id, [Permission.USER_READ]),
      ).rejects.toThrow(ForbiddenError);
    });

    it("应该阻止用户设置自己的权限配置", async () => {
      await expect(
        permissionService.setUserPermissionConfig(normalUser.id, normalUser.id, {
          permissionAdds: [Permission.USER_READ],
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it("应该阻止用户清空自己的权限配置", async () => {
      await expect(permissionService.clearUserPermissionConfig(normalUser.id, normalUser.id)).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  describe("用户不能修改等级大于或等于自己的用户的权限", () => {
    it("低等级用户不能添加高等级用户的权限", async () => {
      await expect(
        permissionService.addUserPermissions(normalUser.id, adminUser.id, [Permission.USER_READ]),
      ).rejects.toThrow(ForbiddenError);
    });

    it("低等级用户不能移除高等级用户的权限", async () => {
      await expect(
        permissionService.removeUserPermissions(normalUser.id, adminUser.id, [Permission.USER_READ]),
      ).rejects.toThrow(ForbiddenError);
    });

    it("相同等级用户不能修改其他用户的权限", async () => {
      await expect(
        permissionService.addUserPermissions(normalUser.id, targetUser.id, [Permission.USER_READ]),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("高等级用户可以修改低等级用户的权限", () => {
    it("高等级用户可以添加低等级用户的权限", async () => {
      await expect(
        permissionService.addUserPermissions(adminUser.id, targetUser.id, [Permission.USER_READ]),
      ).resolves.not.toThrow();

      // 验证权限已添加
      const userPerms = await permissionService.getUserFullPermissions(targetUser.id);
      expect(userPerms?.additionalPermissions).toContain(Permission.USER_READ);
    });

    it("高等级用户可以移除低等级用户的权限", async () => {
      await expect(
        permissionService.removeUserPermissions(adminUser.id, targetUser.id, [Permission.USER_READ]),
      ).resolves.not.toThrow();

      // 验证权限已移除
      const userPerms = await permissionService.getUserFullPermissions(targetUser.id);
      expect(userPerms?.removedPermissions).toContain(Permission.USER_READ);
    });

    it("高等级用户可以清空低等级用户的权限配置", async () => {
      await expect(permissionService.clearUserPermissionConfig(adminUser.id, targetUser.id)).resolves.not.toThrow();

      // 验证权限已清空
      const userPerms = await permissionService.getUserFullPermissions(targetUser.id);
      expect(userPerms?.additionalPermissions).toHaveLength(0);
      expect(userPerms?.removedPermissions).toHaveLength(0);
    });
  });

  describe("操作者不能授予自己未拥有的权限", () => {
    it("应该允许直接校验空权限和自有权限", async () => {
      await expect(permissionService.assertCanGrantPermissions(adminUser.id, [])).resolves.not.toThrow();
      await expect(
        permissionService.assertCanGrantPermissions(adminUser.id, [Permission.USER_READ, Permission.USER_READ]),
      ).resolves.not.toThrow();
    });

    it("应该在直接校验中拒绝无效权限和混合越权权限", async () => {
      await expect(
        permissionService.assertCanGrantPermissions(adminUser.id, ["invalid:permission" as Permission]),
      ).rejects.toThrow(BadRequestError);

      await expect(
        permissionService.assertCanGrantPermissions(adminUser.id, [Permission.USER_READ, Permission.USER_DELETE]),
      ).rejects.toThrow(ForbiddenError);
    });

    it("应该阻止用户权限添加越权权限", async () => {
      await expect(
        permissionService.addUserPermissions(adminUser.id, targetUser.id, [Permission.USER_DELETE]),
      ).rejects.toThrow(ForbiddenError);

      const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUser.id } });
      expect(target.permissionAdds).toEqual([]);
    });

    it("应该阻止用户权限添加混合权限且不部分写入", async () => {
      await expect(
        permissionService.addUserPermissions(adminUser.id, targetUser.id, [Permission.USER_READ, Permission.USER_DELETE]),
      ).rejects.toThrow(ForbiddenError);

      const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUser.id } });
      expect(target.permissionAdds).toEqual([]);
    });

    it("应该阻止用户权限配置越权权限且允许显式清空", async () => {
      await expect(
        permissionService.setUserPermissionConfig(adminUser.id, targetUser.id, {
          permissionAdds: [Permission.USER_DELETE],
        }),
      ).rejects.toThrow(ForbiddenError);

      await expect(
        permissionService.setUserPermissionConfig(adminUser.id, targetUser.id, {
          permissionAdds: [],
          permissionRemoves: [],
        }),
      ).resolves.not.toThrow();

      const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUser.id } });
      expect(target.permissionAdds).toEqual([]);
      expect(target.permissionRemoves).toEqual([]);
    });

    it("应该允许移除操作者未拥有的权限，因为这是降权操作", async () => {
      await expect(
        permissionService.setUserPermissionConfig(adminUser.id, targetUser.id, {
          permissionRemoves: [Permission.USER_DELETE],
        }),
      ).resolves.not.toThrow();

      const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUser.id } });
      expect(target.permissionRemoves).toEqual([Permission.USER_DELETE]);
    });

    it("应该阻止设置用户组最终权限包含操作者未拥有权限", async () => {
      await expect(
        permissionService.setGroupPermissions(normalGroup.id, [Permission.USER_READ, Permission.USER_DELETE], adminUser.id),
      ).rejects.toThrow(ForbiddenError);

      const group = await prisma.group.findUniqueOrThrow({ where: { id: normalGroup.id } });
      expect(group.permissions).toEqual([]);
    });

    it("应该允许设置用户组最终权限为操作者自有权限子集", async () => {
      await expect(
        permissionService.setGroupPermissions(normalGroup.id, [Permission.USER_READ, Permission.PERMISSION_ADD], adminUser.id),
      ).resolves.not.toThrow();

      const group = await prisma.group.findUniqueOrThrow({ where: { id: normalGroup.id } });
      expect(group.permissions).toEqual([Permission.USER_READ, Permission.PERMISSION_ADD]);
    });

    it("应该允许内部路径在未传操作者时只校验权限枚举合法性", async () => {
      await expect(permissionService.setGroupPermissions(normalGroup.id, [Permission.USER_DELETE])).resolves.not.toThrow();

      const group = await prisma.group.findUniqueOrThrow({ where: { id: normalGroup.id } });
      expect(group.permissions).toEqual([Permission.USER_DELETE]);
    });

    it("应该阻止 RAM 策略创建越权权限", async () => {
      await expect(
        ramService.createPolicy(adminUser.id, {
          name: "test_forbidden_policy",
          permissions: [Permission.USER_DELETE],
        }),
      ).rejects.toThrow(ForbiddenError);

      await expect(prisma.ramPolicy.findFirst({ where: { name: "test_forbidden_policy" } })).resolves.toBeNull();
    });

    it("应该阻止 RAM 策略创建混合权限且不落库", async () => {
      await expect(
        ramService.createPolicy(adminUser.id, {
          name: "test_mixed_policy",
          permissions: [Permission.USER_READ, Permission.USER_DELETE],
        }),
      ).rejects.toThrow(ForbiddenError);

      await expect(prisma.ramPolicy.findFirst({ where: { name: "test_mixed_policy" } })).resolves.toBeNull();
    });

    it("应该允许 RAM 策略创建自有权限", async () => {
      await expect(
        ramService.createPolicy(adminUser.id, {
          name: "test_allowed_policy",
          permissions: [Permission.USER_READ],
        }),
      ).resolves.toMatchObject({ name: "test_allowed_policy", permissions: [Permission.USER_READ] });
    });

    it("应该在创建 RAM 策略时去重自有权限", async () => {
      await expect(
        ramService.createPolicy(adminUser.id, {
          name: "test_dedup_policy",
          permissions: [Permission.USER_READ, Permission.USER_READ],
        }),
      ).resolves.toMatchObject({ name: "test_dedup_policy", permissions: [Permission.USER_READ] });
    });

    it("应该允许 RAM 策略只更新描述而不重验旧权限", async () => {
      const dirtyPolicy = await prisma.ramPolicy.create({
        data: {
          accountOwnerId: adminUser.id,
          name: "test_update_policy",
          description: "before",
          permissions: [Permission.USER_DELETE],
          type: "custom",
          status: 1,
        },
      });

      await expect(
        ramService.updatePolicy(adminUser.id, dirtyPolicy.id, { description: "after" }),
      ).resolves.toMatchObject({ description: "after", permissions: [Permission.USER_DELETE] });
    });

    it("应该阻止 RAM 策略更新为越权权限且保留旧权限", async () => {
      const policy = await ramService.createPolicy(adminUser.id, {
        name: "test_update_policy",
        permissions: [Permission.USER_READ],
      });

      await expect(
        ramService.updatePolicy(adminUser.id, policy.id, { permissions: [Permission.USER_DELETE] }),
      ).rejects.toThrow(ForbiddenError);

      const stored = await prisma.ramPolicy.findUniqueOrThrow({ where: { id: policy.id } });
      expect(stored.permissions).toEqual([Permission.USER_READ]);
    });

    it("应该允许 RAM 策略更新为空权限列表", async () => {
      const policy = await ramService.createPolicy(adminUser.id, {
        name: "test_update_policy",
        permissions: [Permission.USER_READ],
      });

      await expect(ramService.updatePolicy(adminUser.id, policy.id, { permissions: [] })).resolves.toMatchObject({
        permissions: [],
      });
    });

    it("应该阻止绑定包含历史脏权限的 RAM 策略", async () => {
      const dirtyPolicy = await prisma.ramPolicy.create({
        data: {
          accountOwnerId: adminUser.id,
          name: "test_forbidden_dirty_policy",
          permissions: [Permission.USER_DELETE],
          type: "custom",
          status: 1,
        },
      });

      await expect(
        ramService.attachPolicy(adminUser.id, {
          policyId: dirtyPolicy.id,
          targetType: "user",
          targetId: targetUser.id,
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it("应该阻止历史脏 RAM 策略绑定到角色和用户组", async () => {
      const role = await prisma.ramRole.create({
        data: {
          accountOwnerId: adminUser.id,
          name: "test_dirty_role",
          description: null,
          maxSessionDuration: 3600,
        },
      });
      const rolePolicy = await prisma.ramPolicy.create({
        data: {
          accountOwnerId: adminUser.id,
          name: "test_dirty_role_policy",
          permissions: [Permission.USER_DELETE],
          type: "custom",
          status: 1,
        },
      });
      const groupPolicy = await prisma.ramPolicy.create({
        data: {
          accountOwnerId: adminUser.id,
          name: "test_dirty_group_policy",
          permissions: [Permission.USER_DELETE],
          type: "custom",
          status: 1,
        },
      });

      await expect(
        ramService.attachPolicy(adminUser.id, {
          policyId: rolePolicy.id,
          targetType: "role",
          targetId: role.id,
        }),
      ).rejects.toThrow(ForbiddenError);

      await expect(
        ramService.attachPolicy(adminUser.id, {
          policyId: groupPolicy.id,
          targetType: "group",
          targetId: normalGroup.id,
        }),
      ).rejects.toThrow(ForbiddenError);

      await prisma.ramRole.delete({ where: { id: role.id } });
    });

    it("应该允许绑定干净 RAM 策略", async () => {
      const policy = await ramService.createPolicy(adminUser.id, {
        name: "test_allowed_policy",
        permissions: [Permission.USER_READ],
      });

      await expect(
        ramService.attachPolicy(adminUser.id, {
          policyId: policy.id,
          targetType: "user",
          targetId: targetUser.id,
        }),
      ).resolves.not.toThrow();
    });

    it("应该阻止 RAM 策略跨主账号绑定到用户、用户组和角色", async () => {
      const otherGroup = await prisma.group.create({
        data: {
          username: "test_other_group",
          name: "其他主账号用户组",
          level: 10,
          permissions: [],
        },
      });
      const otherOwner = await prisma.user.create({
        data: {
          username: "test_other_owner",
          password: "test_password",
          groupId: otherGroup.id,
          permissionAdds: [],
          permissionRemoves: [],
        },
      });
      const otherRamUser = await prisma.user.create({
        data: {
          username: "test_other_ram_user",
          password: "test_password",
          groupId: otherGroup.id,
          accountOwnerId: otherOwner.id,
          parentUserId: otherOwner.id,
          userType: "ram_user",
          ramUsername: "test_other_ram_user",
          permissionAdds: [],
          permissionRemoves: [],
        },
      });
      const otherRole = await prisma.ramRole.create({
        data: {
          accountOwnerId: otherOwner.id,
          name: "test_other_role",
          maxSessionDuration: 3600,
        },
      });
      await prisma.group.update({ where: { id: otherGroup.id }, data: { accountOwnerId: otherOwner.id } });
      const policy = await ramService.createPolicy(adminUser.id, {
        name: "test_cross_account_policy",
        permissions: [Permission.USER_READ],
      });

      for (const target of [
        { targetType: "user" as const, targetId: otherRamUser.id },
        { targetType: "group" as const, targetId: otherGroup.id },
        { targetType: "role" as const, targetId: otherRole.id },
      ]) {
        await expect(ramService.attachPolicy(adminUser.id, { policyId: policy.id, ...target })).rejects.toThrow(
          ForbiddenError,
        );
        await expect(ramService.detachPolicy(adminUser.id, { policyId: policy.id, ...target })).rejects.toThrow(
          ForbiddenError,
        );
      }

      await expect(prisma.ramPolicyAttachment.findMany({ where: { policyId: policy.id } })).resolves.toHaveLength(0);
    });

    it("应该允许软删除后重新创建同名 RAM 策略", async () => {
      const policy = await ramService.createPolicy(adminUser.id, {
        name: "test_recreate_policy",
        permissions: [Permission.USER_READ],
      });

      await expect(ramService.deletePolicy(adminUser.id, policy.id)).resolves.not.toThrow();

      await expect(
        ramService.createPolicy(adminUser.id, {
          name: "test_recreate_policy",
          permissions: [Permission.USER_READ],
        }),
      ).resolves.toMatchObject({ name: "test_recreate_policy", permissions: [Permission.USER_READ] });

      const recreated = await prisma.ramPolicy.findFirstOrThrow({
        where: { name: "test_recreate_policy", status: AccountStatus.ACTIVE },
        orderBy: { createTime: "desc" },
      });

      await expect(ramService.deletePolicy(adminUser.id, recreated.id)).resolves.not.toThrow();

      const deleted = await prisma.ramPolicy.findUniqueOrThrow({ where: { id: policy.id } });
      expect(deleted.name).toBe("test_recreate_policy");
      expect(deleted.status).toBe(AccountStatus.DISABLED);
      expect(deleted.activeName).toBeNull();
    });
  });
});
