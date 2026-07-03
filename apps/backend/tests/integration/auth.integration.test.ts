import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/config/database";
import { hashPassword } from "../../src/util/crypto";
import { Express } from "express";
import { CustomCode } from "../../src/constant/custom-code";
import { withReplayProtection } from "../util/replay-protection-test-helper";
import { RedisService } from "../../src/services/infrastructure/redis.service";
import { EnvSpace } from "../../src/config/env";
import { ReplayProtectionClient } from "../../src/util/replay-protection-client";
import { buildReplaySigningSessionKey } from "../../src/util/replay-signing-session";
import { AUTH_REFRESH_COOKIE_NAME } from "../../src/util/auth-refresh-cookie";

describe("认证 API 集成测试", () => {
  let app: Express;
  let testUser: any;
  let testGroup: any;

  const postWithReplay = (path: string, body: Record<string, unknown>) =>
    withReplayProtection(request(app).post(path), body, path).send(body);

  const postWithReplayAndCookie = (path: string, body: Record<string, unknown>, cookie: string) =>
    withReplayProtection(request(app).post(path).set("Cookie", cookie), body, path).send(body);

  const getReplaySigningSession = async (fingerprint: string) =>
    request(app).get("/v1/auth/replay-signing-session").set("X-Client-Fingerprint", fingerprint);

  const extractRefreshCookie = (response: { headers: Record<string, unknown> }) => {
    const setCookie = response.headers["set-cookie"];
    const cookies = Array.isArray(setCookie) ? setCookie : [];
    const refreshCookie = cookies.find(
      (cookie): cookie is string => typeof cookie === "string" && cookie.startsWith(`${AUTH_REFRESH_COOKIE_NAME}=`),
    );

    expect(refreshCookie).toBeTruthy();
    return refreshCookie!.split(";")[0]!;
  };

  beforeAll(async () => {
    app = createApp();

    // 创建测试用户组
    testGroup = await prisma.group.create({
      data: {
        username: "t_auth_int_grp",
        name: "认证集成测试组",
        level: 5,
        permissions: JSON.stringify([]),
      },
    });

    // 创建测试用户
    testUser = await prisma.user.create({
      data: {
        username: "t_auth_int_user",
        password: hashPassword("test_password_123"),
        groupId: testGroup.id,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
  });

  afterAll(async () => {
    // 清理测试数据
    await prisma.user.deleteMany({
      where: { username: "t_auth_int_user" },
    });

    await prisma.group.deleteMany({
      where: { username: "t_auth_int_grp" },
    });
  });

  describe("POST /auth/login - 用户登录", () => {
    it("应该使用有效凭证成功登录", async () => {
      const response = await postWithReplay("/v1/auth/login", {
        username: "t_auth_int_user",
        password: "test_password_123",
        agreedToLegalPolicies: true,
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("code");
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("data");
      expect(response.body.code).toBe(0);
      expect(response.body.data).toHaveProperty("access_token");
      expect(response.body.data).not.toHaveProperty("refresh_token");
      expect(response.body.data).toHaveProperty("user");
      expect(response.body.data.user.username).toBe("t_auth_int_user");
      expect(response.body.data.user).not.toHaveProperty("password");
      expect(extractRefreshCookie(response)).toContain(`${AUTH_REFRESH_COOKIE_NAME}=`);
    });

    it("应该在无效用户名时返回 401", async () => {
      const response = await postWithReplay("/v1/auth/login", {
        username: "nonexistent_user",
        password: "password",
        agreedToLegalPolicies: true,
      });

      expect(response.status).toBe(401);
    });

    it("应该在无效密码时返回 401", async () => {
      const response = await postWithReplay("/v1/auth/login", {
        username: "t_auth_int_user",
        password: "wrong_password",
        agreedToLegalPolicies: true,
      });

      expect(response.status).toBe(401);
    });

    it("应该在缺少字段时返回 422", async () => {
      const response = await postWithReplay("/v1/auth/login", {
        username: "t_auth_int_user",
        // 缺少 password
        agreedToLegalPolicies: true,
      });

      expect(response.status).toBe(422);
    });

    it("应该在缺少所有字段时返回 422", async () => {
      const response = await postWithReplay("/v1/auth/login", {});

      expect(response.status).toBe(422);
    });

    it("应该按冷却周期返回 2FA 开启提醒", async () => {
      if (!EnvSpace.twoFactorConfig.reminderEnabled) return;

      const redisService = RedisService.getInstance();
      if (!redisService.isRedisAvailable()) return;

      await redisService.delete(`two_factor:reminder_cooldown:${testUser.id}`);

      const firstResponse = await postWithReplay("/v1/auth/login", {
        username: "t_auth_int_user",
        password: "test_password_123",
        agreedToLegalPolicies: true,
      });

      expect(firstResponse.status).toBe(200);
      expect(firstResponse.body.data.twoFactorReminder).toMatchObject({
        shouldSetupTwoFactor: true,
      });

      const secondResponse = await postWithReplay("/v1/auth/login", {
        username: "t_auth_int_user",
        password: "test_password_123",
        agreedToLegalPolicies: true,
      });

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.body.data.twoFactorReminder).toBeUndefined();
    });
  });

  describe("GET /auth/replay-signing-session - 防重放签名会话", () => {
    it("应该返回 HMAC-SHA256 签名会话", async () => {
      const redisService = RedisService.getInstance();
      if (!redisService.isRedisAvailable()) return;

      const fingerprint = "auth-integration-replay-fingerprint-0001";
      const response = await getReplaySigningSession(fingerprint);

      expect(response.status).toBe(200);
      expect(response.body.code).toBe(CustomCode.OK);
      expect(response.body.data).toMatchObject({
        algorithm: "HMAC-SHA256",
      });
      expect(typeof response.body.data.sessionId).toBe("string");
      expect(typeof response.body.data.signingKey).toBe("string");
      expect(response.body.data.signingKey.length).toBeGreaterThanOrEqual(64);
      expect(response.body.data.expiresIn).toBe(EnvSpace.replayProtectionConfig.signingSessionTtlSeconds);

      const storedSession = await redisService.get(buildReplaySigningSessionKey(response.body.data.sessionId));
      expect(storedSession).toBeTruthy();
      expect(JSON.parse(storedSession || "{}")).toMatchObject({
        fingerprint,
      });
    });

    it("应该在签名会话过期后拒绝受保护请求", async () => {
      const redisService = RedisService.getInstance();
      if (!redisService.isRedisAvailable()) return;

      const loginResponse = await postWithReplay("/v1/auth/login", {
        username: "t_auth_int_user",
        password: "test_password_123",
        agreedToLegalPolicies: true,
      });
      const accessToken = loginResponse.body.data.access_token;

      const fingerprint = "auth-integration-replay-fingerprint-0002";
      const sessionResponse = await getReplaySigningSession(fingerprint);
      expect(sessionResponse.status).toBe(200);

      const material = sessionResponse.body.data;
      await redisService.delete(buildReplaySigningSessionKey(material.sessionId));

      const verifyBody = { access_token: accessToken };
      const headers = ReplayProtectionClient.generateHeaders(verifyBody, "/v1/auth/verify", material);

      const response = await request(app)
        .post("/v1/auth/verify")
        .set("X-Client-Fingerprint", fingerprint)
        .set(headers)
        .send(verifyBody);

      expect(response.status).toBe(401);
      expect(response.body.code).toBe(CustomCode.REPLAY_PROTECTION_FAILED);
      expect(response.body.message).toContain("Signing session expired");
    });

    it("应该在客户端指纹不匹配时拒绝受保护请求", async () => {
      const redisService = RedisService.getInstance();
      if (!redisService.isRedisAvailable()) return;

      const loginResponse = await postWithReplay("/v1/auth/login", {
        username: "t_auth_int_user",
        password: "test_password_123",
        agreedToLegalPolicies: true,
      });
      const accessToken = loginResponse.body.data.access_token;

      const fingerprint = "auth-integration-replay-fingerprint-0003";
      const sessionResponse = await getReplaySigningSession(fingerprint);
      expect(sessionResponse.status).toBe(200);

      const material = sessionResponse.body.data;
      const verifyBody = { access_token: accessToken };
      const headers = ReplayProtectionClient.generateHeaders(verifyBody, "/v1/auth/verify", material);

      const response = await request(app)
        .post("/v1/auth/verify")
        .set("X-Client-Fingerprint", "auth-integration-replay-fingerprint-mismatch-9999")
        .set(headers)
        .send(verifyBody);

      expect(response.status).toBe(401);
      expect(response.body.code).toBe(CustomCode.REPLAY_PROTECTION_FAILED);
      expect(response.body.message).toContain("Signing session validation failed");
    });
  });

  describe("POST /auth/refresh - 刷新访问令牌", () => {
    let validRefreshCookie: string;

    beforeAll(async () => {
      // 获取有效的刷新 Cookie
      const loginResponse = await postWithReplay("/v1/auth/login", {
        username: "t_auth_int_user",
        password: "test_password_123",
        agreedToLegalPolicies: true,
      });

      validRefreshCookie = extractRefreshCookie(loginResponse);
    });

    it("应该使用有效的刷新令牌生成新的访问令牌", async () => {
      const response = await postWithReplayAndCookie("/v1/auth/refresh", {}, validRefreshCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("code");
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("data");
      expect(response.body.code).toBe(0);
      expect(response.body.data).toHaveProperty("access_token");
      expect(typeof response.body.data.access_token).toBe("string");
    });

    it("应该允许仅依赖 Cookie 且不发送请求体进行刷新", async () => {
      const response = await withReplayProtection(
        request(app).post("/v1/auth/refresh").set("Cookie", validRefreshCookie),
        undefined,
        "/v1/auth/refresh",
      ).expect(200);

      expect(response.body.code).toBe(0);
      expect(typeof response.body.data.access_token).toBe("string");
    });

    it("应该在存在有效 Cookie 时优先忽略请求体中的无效刷新令牌", async () => {
      const response = await postWithReplayAndCookie(
        "/v1/auth/refresh",
        { refresh_token: "invalid_token" },
        validRefreshCookie,
      );

      expect(response.status).toBe(200);
      expect(typeof response.body.data.access_token).toBe("string");
    });

    it("应该在无效的刷新令牌时返回 401", async () => {
      const response = await postWithReplay("/v1/auth/refresh", {
        refresh_token: "invalid_token",
      });

      expect(response.status).toBe(401);
    });

    it("应该在缺少刷新令牌时返回 401", async () => {
      const response = await postWithReplay("/v1/auth/refresh", {});

      expect(response.status).toBe(401);
    });

    it("应该在用户密码更新后拒绝旧的刷新令牌", async () => {
      // 获取新的刷新 Cookie
      const loginResponse = await postWithReplay("/v1/auth/login", {
        username: "t_auth_int_user",
        password: "test_password_123",
        agreedToLegalPolicies: true,
      });

      const oldRefreshCookie = extractRefreshCookie(loginResponse);

      // 更新用户密码
      await prisma.user.update({
        where: { id: testUser.id },
        data: { password: hashPassword("new_password") },
      });

      // 旧的刷新令牌应该被拒绝
      const response = await postWithReplayAndCookie("/v1/auth/refresh", {}, oldRefreshCookie);

      expect(response.status).toBe(401);

      // 恢复原密码
      await prisma.user.update({
        where: { id: testUser.id },
        data: { password: hashPassword("test_password_123") },
      });
    });
  });

  describe("POST /auth/verify - 验证访问令牌", () => {
    let validAccessToken: string;

    beforeAll(async () => {
      // 获取有效的访问令牌
      const loginResponse = await postWithReplay("/v1/auth/login", {
        username: "t_auth_int_user",
        password: "test_password_123",
        agreedToLegalPolicies: true,
      });

      validAccessToken = loginResponse.body.data.access_token;
    });

    it("应该成功验证有效的访问令牌", async () => {
      const response = await postWithReplay("/v1/auth/verify", {
        access_token: validAccessToken,
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("code");
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("data");
      expect(response.body.code).toBe(0);
      expect(response.body.data).toHaveProperty("userId");
      expect(response.body.data.userId).toBe(testUser.id);
    });

    it("应该在无效的访问令牌时返回 401", async () => {
      const response = await postWithReplay("/v1/auth/verify", {
        access_token: "invalid_token",
      });

      expect(response.status).toBe(401);
    });

    it("应该在缺少访问令牌时返回 422", async () => {
      const response = await postWithReplay("/v1/auth/verify", {});

      expect(response.status).toBe(422);
    });
  });

  describe("POST /auth/logout - 用户登出", () => {
    it("应该在未显式传 access_token 时撤销 Authorization 中的访问令牌和 Cookie 中的刷新令牌", async () => {
      const loginResponse = await postWithReplay("/v1/auth/login", {
        username: "t_auth_int_user",
        password: "test_password_123",
        agreedToLegalPolicies: true,
      });

      const accessToken = loginResponse.body.data.access_token as string;
      const refreshCookie = extractRefreshCookie(loginResponse);

      const logoutResponse = await withReplayProtection(
        request(app).post("/v1/auth/logout").set("Authorization", `Bearer ${accessToken}`).set("Cookie", refreshCookie),
        { refresh_token: "invalid_token" },
        "/v1/auth/logout",
      )
        .send({ refresh_token: "invalid_token" })
        .expect(200);

      expect(logoutResponse.body.code).toBe(0);

      const verifyResponse = await postWithReplay("/v1/auth/verify", {
        access_token: accessToken,
      });
      expect(verifyResponse.status).toBe(401);

      const refreshResponse = await postWithReplayAndCookie("/v1/auth/refresh", {}, refreshCookie);
      expect(refreshResponse.status).toBe(401);
    });
  });

  describe("完整认证流程集成测试", () => {
    it("应该完成 登录 -> 验证 -> 刷新 -> 再次验证 的完整流程", async () => {
      // 1. 登录
      const loginResponse = await postWithReplay("/v1/auth/login", {
        username: "t_auth_int_user",
        password: "test_password_123",
        agreedToLegalPolicies: true,
      });

      expect(loginResponse.status).toBe(200);
      const { access_token } = loginResponse.body.data;
      const refreshCookie = extractRefreshCookie(loginResponse);

      // 2. 验证访问令牌
      const verifyResponse1 = await postWithReplay("/v1/auth/verify", {
        access_token,
      });

      expect(verifyResponse1.status).toBe(200);
      expect(verifyResponse1.body.data.userId).toBe(testUser.id);

      // 3. 刷新令牌
      const refreshResponse = await postWithReplayAndCookie("/v1/auth/refresh", {}, refreshCookie);

      expect(refreshResponse.status).toBe(200);
      const newAccessToken = refreshResponse.body.data.access_token;
      expect(newAccessToken).not.toBe(access_token);

      // 4. 验证新的访问令牌
      const verifyResponse2 = await postWithReplay("/v1/auth/verify", {
        access_token: newAccessToken,
      });

      expect(verifyResponse2.status).toBe(200);
      expect(verifyResponse2.body.data.userId).toBe(testUser.id);
    });

    it("应该在密码修改后使旧令牌失效", async () => {
      // 登录获取令牌
      const loginResponse = await postWithReplay("/v1/auth/login", {
        username: "t_auth_int_user",
        password: "test_password_123",
        agreedToLegalPolicies: true,
      });

      const { access_token } = loginResponse.body.data;
      const refreshCookie = extractRefreshCookie(loginResponse);

      // 验证令牌有效
      const verifyResponse1 = await postWithReplay("/v1/auth/verify", {
        access_token,
      });
      expect(verifyResponse1.status).toBe(200);

      // 修改密码
      await prisma.user.update({
        where: { id: testUser.id },
        data: { password: hashPassword("new_changed_password") },
      });

      // 旧的访问令牌应该失效
      const verifyResponse2 = await postWithReplay("/v1/auth/verify", {
        access_token,
      });
      expect(verifyResponse2.status).toBe(401);

      // 旧的刷新令牌也应该失效
      const refreshResponse = await postWithReplayAndCookie("/v1/auth/refresh", {}, refreshCookie);
      expect(refreshResponse.status).toBe(401);

      // 恢复原密码
      await prisma.user.update({
        where: { id: testUser.id },
        data: { password: hashPassword("test_password_123") },
      });
    });
  });
});
