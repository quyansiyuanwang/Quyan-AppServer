import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/config/database";
import { hashPassword } from "../../src/util/crypto";
import { Permission } from "../../src/constant/permission";
import { Express } from "express";
import { withReplayProtection } from "../util/replay-protection-test-helper";

describe("用户管理 API 集成测试", () => {
  let app: Express;
  let adminGroup: any;
  let userGroup: any;
  let adminUser: any;
  let normalUser: any;
  let targetUser: any;
  let adminToken: string;
  let normalUserToken: string;

  const postWithReplay = (path: string, body: Record<string, unknown>) =>
    withReplayProtection(request(app).post(path), body, path);

  const patchWithReplay = (path: string, body: Record<string, unknown>) =>
    withReplayProtection(request(app).patch(path), body, path);

  beforeAll(async () => {
    app = createApp();

    // 创建管理员组（有所有权限）
    adminGroup = await prisma.group.create({
      data: {
        username: "test_user_integration_admin_group",
        name: "测试管理员组",
        level: 1,
        permissions: JSON.stringify([
          Permission.USER_READ,
          Permission.USER_UPDATE,
          Permission.USER_CHANGE_SELF_PASSWORD,
          Permission.USER_CHANGE_OTHERS_PASSWORD,
        ]),
      },
    });

    // 创建普通用户组（只有基本权限）
    userGroup = await prisma.group.create({
      data: {
        username: "test_user_integration_user_group",
        name: "测试用户组",
        level: 10,
        permissions: JSON.stringify([Permission.USER_CHANGE_SELF_PASSWORD]),
      },
    });

    // 创建管理员用户
    adminUser = await prisma.user.create({
      data: {
        username: "test_user_admin",
        password: hashPassword("admin_password"),
        name: "测试管理员",
        email: "admin@test.com",
        groupId: adminGroup.id,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });

    // 创建普通用户
    normalUser = await prisma.user.create({
      data: {
        username: "test_user_normal",
        password: hashPassword("normal_password"),
        name: "普通测试用户",
        email: "normal@test.com",
        groupId: userGroup.id,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });

    // 创建目标用户（用于测试操作）
    targetUser = await prisma.user.create({
      data: {
        username: "test_user_target",
        password: hashPassword("target_password"),
        name: "目标用户",
        email: "target@test.com",
        groupId: userGroup.id,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });

    // 获取管理员令牌
    const adminLoginBody = {
      username: "test_user_admin",
      password: "admin_password",
      agreedToLegalPolicies: true,
    };
    const adminLoginResponse = await postWithReplay("/v1/auth/login", adminLoginBody).send(adminLoginBody);
    adminToken = adminLoginResponse.body.data.access_token;

    // 获取普通用户令牌
    const normalLoginBody = {
      username: "test_user_normal",
      password: "normal_password",
      agreedToLegalPolicies: true,
    };
    const normalLoginResponse = await postWithReplay("/v1/auth/login", normalLoginBody).send(normalLoginBody);
    normalUserToken = normalLoginResponse.body.data.access_token;
  });

  afterAll(async () => {
    // 清理测试数据
    await prisma.user.deleteMany({
      where: {
        username: {
          in: ["test_user_admin", "test_user_normal", "test_user_target"],
        },
      },
    });

    await prisma.group.deleteMany({
      where: {
        username: {
          in: ["test_user_integration_admin_group", "test_user_integration_user_group"],
        },
      },
    });
  });

  describe("GET /users/me - 获取当前用户信息", () => {
    it("应该成功获取当前用户信息", async () => {
      const response = await request(app).get("/v1/users/me").set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("code");
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("data");
      expect(response.body.code).toBe(0);
      expect(response.body.data.username).toBe("test_user_admin");
      expect(response.body.data.email).toBe("admin@test.com");
      expect(response.body.data).not.toHaveProperty("password");
    });

    it("应该在未认证时返回 401", async () => {
      const response = await request(app).get("/v1/users/me");

      expect(response.status).toBe(401);
    });

    it("应该在令牌无效时返回 401", async () => {
      const response = await request(app).get("/v1/users/me").set("Authorization", "Bearer invalid_token");

      expect(response.status).toBe(401);
    });
  });

  describe("GET /users - 获取所有用户", () => {
    it("有权限的用户应该成功获取用户列表", async () => {
      const response = await request(app).get("/v1/users").set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("code");
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("data");
      expect(response.body.code).toBe(0);
      expect(response.body.data).toHaveProperty("users");
      expect(response.body.data).toHaveProperty("total");
      expect(Array.isArray(response.body.data.users)).toBe(true);
      expect(response.body.data.users.length).toBeGreaterThanOrEqual(3);

      // 检查返回的用户不包含密码
      response.body.data.users.forEach((user: any) => {
        expect(user).not.toHaveProperty("password");
      });
    });

    it("应该在未认证时返回 401", async () => {
      const response = await request(app).get("/v1/users");

      expect(response.status).toBe(401);
    });

    it("应该在没有权限时返回 403", async () => {
      const response = await request(app).get("/v1/users").set("Authorization", `Bearer ${normalUserToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe("GET /users/:userId - 通过ID获取用户", () => {
    it("有权限的用户应该成功获取指定用户", async () => {
      const response = await request(app)
        .get(`/v1/users/${targetUser.id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("code");
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("data");
      expect(response.body.code).toBe(0);
      expect(response.body.data.id).toBe(targetUser.id);
      expect(response.body.data.username).toBe("test_user_target");
      expect(response.body.data).not.toHaveProperty("password");
    });

    it("应该在用户不存在时返回 404", async () => {
      const response = await request(app)
        .get("/v1/users/non-existent-user-id")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });

    it("应该在未认证时返回 401", async () => {
      const response = await request(app).get(`/v1/users/${targetUser.id}`);

      expect(response.status).toBe(401);
    });
  });

  describe("PATCH /users/:userId/password - 修改密码", () => {
    it("用户应该能修改自己的密码", async () => {
      const requestBody = {
        newPassword: "new_normal_password_123",
      };

      const response = await patchWithReplay(`/v1/users/${normalUser.id}/password`, requestBody)
        .set("Authorization", `Bearer ${normalUserToken}`)
        .send(requestBody);

      expect(response.status).toBe(200);

      // 验证新密码可以登录
      const loginBody = {
        username: "test_user_normal",
        password: "new_normal_password_123",
        agreedToLegalPolicies: true,
      };
      const loginResponse = await postWithReplay("/v1/auth/login", loginBody).send(loginBody);

      expect(loginResponse.status).toBe(200);

      // 恢复原密码
      await prisma.user.update({
        where: { id: normalUser.id },
        data: { password: hashPassword("normal_password") },
      });
    });

    it("管理员应该能修改他人密码", async () => {
      const requestBody = {
        newPassword: "changed_by_admin",
      };

      const response = await patchWithReplay(`/v1/users/${targetUser.id}/password`, requestBody)
        .set("Authorization", `Bearer ${adminToken}`)
        .send(requestBody);

      expect(response.status).toBe(200);

      // 验证新密码可以登录
      const loginBody = {
        username: "test_user_target",
        password: "changed_by_admin",
        agreedToLegalPolicies: true,
      };
      const loginResponse = await postWithReplay("/v1/auth/login", loginBody).send(loginBody);

      expect(loginResponse.status).toBe(200);

      // 恢复原密码
      await prisma.user.update({
        where: { id: targetUser.id },
        data: { password: hashPassword("target_password") },
      });
    });

    it("普通用户不应该能修改他人密码", async () => {
      // 重新获取 normalUser 令牌，因为之前的测试可能已经修改了密码
      const freshLoginBody = {
        username: "test_user_normal",
        password: "normal_password",
        agreedToLegalPolicies: true,
      };
      const freshLoginResponse = await postWithReplay("/v1/auth/login", freshLoginBody).send(freshLoginBody);
      const freshNormalUserToken = freshLoginResponse.body.data.access_token;

      const requestBody = {
        newPassword: "hacked_password",
      };

      const response = await patchWithReplay(`/v1/users/${targetUser.id}/password`, requestBody)
        .set("Authorization", `Bearer ${freshNormalUserToken}`)
        .send(requestBody);

      expect(response.status).toBe(403);

      // 验证密码未被修改
      const loginBody = {
        username: "test_user_target",
        password: "target_password",
        agreedToLegalPolicies: true,
      };
      const loginResponse = await postWithReplay("/v1/auth/login", loginBody).send(loginBody);

      expect(loginResponse.status).toBe(200);
    });

    it("修改密码后旧令牌应该失效", async () => {
      // 获取目标用户的令牌
      const loginBody = {
        username: "test_user_target",
        password: "target_password",
        agreedToLegalPolicies: true,
      };
      const loginResponse = await postWithReplay("/v1/auth/login", loginBody).send(loginBody);

      const oldToken = loginResponse.body.data.access_token;

      // 管理员修改目标用户的密码
      const requestBody = {
        newPassword: "password_changed_again",
      };

      await patchWithReplay(`/v1/users/${targetUser.id}/password`, requestBody)
        .set("Authorization", `Bearer ${adminToken}`)
        .send(requestBody);

      // 旧令牌应该失效
      const verifyResponse = await request(app).get("/v1/users/me").set("Authorization", `Bearer ${oldToken}`);

      expect(verifyResponse.status).toBe(401);

      // 恢复原密码
      await prisma.user.update({
        where: { id: targetUser.id },
        data: { password: hashPassword("target_password") },
      });
    });

    it("应该在未认证时返回 401", async () => {
      const requestBody = {
        newPassword: "new_password",
      };

      const response = await patchWithReplay(`/v1/users/${normalUser.id}/password`, requestBody).send(requestBody);

      expect(response.status).toBe(401);
    });

    it("应该在缺少新密码时返回 400", async () => {
      // 重新获取 normalUser 令牌
      const freshLoginBody = {
        username: "test_user_normal",
        password: "normal_password",
        agreedToLegalPolicies: true,
      };
      const freshLoginResponse = await postWithReplay("/v1/auth/login", freshLoginBody).send(freshLoginBody);
      const freshNormalUserToken = freshLoginResponse.body.data.access_token;

      const response = await patchWithReplay(`/v1/users/${normalUser.id}/password`, {})
        .set("Authorization", `Bearer ${freshNormalUserToken}`)
        .send({});

      expect(response.status).toBe(422);
    });
  });

  describe("密码字段安全测试", () => {
    it("所有用户 API 端点都不应该返回密码字段", async () => {
      // 测试 /users/me
      const meResponse = await request(app).get("/v1/users/me").set("Authorization", `Bearer ${adminToken}`);
      expect(meResponse.body.data).not.toHaveProperty("password");

      // 测试 /users
      const allUsersResponse = await request(app).get("/v1/users").set("Authorization", `Bearer ${adminToken}`);
      expect(allUsersResponse.body.data).toHaveProperty("users");
      allUsersResponse.body.data.users.forEach((user: any) => {
        expect(user).not.toHaveProperty("password");
      });

      // 测试 /users/:userId
      const userByIdResponse = await request(app)
        .get(`/v1/users/${normalUser.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(userByIdResponse.body.data).not.toHaveProperty("password");

      // 测试登录返回的用户信息
      const loginBody = {
        username: "test_user_admin",
        password: "admin_password",
        agreedToLegalPolicies: true,
      };
      const loginResponse = await postWithReplay("/v1/auth/login", loginBody).send(loginBody);
      expect(loginResponse.body.data.user).not.toHaveProperty("password");
    });
  });
});
