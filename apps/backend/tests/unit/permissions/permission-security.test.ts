import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { permissionService } from "../../../src/services/users/permission.service";
import { RamService } from "../../../src/services/users/ram.service";
import { prisma } from "../../../src/config/database";
import { Permission } from "../../../src/constant/permission";
import { ForbiddenError } from "../../../src/util/errors";

const ramService = RamService.getInstance();

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
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
  });

  afterAll(async () => {
    // 清理测试数据
    await prisma.ramPolicyAttachment.deleteMany({
      where: {
        policy: {
          name: {
            in: ["test_allowed_policy", "test_forbidden_dirty_policy"],
          },
        },
      },
    });

    await prisma.ramPolicy.deleteMany({
      where: {
        name: {
          in: ["test_allowed_policy", "test_forbidden_dirty_policy"],
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        username: {
          in: ["test_admin", "test_normal", "test_target"],
        },
      },
    });

    await prisma.group.deleteMany({
      where: {
        username: {
          in: ["test_admin_group", "test_normal_group"],
        },
      },
    });
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
    it("应该阻止用户权限添加越权权限", async () => {
      await expect(
        permissionService.addUserPermissions(adminUser.id, targetUser.id, [Permission.USER_DELETE]),
      ).rejects.toThrow(ForbiddenError);
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
    });

    it("应该阻止 RAM 策略创建越权权限", async () => {
      await expect(
        ramService.createPolicy(adminUser.id, {
          name: "test_forbidden_policy",
          permissions: [Permission.USER_DELETE],
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it("应该允许 RAM 策略创建自有权限", async () => {
      await expect(
        ramService.createPolicy(adminUser.id, {
          name: "test_allowed_policy",
          permissions: [Permission.USER_READ],
        }),
      ).resolves.toMatchObject({ name: "test_allowed_policy", permissions: [Permission.USER_READ] });
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
  });
});
