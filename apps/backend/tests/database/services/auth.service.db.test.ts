import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { AuthService } from "../../../src/services/auth/auth.service";
import { prisma } from "../../../src/config/database";
import { hashPassword } from "../../../src/util/crypto";
import { UnauthorizedError } from "../../../src/util/errors";
import { JWTAccessIns, JWTRefreshIns } from "../../../src/util/auth";
import { RedisService } from "../../../src/services/infrastructure/redis.service";
import type { Request, Response } from "express";

const redisService = RedisService.getInstance();

const requireTokenAuthData = (
  value: Awaited<ReturnType<AuthService["login"]>>,
): { access_token: string; refresh_token: string; user: { username: string } } => {
  if ("requiresTwoFactor" in value) throw new Error("Unexpected two-factor challenge response in unit test");
  return value as unknown as { access_token: string; refresh_token: string; user: { username: string } };
};

describe("认证服务测试", () => {
  const authService = new AuthService();
  let testUser: any;
  let testGroup: any;

  beforeAll(async () => {
    // 创建测试用户组
    testGroup = await prisma.group.create({
      data: {
        username: "test_auth_group",
        name: "测试认证组",
        level: 5,
        permissions: JSON.stringify([]),
      },
    });

    // 创建测试用户
    testUser = await prisma.user.create({
      data: {
        username: "test_auth_user",
        password: hashPassword("test_password_123"),
        groupId: testGroup.id,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
  });

  beforeEach(async () => {
    // 清除登录频率限制的 Redis 计数器
    if (redisService.isRedisAvailable())
      await Promise.all([
        redisService.delete("rate:login:ip:127.0.0.1"),
        redisService.delete("rate:login:user:test_auth_user"),
      ]);
  });

  afterAll(async () => {
    // 清理测试数据
    await prisma.user.deleteMany({
      where: {
        username: "test_auth_user",
      },
    });

    await prisma.group.deleteMany({
      where: {
        username: "test_auth_group",
      },
    });
  });

  describe("login() - 用户登录", () => {
    it("应该使用有效凭证成功登录", async () => {
      const result = requireTokenAuthData(await authService.login("test_auth_user", "test_password_123"));

      expect(result).toHaveProperty("access_token");
      expect(result).toHaveProperty("refresh_token");
      expect(result).toHaveProperty("user");
      expect(result.user.username).toBe("test_auth_user");
      expect(result.user).not.toHaveProperty("password");
    });

    it("应该在用户名不存在时抛出 UnauthorizedError", async () => {
      await expect(authService.login("nonexistent_user", "password")).rejects.toThrow(UnauthorizedError);
    });

    it("应该在密码错误时抛出 UnauthorizedError", async () => {
      await expect(authService.login("test_auth_user", "wrong_password")).rejects.toThrow(UnauthorizedError);
    });

    it("生成的访问令牌应该包含 userId 和 updatedAt", async () => {
      const result = requireTokenAuthData(await authService.login("test_auth_user", "test_password_123"));
      const payload = await JWTAccessIns.verifyToken(result.access_token);

      expect(payload).toHaveProperty("userId");
      expect(payload).toHaveProperty("updatedAt");
      expect(payload!.userId).toBe(testUser.id);
    });

    it("生成的刷新令牌应该包含 userId 和 updatedAt", async () => {
      const result = requireTokenAuthData(await authService.login("test_auth_user", "test_password_123"));
      const payload = await JWTRefreshIns.verifyToken(result.refresh_token);

      expect(payload).toHaveProperty("userId");
      expect(payload).toHaveProperty("updatedAt");
      expect(payload!.userId).toBe(testUser.id);
    });
  });

  describe("refresh() - 刷新访问令牌", () => {
    it("应该使用有效的刷新令牌生成新的访问令牌", async () => {
      const loginResult = requireTokenAuthData(await authService.login("test_auth_user", "test_password_123"));
      const refreshResult = await authService.refresh(loginResult.refresh_token);

      expect(refreshResult).toHaveProperty("access_token");
      expect(refreshResult.access_token).not.toBe(loginResult.access_token);
    });

    it("应该在刷新令牌无效时抛出 UnauthorizedError", async () => {
      await expect(authService.refresh("invalid_token")).rejects.toThrow(UnauthorizedError);
    });

    it("应该在用户不存在时抛出 UnauthorizedError", async () => {
      // 创建一个包含不存在用户ID的令牌
      const fakeToken = JWTRefreshIns.generateToken({
        userId: "non-existent-user-id",
        updatedAt: new Date().toISOString(),
      });

      await expect(authService.refresh(fakeToken)).rejects.toThrow(UnauthorizedError);
    });

    it("应该在用户信息更新后拒绝旧的刷新令牌", async () => {
      const loginResult = requireTokenAuthData(await authService.login("test_auth_user", "test_password_123"));

      // 模拟用户信息更新（修改密码）
      await prisma.user.update({
        where: { id: testUser.id },
        data: { password: hashPassword("new_password") },
      });

      // 旧的刷新令牌应该被拒绝
      await expect(authService.refresh(loginResult.refresh_token)).rejects.toThrow(UnauthorizedError);

      // 恢复原密码以便后续测试
      await prisma.user.update({
        where: { id: testUser.id },
        data: { password: hashPassword("test_password_123") },
      });
    });

    it("应该在令牌缺少 updatedAt 字段时抛出错误", async () => {
      // 创建一个旧版本的令牌（没有 updatedAt）
      const oldToken = JWTRefreshIns.generateToken({ userId: testUser.id } as any);

      await expect(authService.refresh(oldToken)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe("verify() - 验证访问令牌", () => {
    it("应该成功验证有效的访问令牌", async () => {
      const loginResult = requireTokenAuthData(await authService.login("test_auth_user", "test_password_123"));
      const verifyResult = await authService.verify(loginResult.access_token);

      expect(verifyResult).toHaveProperty("userId");
      expect(verifyResult.userId).toBe(testUser.id);
    });

    it("应该在访问令牌无效时抛出 UnauthorizedError", async () => {
      await expect(authService.verify("invalid_access_token")).rejects.toThrow(UnauthorizedError);
    });

    it("应该在用户不存在时抛出 UnauthorizedError", async () => {
      const fakeToken = JWTAccessIns.generateToken({
        userId: "non-existent-user-id",
        updatedAt: new Date().toISOString(),
      });

      await expect(authService.verify(fakeToken)).rejects.toThrow(UnauthorizedError);
    });

    it("应该在用户信息更新后拒绝旧的访问令牌", async () => {
      const loginResult = requireTokenAuthData(await authService.login("test_auth_user", "test_password_123"));

      // 模拟用户信息更新（修改密码）
      await prisma.user.update({
        where: { id: testUser.id },
        data: { password: hashPassword("another_new_password") },
      });

      // 旧的访问令牌应该被拒绝
      await expect(authService.verify(loginResult.access_token)).rejects.toThrow(UnauthorizedError);

      // 恢复原密码
      await prisma.user.update({
        where: { id: testUser.id },
        data: { password: hashPassword("test_password_123") },
      });
    });

    it("应该在令牌缺少 updatedAt 字段时抛出错误", async () => {
      const oldToken = JWTAccessIns.generateToken({ userId: testUser.id } as any);

      await expect(authService.verify(oldToken)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe("完整认证流程", () => {
    it("应该完成 登录 -> 验证 -> 刷新 -> 再次验证 的完整流程", async () => {
      // 1. 登录
      const loginResult = requireTokenAuthData(await authService.login("test_auth_user", "test_password_123"));
      expect(loginResult.access_token).toBeTruthy();
      expect(loginResult.refresh_token).toBeTruthy();

      // 2. 验证访问令牌
      const verifyResult = await authService.verify(loginResult.access_token);
      expect(verifyResult.userId).toBe(testUser.id);

      // 3. 刷新令牌
      const refreshResult = await authService.refresh(loginResult.refresh_token);
      expect(refreshResult.access_token).toBeTruthy();
      expect(refreshResult.access_token).not.toBe(loginResult.access_token);

      // 4. 验证新的访问令牌
      const newVerifyResult = await authService.verify(refreshResult.access_token);
      expect(newVerifyResult.userId).toBe(testUser.id);
    });
  });

  describe("已发送响应头场景", () => {
    it("应该在 headersSent=true 时避免写入 cookie 并回退返回 refresh_token", async () => {
      const cookieSpy = vi.fn();
      const clearCookieSpy = vi.fn();

      const request = {
        ip: "127.0.0.1",
        headers: {
          "user-agent": "vitest",
        },
        res: {
          headersSent: true,
          writableEnded: false,
          cookie: cookieSpy,
          clearCookie: clearCookieSpy,
        } as unknown as Response,
      } as unknown as Request;

      const result = await authService.login("test_auth_user", "test_password_123", request);
      const authData = requireTokenAuthData(result);

      expect(authData.refresh_token).toBeTruthy();
      expect(cookieSpy).not.toHaveBeenCalled();
      expect(clearCookieSpy).not.toHaveBeenCalled();
    });
  });
});
