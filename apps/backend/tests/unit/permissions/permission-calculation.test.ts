import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { permissionService } from "../../../src/services/users/permission.service";
import { prisma } from "../../../src/config/database";
import { Permission } from "../../../src/constant/permission";
import { BadRequestError } from "../../../src/util/errors";

describe("权限计算逻辑测试", () => {
  let testGroup: any;
  let testUser: any;

  beforeAll(async () => {
    // 创建测试用户组，带有基础权限
    testGroup = await prisma.group.create({
      data: {
        username: "test_perm_calc_group",
        name: "权限计算测试组",
        level: 5,
        permissions: JSON.stringify([Permission.USER_READ, Permission.USER_UPDATE]),
      },
    });

    // 创建测试用户
    testUser = await prisma.user.create({
      data: {
        username: "test_perm_calc_user",
        password: "password",
        groupId: testGroup.id,
        permissionAdds: JSON.stringify([Permission.PERMISSION_VIEW]),
        permissionRemoves: JSON.stringify([Permission.USER_READ]),
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { username: "test_perm_calc_user" },
    });

    await prisma.group.deleteMany({
      where: { username: "test_perm_calc_group" },
    });
  });

  describe("calculateUserPermissions() - 权限计算", () => {
    it("应该正确计算用户最终权限: (group + adds) - removes", async () => {
      const user = (await prisma.user.findUnique({ where: { id: testUser.id }, include: { group: true } }))!;

      const result = permissionService.calculateUserPermissions(user, user.group);

      expect(result.groupPermissions).toContain(Permission.USER_READ);
      expect(result.groupPermissions).toContain(Permission.USER_UPDATE);
      expect(result.additionalPermissions).toContain(Permission.PERMISSION_VIEW);
      expect(result.removedPermissions).toContain(Permission.USER_READ);

      // 最终权限应该是: [USER_READ, USER_UPDATE] + [PERMISSION_VIEW] - [USER_READ]
      // = [USER_UPDATE, PERMISSION_VIEW]
      expect(result.effectivePermissions).toContain(Permission.USER_UPDATE);
      expect(result.effectivePermissions).toContain(Permission.PERMISSION_VIEW);
      expect(result.effectivePermissions).not.toContain(Permission.USER_READ);
    });

    it("应该处理空的 adds 和 removes", async () => {
      const groupWithPerms = await prisma.group.create({
        data: {
          username: "test_empty_config_group",
          name: "空配置测试组",
          level: 5,
          permissions: JSON.stringify([Permission.USER_READ]),
        },
      });

      const userWithoutConfig = await prisma.user.create({
        data: {
          username: "test_empty_config_user",
          password: "password",
          groupId: groupWithPerms.id,
          permissionAdds: JSON.stringify([]),
          permissionRemoves: JSON.stringify([]),
        },
      });

      const user = (await prisma.user.findUnique({
        where: { id: userWithoutConfig.id },
        include: { group: true },
      }))!;

      const result = permissionService.calculateUserPermissions(user, user.group);

      expect(result.effectivePermissions).toEqual([Permission.USER_READ]);
      expect(result.additionalPermissions).toEqual([]);
      expect(result.removedPermissions).toEqual([]);

      // 清理
      await prisma.user.delete({ where: { id: userWithoutConfig.id } });
      await prisma.group.delete({ where: { id: groupWithPerms.id } });
    });

    it("应该处理重复的权限（去重）", async () => {
      const groupWithDups = await prisma.group.create({
        data: {
          username: "test_dup_group",
          name: "重复权限测试",
          level: 5,
          permissions: JSON.stringify([Permission.USER_READ, Permission.USER_READ]),
        },
      });

      const userWithDups = await prisma.user.create({
        data: {
          username: "test_dup_user",
          password: "password",
          groupId: groupWithDups.id,
          permissionAdds: JSON.stringify([Permission.USER_READ, Permission.PERMISSION_VIEW]),
          permissionRemoves: [],
        },
      });

      const user = (await prisma.user.findUnique({
        where: { id: userWithDups.id },
        include: { group: true },
      }))!;

      const result = permissionService.calculateUserPermissions(user, user.group);

      // 应该去重
      const userReadCount = result.effectivePermissions.filter((p) => p === Permission.USER_READ).length;
      expect(userReadCount).toBe(1);

      // 清理
      await prisma.user.delete({ where: { id: userWithDups.id } });
      await prisma.group.delete({ where: { id: groupWithDups.id } });
    });
  });

  describe("hasPermission() - 单个权限检查", () => {
    it("应该在用户有权限时返回 true", async () => {
      const result = await permissionService.hasPermission(testUser.id, Permission.USER_UPDATE);
      expect(result).toBe(true);
    });

    it("应该在用户没有权限时返回 false", async () => {
      const result = await permissionService.hasPermission(testUser.id, Permission.PERMISSION_ADD);
      expect(result).toBe(false);
    });

    it("应该在权限被移除后返回 false", async () => {
      const result = await permissionService.hasPermission(testUser.id, Permission.USER_READ);
      expect(result).toBe(false); // USER_READ 在 removes 中
    });
  });

  describe("hasAnyPermission() - 任一权限检查", () => {
    it("应该在用户至少有一个权限时返回 true", async () => {
      const result = await permissionService.hasAnyPermission(testUser.id, [
        Permission.USER_CHANGE_SELF_PASSWORD,
        Permission.USER_UPDATE, // 用户有这个
        Permission.PERMISSION_ADD,
      ]);
      expect(result).toBe(true);
    });

    it("应该在用户没有任何指定权限时返回 false", async () => {
      const result = await permissionService.hasAnyPermission(testUser.id, [
        Permission.USER_CHANGE_SELF_PASSWORD,
        Permission.PERMISSION_ADD,
        Permission.USER_READ, // 被移除了
      ]);
      expect(result).toBe(false);
    });

    it("应该处理空权限数组", async () => {
      const result = await permissionService.hasAnyPermission(testUser.id, []);
      expect(result).toBe(false);
    });
  });

  describe("hasAllPermissions() - 全部权限检查", () => {
    it("应该在用户拥有所有权限时返回 true", async () => {
      const result = await permissionService.hasAllPermissions(testUser.id, [
        Permission.USER_UPDATE,
        Permission.PERMISSION_VIEW,
      ]);
      expect(result).toBe(true);
    });

    it("应该在用户缺少任一权限时返回 false", async () => {
      const result = await permissionService.hasAllPermissions(testUser.id, [
        Permission.USER_UPDATE, // 有
        Permission.PERMISSION_ADD, // 没有
      ]);
      expect(result).toBe(false);
    });

    it("应该处理空权限数组", async () => {
      const result = await permissionService.hasAllPermissions(testUser.id, []);
      expect(result).toBe(true); // 空数组应该返回 true（没有要求）
    });
  });

  describe("checkUserPermissions() - 详细权限检查", () => {
    it("应该返回详细的权限检查结果（有权限）", async () => {
      const result = await permissionService.checkUserPermissions(testUser.id, [
        Permission.USER_UPDATE,
        Permission.PERMISSION_VIEW,
      ]);

      expect(result.hasPermission).toBe(true);
      expect(result.checkedPermissions).toEqual([Permission.USER_UPDATE, Permission.PERMISSION_VIEW]);
      expect(result.missingPermissions).toBeUndefined();
    });

    it("应该返回详细的权限检查结果（缺少权限）", async () => {
      const result = await permissionService.checkUserPermissions(testUser.id, [
        Permission.USER_UPDATE, // 有
        Permission.PERMISSION_ADD, // 没有
        Permission.USER_READ, // 没有（被移除）
      ]);

      expect(result.hasPermission).toBe(false);
      expect(result.missingPermissions).toContain(Permission.PERMISSION_ADD);
      expect(result.missingPermissions).toContain(Permission.USER_READ);
    });

    it("应该在用户不存在时返回无权限", async () => {
      const result = await permissionService.checkUserPermissions("non-existent-user", [Permission.USER_READ]);

      expect(result.hasPermission).toBe(false);
      expect(result.missingPermissions).toEqual([Permission.USER_READ]);
    });
  });

  describe("validatePermissions() - 权限验证", () => {
    it("应该验证有效的权限列表", () => {
      expect(() => {
        permissionService.validatePermissions([Permission.USER_READ, Permission.PERMISSION_VIEW]);
      }).not.toThrow();
    });

    it("应该拒绝无效的权限", () => {
      expect(() => {
        permissionService.validatePermissions(["INVALID_PERMISSION" as any]);
      }).toThrow(BadRequestError);
    });

    it("应该拒绝混合有效和无效的权限", () => {
      expect(() => {
        permissionService.validatePermissions([Permission.USER_READ, "INVALID" as any]);
      }).toThrow(BadRequestError);
    });
  });

  describe("parsePermissionJson() - JSON解析", () => {
    it("应该解析 JSON 字符串数组", () => {
      const json = JSON.stringify([Permission.USER_READ, Permission.PERMISSION_VIEW]);
      const result = permissionService.parsePermissionJson(json);

      expect(result).toContain(Permission.USER_READ);
      expect(result).toContain(Permission.PERMISSION_VIEW);
    });

    it("应该处理已解析的数组", () => {
      const array = [Permission.USER_READ, Permission.PERMISSION_VIEW];
      const result = permissionService.parsePermissionJson(array);

      expect(result).toEqual(array);
    });

    it("应该处理无效的 JSON", () => {
      const result = permissionService.parsePermissionJson("invalid json");
      expect(result).toEqual([]);
    });

    it("应该过滤无效的权限", () => {
      const json = JSON.stringify([Permission.USER_READ, "INVALID", Permission.PERMISSION_VIEW, "ALSO_INVALID"]);
      const result = permissionService.parsePermissionJson(json);

      expect(result).toContain(Permission.USER_READ);
      expect(result).toContain(Permission.PERMISSION_VIEW);
      expect(result).not.toContain("INVALID" as any);
      expect(result).not.toContain("ALSO_INVALID" as any);
    });

    it("应该处理非数组的 JSON", () => {
      const result = permissionService.parsePermissionJson(JSON.stringify({ key: "value" }));
      expect(result).toEqual([]);
    });

    it("应该处理 null 和 undefined", () => {
      expect(permissionService.parsePermissionJson(null)).toEqual([]);
      expect(permissionService.parsePermissionJson(undefined)).toEqual([]);
    });
  });

  describe("getGroupPermissions() / setGroupPermissions() - 群组权限", () => {
    let testGroupForCrud: any;

    beforeAll(async () => {
      testGroupForCrud = await prisma.group.create({
        data: {
          username: "test_group_perm_crud",
          name: "群组权限CRUD测试",
          level: 5,
          permissions: JSON.stringify([Permission.USER_READ]),
        },
      });
    });

    afterAll(async () => {
      await prisma.group.deleteMany({
        where: { username: "test_group_perm_crud" },
      });
    });

    it("应该获取群组权限", async () => {
      const permissions = await permissionService.getGroupPermissions(testGroupForCrud.id);

      expect(permissions).toContain(Permission.USER_READ);
    });

    it("应该设置群组权限", async () => {
      await permissionService.setGroupPermissions(testGroupForCrud.id, [
        Permission.PERMISSION_VIEW,
        Permission.USER_UPDATE,
      ]);

      const permissions = await permissionService.getGroupPermissions(testGroupForCrud.id);

      expect(permissions).toContain(Permission.PERMISSION_VIEW);
      expect(permissions).toContain(Permission.USER_UPDATE);
      expect(permissions).not.toContain(Permission.USER_READ);
    });

    it("应该在群组不存在时返回空数组", async () => {
      const permissions = await permissionService.getGroupPermissions("non-existent-group");
      expect(permissions).toEqual([]);
    });

    it("应该在设置群组权限时验证权限有效性", async () => {
      await expect(
        permissionService.setGroupPermissions(testGroupForCrud.id, [Permission.USER_READ, "INVALID_PERMISSION" as any]),
      ).rejects.toThrow(BadRequestError);
    });

    it("应该自动去重群组权限", async () => {
      await permissionService.setGroupPermissions(testGroupForCrud.id, [
        Permission.USER_READ,
        Permission.USER_READ,
        Permission.PERMISSION_VIEW,
      ]);

      const group = await prisma.group.findUnique({ where: { id: testGroupForCrud.id } });
      const permissions = typeof group!.permissions === "string" ? JSON.parse(group!.permissions) : group!.permissions;

      // 检查数组中没有重复
      const uniquePermissions = new Set(permissions);
      expect(permissions.length).toBe(uniquePermissions.size);
    });
  });
});
