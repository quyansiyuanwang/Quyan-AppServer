import { describe, it, expect } from "vitest";
import { JWTAccessIns, JWTRefreshIns, JWTPayload } from "../../../src/util/auth";
import { hashPassword, isLegacyPasswordHash, verifyPassword } from "../../../src/util/crypto";
import {
  ApiError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  InternalServerError,
} from "../../../src/util/errors";
import { assert, assertExists, assertTruthy } from "../../../src/util/assert";
import { isValidPermission, validatePermissions } from "../../../src/util/permission/validation";
import { Permission } from "../../../src/constant/permission";
import { HttpStatusCode } from "axios";

describe("工具函数测试", () => {
  describe("JWTUtil - JWT 令牌工具", () => {
    describe("访问令牌 (JWTAccessIns)", () => {
      it("应该成功生成访问令牌", () => {
        const payload: JWTPayload = {
          userId: "test_user_id",
          updatedAt: new Date().toISOString(),
        };

        const token = JWTAccessIns.generateToken(payload);

        expect(token).toBeTruthy();
        expect(typeof token).toBe("string");
      });

      it("应该成功验证有效的访问令牌", async () => {
        const payload: JWTPayload = {
          userId: "test_user_id",
          updatedAt: new Date().toISOString(),
        };

        const token = JWTAccessIns.generateToken(payload);
        const decoded = await JWTAccessIns.verifyToken(token);

        expect(decoded).toBeTruthy();
        expect(decoded!.userId).toBe(payload.userId);
        expect(decoded!.updatedAt).toBe(payload.updatedAt);
      });

      it("应该在验证无效令牌时抛出错误", async () => {
        await expect(async () => {
          await JWTAccessIns.verifyToken("invalid_token");
        }).rejects.toThrow();
      });

      it("应该在令牌中包含自定义字段", async () => {
        const payload: JWTPayload = {
          userId: "test_user_id",
          updatedAt: new Date().toISOString(),
          customField: "custom_value",
        };

        const token = JWTAccessIns.generateToken(payload);
        const decoded = await JWTAccessIns.verifyToken(token);

        expect(decoded!.customField).toBe("custom_value");
      });
    });

    describe("刷新令牌 (JWTRefreshIns)", () => {
      it("应该成功生成刷新令牌", () => {
        const payload: JWTPayload = {
          userId: "test_user_id",
          updatedAt: new Date().toISOString(),
        };

        const token = JWTRefreshIns.generateToken(payload);

        expect(token).toBeTruthy();
        expect(typeof token).toBe("string");
      });

      it("应该成功验证有效的刷新令牌", async () => {
        const payload: JWTPayload = {
          userId: "test_user_id",
          updatedAt: new Date().toISOString(),
        };

        const token = JWTRefreshIns.generateToken(payload);
        const decoded = await JWTRefreshIns.verifyToken(token);

        expect(decoded).toBeTruthy();
        expect(decoded!.userId).toBe(payload.userId);
      });

      it("访问令牌和刷新令牌应该使用不同的密钥", async () => {
        const payload: JWTPayload = {
          userId: "test_user_id",
          updatedAt: new Date().toISOString(),
        };

        const accessToken = JWTAccessIns.generateToken(payload);
        const refreshToken = JWTRefreshIns.generateToken(payload);

        // 不同的令牌应该不相同
        expect(accessToken).not.toBe(refreshToken);

        // 刷新令牌不应该能被访问令牌验证器验证
        await expect(JWTAccessIns.verifyToken(refreshToken)).rejects.toThrow();
      });
    });
  });

  describe("hashPassword() - 密码哈希", () => {
    it("应该成功生成密码哈希", () => {
      const password = "test_password_123";
      const hash = hashPassword(password);

      expect(hash).toBeTruthy();
      expect(typeof hash).toBe("string");
      expect(hash.length).toBeGreaterThan(0);
    });

    it("相同的密码应该生成不同的随机哈希", () => {
      const password = "same_password";
      const hash1 = hashPassword(password);
      const hash2 = hashPassword(password);

      expect(hash1).not.toBe(hash2);
      expect(verifyPassword(password, hash1)).toBe(true);
      expect(verifyPassword(password, hash2)).toBe(true);
    });

    it("不同的密码应该生成不同的哈希", () => {
      const password1 = "password_1";
      const password2 = "password_2";

      const hash1 = hashPassword(password1);
      const hash2 = hashPassword(password2);

      expect(hash1).not.toBe(hash2);
    });

    it("应该处理空字符串", () => {
      const hash = hashPassword("");
      expect(hash).toBeTruthy();
    });

    it("应该处理包含特殊字符的密码", () => {
      const password = "p@ssw0rd!#$%^&*()";
      const hash = hashPassword(password);

      expect(hash).toBeTruthy();
      expect(typeof hash).toBe("string");
    });

    it("应该兼容旧 MD5 哈希并识别为待迁移密码", () => {
      const legacyHash = "5f4dcc3b5aa765d61d8327deb882cf99";

      expect(isLegacyPasswordHash(legacyHash)).toBe(true);
      expect(verifyPassword("password", legacyHash)).toBe(true);
      expect(verifyPassword("wrong-password", legacyHash)).toBe(false);
    });
  });

  describe("错误类测试", () => {
    describe("ApiError - 基础 API 错误", () => {
      it("应该创建基础 API 错误", () => {
        const error = new ApiError("Test error", 500, 1000);

        expect(error.message).toBe("Test error");
        expect(error.statusCode).toBe(500);
        expect(error.code).toBe(1000);
        expect(error.isOperational).toBe(true);
      });

      it("应该使用默认值", () => {
        const error = new ApiError("Test error");

        expect(error.statusCode).toBe(HttpStatusCode.InternalServerError);
        expect(error.isOperational).toBe(true);
      });

      it("应该是 Error 的实例", () => {
        const error = new ApiError("Test error");

        expect(error instanceof Error).toBe(true);
        expect(error instanceof ApiError).toBe(true);
      });
    });

    describe("BadRequestError - 400 错误", () => {
      it("应该创建 400 错误", () => {
        const error = new BadRequestError("Invalid input");

        expect(error.message).toBe("Invalid input");
        expect(error.statusCode).toBe(HttpStatusCode.BadRequest);
        expect(error instanceof BadRequestError).toBe(true);
        expect(error instanceof ApiError).toBe(true);
      });

      it("应该使用默认消息", () => {
        const error = new BadRequestError();

        expect(error.message).toBe("Bad Request");
        expect(error.statusCode).toBe(HttpStatusCode.BadRequest);
      });
    });

    describe("UnauthorizedError - 401 错误", () => {
      it("应该创建 401 错误", () => {
        const error = new UnauthorizedError("Invalid credentials");

        expect(error.message).toBe("Invalid credentials");
        expect(error.statusCode).toBe(HttpStatusCode.Unauthorized);
        expect(error instanceof UnauthorizedError).toBe(true);
      });

      it("应该使用默认消息", () => {
        const error = new UnauthorizedError();

        expect(error.message).toBe("Unauthorized");
      });
    });

    describe("ForbiddenError - 403 错误", () => {
      it("应该创建 403 错误", () => {
        const error = new ForbiddenError("Access denied");

        expect(error.message).toBe("Access denied");
        expect(error.statusCode).toBe(HttpStatusCode.Forbidden);
        expect(error instanceof ForbiddenError).toBe(true);
      });
    });

    describe("NotFoundError - 404 错误", () => {
      it("应该创建 404 错误", () => {
        const error = new NotFoundError("User not found");

        expect(error.message).toBe("User not found");
        expect(error.statusCode).toBe(HttpStatusCode.NotFound);
        expect(error instanceof NotFoundError).toBe(true);
      });
    });

    describe("ConflictError - 409 错误", () => {
      it("应该创建 409 错误", () => {
        const error = new ConflictError("Resource conflict");

        expect(error.message).toBe("Resource conflict");
        expect(error.statusCode).toBe(HttpStatusCode.Conflict);
        expect(error instanceof ConflictError).toBe(true);
      });
    });

    describe("ValidationError - 422 错误", () => {
      it("应该创建验证错误", () => {
        const fields = {
          username: ["Username is required"],
          email: ["Invalid email format"],
        };
        const error = new ValidationError("Validation failed", fields);

        expect(error.message).toBe("Validation failed");
        expect(error.statusCode).toBe(HttpStatusCode.UnprocessableEntity);
        expect(error.fields).toEqual(fields);
        expect(error instanceof ValidationError).toBe(true);
      });

      it("应该处理没有字段的验证错误", () => {
        const error = new ValidationError("Validation failed");

        expect(error.message).toBe("Validation failed");
        expect(error.fields).toBeUndefined();
      });
    });

    describe("InternalServerError - 500 错误", () => {
      it("应该创建 500 错误", () => {
        const error = new InternalServerError("Server crash");

        expect(error.message).toBe("Server crash");
        expect(error.statusCode).toBe(HttpStatusCode.InternalServerError);
        expect(error.isOperational).toBe(false); // 服务器错误不是操作性的
        expect(error instanceof InternalServerError).toBe(true);
      });
    });
  });

  describe("断言工具测试", () => {
    describe("assert() - 条件断言", () => {
      it("应该在条件为真时不抛出错误", () => {
        expect(() => {
          assert(true, "Should not throw");
        }).not.toThrow();

        expect(() => {
          assert(1 === 1, "Should not throw");
        }).not.toThrow();
      });

      it("应该在条件为假时抛出字符串错误", () => {
        expect(() => {
          assert(false, "Condition failed");
        }).toThrow("Condition failed");
      });

      it("应该在条件为假时抛出自定义错误", () => {
        const customError = new BadRequestError("Custom error");

        expect(() => {
          assert(false, customError);
        }).toThrow(BadRequestError);
      });

      it("应该处理 falsy 值", () => {
        expect(() => assert(0, "Zero is falsy")).toThrow();
        expect(() => assert("", "Empty string is falsy")).toThrow();
        expect(() => assert(null, "Null is falsy")).toThrow();
        expect(() => assert(undefined, "Undefined is falsy")).toThrow();
      });
    });

    describe("assertExists() - 存在性断言", () => {
      it("应该在值存在时不抛出错误", () => {
        expect(() => {
          assertExists("value", "Should not throw");
        }).not.toThrow();

        expect(() => {
          assertExists(0, "Zero exists");
        }).not.toThrow();

        expect(() => {
          assertExists(false, "False exists");
        }).not.toThrow();
      });

      it("应该在值为 null 时抛出错误", () => {
        expect(() => {
          assertExists(null, "Value is null");
        }).toThrow("Value is null");
      });

      it("应该在值为 undefined 时抛出错误", () => {
        expect(() => {
          assertExists(undefined, "Value is undefined");
        }).toThrow("Value is undefined");
      });

      it("应该抛出自定义错误", () => {
        const customError = new NotFoundError("Resource not found");

        expect(() => {
          assertExists(null, customError);
        }).toThrow(NotFoundError);
      });
    });

    describe("assertTruthy() - 真值断言", () => {
      it("应该在值为真时不抛出错误", () => {
        expect(() => {
          assertTruthy("value", "Should not throw");
        }).not.toThrow();

        expect(() => {
          assertTruthy(1, "Should not throw");
        }).not.toThrow();

        expect(() => {
          assertTruthy(true, "Should not throw");
        }).not.toThrow();
      });

      it("应该在值为 false 时抛出错误", () => {
        expect(() => {
          assertTruthy(false, "Value is false");
        }).toThrow("Value is false");
      });

      it("应该在值为 0 时抛出错误", () => {
        expect(() => {
          assertTruthy(0, "Value is 0");
        }).toThrow("Value is 0");
      });

      it("应该在值为空字符串时抛出错误", () => {
        expect(() => {
          assertTruthy("", "Value is empty string");
        }).toThrow("Value is empty string");
      });

      it("应该在值为 null 或 undefined 时抛出错误", () => {
        expect(() => assertTruthy(null, "Null")).toThrow();
        expect(() => assertTruthy(undefined, "Undefined")).toThrow();
      });
    });
  });

  describe("权限验证工具测试", () => {
    describe("isValidPermission() - 权限有效性检查", () => {
      it("应该验证有效的权限", () => {
        expect(isValidPermission(Permission.USER_READ)).toBe(true);
        expect(isValidPermission(Permission.PERMISSION_VIEW)).toBe(true);
        expect(isValidPermission(Permission.DEBUG_OPENAPI_READ)).toBe(true);
      });

      it("应该拒绝无效的权限", () => {
        expect(isValidPermission("INVALID_PERMISSION")).toBe(false);
        expect(isValidPermission("")).toBe(false);
        expect(isValidPermission("random_string")).toBe(false);
      });
    });

    describe("validatePermissions() - 权限列表验证", () => {
      it("应该验证有效的权限列表", () => {
        const permissions = [Permission.USER_READ, Permission.PERMISSION_VIEW];
        const result = validatePermissions(permissions);

        expect(result).toEqual(permissions);
      });

      it("应该在包含无效权限时抛出错误", () => {
        expect(() => {
          validatePermissions(["INVALID_PERMISSION"]);
        }).toThrow("无效的权限");
      });

      it("应该在混合有效和无效权限时抛出错误", () => {
        expect(() => {
          validatePermissions([Permission.USER_READ, "INVALID", Permission.PERMISSION_VIEW]);
        }).toThrow("无效的权限");
      });

      it("应该处理空数组", () => {
        const result = validatePermissions([]);
        expect(result).toEqual([]);
      });

      it("错误消息应该包含所有无效的权限", () => {
        try {
          validatePermissions(["INVALID_1", "INVALID_2", Permission.USER_READ]);
        } catch (error: any) {
          expect(error.message).toContain("INVALID_1");
          expect(error.message).toContain("INVALID_2");
        }
      });
    });
  });
});
