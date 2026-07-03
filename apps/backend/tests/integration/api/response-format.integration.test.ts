import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../../src/app";
import { prisma } from "../../../src/config/database";
import { hashPassword } from "../../../src/util/crypto";
import { Permission } from "../../../src/constant/permission";
import { Express } from "express";
import { withReplayProtection } from "../../util/replay-protection-test-helper";

/**
 * 响应格式通用测试
 *
 * 确保所有 API 接口返回统一的响应格式：
 * - 成功响应: {code: 0, message: string, data?: any}
 * - 错误响应: {code: number, message: string, ...}
 */
describe("API 响应格式通用测试", () => {
  let app: Express;
  let testGroup: any;
  let testUser: any;
  let accessToken: string;

  const postWithReplay = (path: string, body: Record<string, unknown>) =>
    withReplayProtection(request(app).post(path), body, path);

  const patchWithReplay = (path: string, body: Record<string, unknown>) =>
    withReplayProtection(request(app).patch(path), body, path);

  beforeAll(async () => {
    app = createApp();

    // 创建测试用户组
    testGroup = await prisma.group.create({
      data: {
        username: "t_resp_fmt_grp",
        name: "响应格式测试组",
        level: 1,
        permissions: JSON.stringify([
          Permission.USER_READ,
          Permission.USER_UPDATE,
          Permission.USER_CHANGE_SELF_PASSWORD,
          Permission.USER_CHANGE_OTHERS_PASSWORD,
          Permission.PERMISSION_VIEW,
          Permission.PERMISSION_ADD,
          Permission.DEBUG_OPENAPI_READ,
        ]),
      },
    });

    // 创建测试用户
    testUser = await prisma.user.create({
      data: {
        username: "t_resp_fmt_user",
        password: hashPassword("test_password"),
        name: "响应格式测试用户",
        email: "response_format@test.com",
        groupId: testGroup.id,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });

    // 获取访问令牌
    const loginBody = {
      username: "t_resp_fmt_user",
      password: "test_password",
      agreedToLegalPolicies: true,
    };
    const loginResponse = await postWithReplay("/v1/auth/login", loginBody).send(loginBody);

    if (loginResponse.status !== 200) {
      console.error("Login failed:", loginResponse.body);
      throw new Error(`Login failed with status ${loginResponse.status}`);
    }

    if (!loginResponse.body.data || !loginResponse.body.data.access_token) {
      console.error("Invalid login response structure:", loginResponse.body);
      throw new Error("Login response missing access_token");
    }

    accessToken = loginResponse.body.data.access_token;
  });

  afterAll(async () => {
    // 清理测试数据
    await prisma.user.deleteMany({
      where: { username: "t_resp_fmt_user" },
    });

    await prisma.group.deleteMany({
      where: { username: "t_resp_fmt_grp" },
    });
  });

  describe("成功响应格式验证", () => {
    /**
     * 验证成功响应的标准格式
     */
    const validateSuccessResponse = (response: any, options: { requireData?: boolean } = {}) => {
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("code");
      expect(response.body).toHaveProperty("message");
      expect(response.body.code).toBe(0);
      expect(typeof response.body.message).toBe("string");

      if (options.requireData !== false) expect(response.body).toHaveProperty("data");
    };

    it("POST /auth/login - 登录接口应返回标准格式", async () => {
      const requestBody = {
        username: "t_resp_fmt_user",
        password: "test_password",
        agreedToLegalPolicies: true,
      };

      const response = await postWithReplay("/v1/auth/login", requestBody).send(requestBody);

      validateSuccessResponse(response, { requireData: true });
      expect(response.body.data).toHaveProperty("access_token");
      expect(response.body.data).not.toHaveProperty("refresh_token");
      expect(response.headers["set-cookie"]).toBeTruthy();
      expect(response.body.data).toHaveProperty("user");
    });

    it("POST /auth/verify - 验证令牌接口应返回标准格式", async () => {
      const requestBody = {
        access_token: accessToken,
      };

      const response = await postWithReplay("/v1/auth/verify", requestBody).send(requestBody);

      validateSuccessResponse(response, { requireData: true });
      expect(response.body.data).toHaveProperty("userId");
    });

    it("GET /users/me - 获取当前用户接口应返回标准格式", async () => {
      const response = await request(app).get("/v1/users/me").set("Authorization", `Bearer ${accessToken}`);

      validateSuccessResponse(response, { requireData: true });
      expect(response.body.data).toHaveProperty("id");
      expect(response.body.data).toHaveProperty("username");
    });

    it("GET /users - 获取所有用户接口应返回标准格式", async () => {
      const response = await request(app).get("/v1/users").set("Authorization", `Bearer ${accessToken}`);

      validateSuccessResponse(response, { requireData: true });
      expect(response.body.data).toHaveProperty("users");
      expect(response.body.data).toHaveProperty("total");
    });

    it("GET /users/:userId - 通过ID获取用户接口应返回标准格式", async () => {
      const response = await request(app).get(`/v1/users/${testUser.id}`).set("Authorization", `Bearer ${accessToken}`);

      validateSuccessResponse(response, { requireData: true });
      expect(response.body.data).toHaveProperty("id");
      expect(response.body.data).toHaveProperty("username");
    });

    it("PATCH /users/:userId/password - 修改密码接口应返回标准格式", async () => {
      const requestBody = {
        newPassword: "new_test_password",
      };

      const response = await patchWithReplay(`/v1/users/${testUser.id}/password`, requestBody)
        .set("Authorization", `Bearer ${accessToken}`)
        .send(requestBody);

      validateSuccessResponse(response);

      // 恢复原密码
      await prisma.user.update({
        where: { id: testUser.id },
        data: { password: hashPassword("test_password") },
      });

      // 修改密码后 token 会失效，需要重新登录
      const loginBody = {
        username: "t_resp_fmt_user",
        password: "test_password",
        agreedToLegalPolicies: true,
      };
      const loginResponse = await postWithReplay("/v1/auth/login", loginBody).send(loginBody);
      accessToken = loginResponse.body.data.access_token;
    });

    it("GET /permissions/all - 获取所有权限接口应返回标准格式", async () => {
      const response = await request(app).get("/v1/permissions/all").set("Authorization", `Bearer ${accessToken}`);

      validateSuccessResponse(response, { requireData: true });
      expect(response.body.data).toHaveProperty("permissions");
    });

    it("GET /permissions/user/:userId - 获取用户权限接口应返回标准格式", async () => {
      const response = await request(app)
        .get(`/v1/permissions/user/${testUser.id}`)
        .set("Authorization", `Bearer ${accessToken}`);

      validateSuccessResponse(response, { requireData: true });
    });

    it("GET /permissions/group/:groupId - 获取组权限接口应返回标准格式", async () => {
      const response = await request(app)
        .get(`/v1/permissions/group/${testGroup.id}`)
        .set("Authorization", `Bearer ${accessToken}`);

      validateSuccessResponse(response, { requireData: true });
      expect(response.body.data).toHaveProperty("permissions");
    });
  });

  describe("错误响应格式验证", () => {
    /**
     * 验证错误响应的标准格式
     */
    const validateErrorResponse = (response: any) => {
      expect(response.body).toHaveProperty("code");
      expect(response.body).toHaveProperty("message");
      expect(response.body.code).not.toBe(0);
      expect(typeof response.body.message).toBe("string");
    };

    it("401 错误应返回标准错误格式", async () => {
      const response = await request(app).get("/v1/users/me").set("Authorization", "Bearer invalid_token");

      expect(response.status).toBe(401);
      validateErrorResponse(response);
    });

    it("403 错误应返回标准错误格式", async () => {
      // 创建一个无权限的用户
      const noPermGroup = await prisma.group.create({
        data: {
          username: "test_no_perm_group",
          name: "无权限组",
          level: 99,
          permissions: JSON.stringify([]),
        },
      });

      const noPermUser = await prisma.user.create({
        data: {
          username: "test_no_perm_user",
          password: hashPassword("password"),
          groupId: noPermGroup.id,
          permissionAdds: [],
          permissionRemoves: [],
        },
      });

      const loginBody = {
        username: "test_no_perm_user",
        password: "password",
        agreedToLegalPolicies: true,
      };

      const loginResponse = await postWithReplay("/v1/auth/login", loginBody).send(loginBody);

      const noPermToken = loginResponse.body.data.access_token;

      const response = await request(app).get("/v1/users").set("Authorization", `Bearer ${noPermToken}`);

      expect(response.status).toBe(403);
      validateErrorResponse(response);

      // 清理
      await prisma.user.deleteMany({ where: { id: noPermUser.id } });
      await prisma.group.deleteMany({ where: { id: noPermGroup.id } });
    });

    it("404 错误应返回标准错误格式", async () => {
      const response = await request(app)
        .get("/v1/users/non-existent-user-id")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(404);
      validateErrorResponse(response);
    });

    it("422 验证错误应返回标准错误格式", async () => {
      const requestBody = {
        username: "test_user",
        // 缺少 password 字段
        agreedToLegalPolicies: true,
      };

      const response = await postWithReplay("/v1/auth/login", requestBody).send(requestBody);

      expect(response.status).toBe(422);
      validateErrorResponse(response);
      // 验证错误可能包含 fields 字段
      if (response.body.fields) expect(typeof response.body.fields).toBe("object");
    });
  });

  describe("特殊接口格式验证", () => {
    it("GET /docs/openapi.json - OpenAPI 文档不应被包装", async () => {
      const response = await request(app).get("/docs/openapi.json").set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      let openApiDoc: Record<string, any> = {};

      if (response.body && Object.keys(response.body).length > 0) openApiDoc = response.body;
      else if (typeof response.text === "string" && response.text.trim().length > 0)
        try {
          openApiDoc = JSON.parse(response.text);
        } catch {
          openApiDoc = {};
        }

      // OpenAPI 文档应该是原始格式，不包含 code/message 包装
      expect(openApiDoc).toHaveProperty("openapi");
      expect(openApiDoc).toHaveProperty("info");
      expect(openApiDoc).toHaveProperty("paths");
      expect(openApiDoc).not.toHaveProperty("code");
      expect(openApiDoc).not.toHaveProperty("message");
    });
  });

  describe("响应格式一致性测试", () => {
    it("所有成功响应的 code 值应该为 0", async () => {
      const endpoints = [
        { path: "/v1/users/me", requireAuth: true },
        { path: "/v1/permissions/all", requireAuth: true },
      ];

      for (const endpoint of endpoints) {
        const req = request(app).get(endpoint.path);
        if (endpoint.requireAuth) req.set("Authorization", `Bearer ${accessToken}`);

        const response = await req;
        if (response.status === 200) expect(response.body.code).toBe(0);
      }
    });

    it("所有成功响应的 message 字段应该是字符串", async () => {
      const response = await request(app).get("/v1/users/me").set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(typeof response.body.message).toBe("string");
      expect(response.body.message.length).toBeGreaterThan(0);
    });
  });
});
