import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UserService } from "../../../src/services/users/user.service";
import { prisma } from "../../../src/config/database";
import { hashPassword } from "../../../src/util/crypto";

describe("用户服务测试", () => {
  const userService = new UserService();
  let testGroup1: any;
  let testGroup2: any;
  let testGroup3: any;
  let testUser1: any; // level 1 (高权限)
  let testUser2: any; // level 5 (中权限)
  let testUser3: any; // level 10 (低权限)

  beforeAll(async () => {
    // 创建不同级别的测试用户组
    testGroup1 = await prisma.group.create({
      data: {
        username: "test_user_group_1",
        name: "高级用户组",
        level: 1,
        permissions: JSON.stringify([]),
      },
    });

    testGroup2 = await prisma.group.create({
      data: {
        username: "test_user_group_2",
        name: "中级用户组",
        level: 5,
        permissions: JSON.stringify([]),
      },
    });

    testGroup3 = await prisma.group.create({
      data: {
        username: "test_user_group_3",
        name: "普通用户组",
        level: 10,
        permissions: JSON.stringify([]),
      },
    });

    // 创建不同级别的测试用户
    testUser1 = await prisma.user.create({
      data: {
        username: "test_user_1",
        password: hashPassword("password1"),
        name: "测试用户1",
        email: "user1@test.com",
        groupId: testGroup1.id,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });

    testUser2 = await prisma.user.create({
      data: {
        username: "test_user_2",
        password: hashPassword("password2"),
        name: "测试用户2",
        email: "user2@test.com",
        groupId: testGroup2.id,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });

    testUser3 = await prisma.user.create({
      data: {
        username: "test_user_3",
        password: hashPassword("password3"),
        name: "测试用户3",
        email: "user3@test.com",
        groupId: testGroup3.id,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
  });

  afterAll(async () => {
    // 清理测试数据
    await prisma.user.deleteMany({
      where: {
        username: {
          in: ["test_user_1", "test_user_2", "test_user_3"],
        },
      },
    });

    await prisma.group.deleteMany({
      where: {
        username: {
          in: ["test_user_group_1", "test_user_group_2", "test_user_group_3"],
        },
      },
    });
  });

  describe("getAllUsers() - 获取所有用户", () => {
    it("应该返回所有用户的列表", async () => {
      const users = await userService.getAllUsers();

      expect(users).toBeInstanceOf(Array);
      expect(users.length).toBeGreaterThanOrEqual(3);

      // 检查是否包含测试用户
      const usernames = users.map((u) => u.username);
      expect(usernames).toContain("test_user_1");
      expect(usernames).toContain("test_user_2");
      expect(usernames).toContain("test_user_3");
    });

    it("返回的用户对象不应包含密码字段", async () => {
      const users = await userService.getAllUsers();
      const testUser = users.find((u) => u.username === "test_user_1");

      expect(testUser).toBeTruthy();
      expect(testUser).not.toHaveProperty("password");
    });

    it("返回的用户对象应包含必要字段", async () => {
      const users = await userService.getAllUsers();
      const testUser = users.find((u) => u.username === "test_user_1");

      expect(testUser).toHaveProperty("id");
      expect(testUser).toHaveProperty("username");
      expect(testUser).toHaveProperty("email");
      expect(testUser).toHaveProperty("name");
      expect(testUser).toHaveProperty("groupId");
      expect(testUser).toHaveProperty("createdAt");
      expect(testUser).toHaveProperty("updatedAt");
    });
  });

  describe("getAllLevelGreaterThan() - 获取同级或低级别的用户", () => {
    it("高级别用户应该能看到所有用户（包括自己）", async () => {
      const users = await userService.getAllLevelGreaterThan(testUser1.id);

      expect(users.length).toBeGreaterThanOrEqual(3);
      const usernames = users.map((u) => u.username);
      expect(usernames).toContain("test_user_1"); // level 1
      expect(usernames).toContain("test_user_2"); // level 5
      expect(usernames).toContain("test_user_3"); // level 10
    });

    it("中级别用户应该只能看到同级或更低级别的用户", async () => {
      const users = await userService.getAllLevelGreaterThan(testUser2.id);
      const usernames = users.map((u) => u.username);

      expect(usernames).toContain("test_user_2"); // level 5
      expect(usernames).toContain("test_user_3"); // level 10
      expect(usernames).not.toContain("test_user_1"); // level 1 (更高级别，不应该看到)
    });

    it("低级别用户应该只能看到同级或更低级别的用户", async () => {
      const users = await userService.getAllLevelGreaterThan(testUser3.id);
      const usernames = users.map((u) => u.username);

      expect(usernames).toContain("test_user_3"); // level 10
      expect(usernames).not.toContain("test_user_1"); // level 1
      expect(usernames).not.toContain("test_user_2"); // level 5
    });

    it("应该在用户不存在时返回空数组", async () => {
      const users = await userService.getAllLevelGreaterThan("non-existent-user-id");
      expect(users).toEqual([]);
    });
  });

  describe("getUserById() - 通过ID获取用户", () => {
    it("应该成功获取存在的用户", async () => {
      const user = await userService.getUserById(testUser1.id);

      expect(user).toBeTruthy();
      expect(user!.id).toBe(testUser1.id);
      expect(user!.username).toBe("test_user_1");
      expect(user!.email).toBe("user1@test.com");
    });

    it("返回的用户对象不应包含密码字段", async () => {
      const user = await userService.getUserById(testUser1.id);

      expect(user).toBeTruthy();
      expect(user).not.toHaveProperty("password");
    });

    it("应该在用户不存在时返回 null", async () => {
      const user = await userService.getUserById("non-existent-user-id");
      expect(user).toBeNull();
    });
  });

  describe("changeUserPassword() - 修改用户密码", () => {
    it("应该成功修改用户密码", async () => {
      const newPasswordHash = hashPassword("new_password_123");

      await userService.changeUserPassword(testUser1.id, newPasswordHash);

      // 验证密码已更新
      const updatedUser = await prisma.user.findUnique({ where: { id: testUser1.id } });
      expect(updatedUser!.password).toBe(newPasswordHash);
    });

    it("修改密码应该更新 updateTime 字段", async () => {
      const userBefore = await prisma.user.findUnique({ where: { id: testUser2.id } });
      const updateTimeBefore = userBefore!.updateTime;

      // 等待一小段时间确保时间戳不同
      await new Promise((resolve) => setTimeout(resolve, 100));

      const newPasswordHash = hashPassword("another_new_password");
      await userService.changeUserPassword(testUser2.id, newPasswordHash);

      const userAfter = await prisma.user.findUnique({ where: { id: testUser2.id } });
      const updateTimeAfter = userAfter!.updateTime;

      expect(updateTimeAfter.getTime()).toBeGreaterThan(updateTimeBefore.getTime());
    });

    it("应该能多次修改同一用户的密码", async () => {
      const password1 = hashPassword("password_v1");
      const password2 = hashPassword("password_v2");
      const password3 = hashPassword("password_v3");

      await userService.changeUserPassword(testUser3.id, password1);
      let user = await prisma.user.findUnique({ where: { id: testUser3.id } });
      expect(user!.password).toBe(password1);

      await userService.changeUserPassword(testUser3.id, password2);
      user = await prisma.user.findUnique({ where: { id: testUser3.id } });
      expect(user!.password).toBe(password2);

      await userService.changeUserPassword(testUser3.id, password3);
      user = await prisma.user.findUnique({ where: { id: testUser3.id } });
      expect(user!.password).toBe(password3);
    });
  });

  describe("mapUserToDto() - 数据转换", () => {
    it("应该正确排除密码字段", async () => {
      const user = await userService.getUserById(testUser1.id);

      expect(user).toBeTruthy();
      expect(user).not.toHaveProperty("password");
    });

    it("应该正确转换日期字段为 ISO 字符串", async () => {
      const user = await userService.getUserById(testUser1.id);

      expect(user).toBeTruthy();
      expect(typeof user!.createdAt).toBe("string");
      expect(typeof user!.updatedAt).toBe("string");
      expect(() => new Date(user!.createdAt!)).not.toThrow();
      expect(() => new Date(user!.updatedAt!)).not.toThrow();
    });
  });
});
