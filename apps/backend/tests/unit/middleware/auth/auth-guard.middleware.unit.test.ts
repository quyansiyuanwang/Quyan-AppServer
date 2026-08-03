import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpStatusCode } from "axios";
import { CustomCode } from "@/constant/custom-code";
import { ForbiddenError, UnauthorizedError } from "@/util/errors";
import { EnvSpace } from "@/config/env";
import { JWTAccessIns } from "@/util/auth";
import { authMiddleware, expressAuthentication } from "@/middleware/auth/auth_guard";
import { validateAccountStatus } from "@/util/auth/account-status";
import { isLocalRequest } from "@/middleware/auth/local_auth";
import { ReURLService } from "@/services/system/reurl.service";
import { setRequestContext } from "@/util/request-context";

const { userRepositoryMock, reurlServiceMock, relayTokenServiceMock, accessKeyServiceMock } = vi.hoisted(() => ({
  userRepositoryMock: {
    findById: vi.fn(),
  },
  reurlServiceMock: {
    getToken: vi.fn(),
  },
  relayTokenServiceMock: {
    validateToken: vi.fn(),
  },
  accessKeyServiceMock: {
    validateKey: vi.fn(),
    updateUsage: vi.fn(),
  },
}));

vi.mock("@/store/users/user.repository", () => ({
  UserRepository: {
    getInstance: vi.fn(() => userRepositoryMock),
  },
}));

vi.mock("@/services/system/reurl.service", () => ({
  ReURLService: {
    getInstance: vi.fn(() => reurlServiceMock),
  },
}));

vi.mock("@/util/auth/account-status", () => ({
  validateAccountStatus: vi.fn(),
  AccountStatus: { ACTIVE: 1, DISABLED: 0, DELETED: -1 },
}));

vi.mock("@/middleware/auth/local_auth", () => ({
  isLocalRequest: vi.fn(),
}));

vi.mock("@/services/relay/relay-token.service", () => ({
  RelayTokenService: class {
    validateToken = relayTokenServiceMock.validateToken;
  },
}));

vi.mock("@/services/users/accesskey.service", () => ({
  AccessKeyService: class {
    validateKey = accessKeyServiceMock.validateKey;
    updateUsage = accessKeyServiceMock.updateUsage;
  },
}));

vi.mock("@/util/request-context", () => ({
  setRequestContext: vi.fn(),
}));

function createRequest(overrides: Record<string, unknown> = {}) {
  return {
    headers: {},
    query: {},
    method: "GET",
    path: "/protected",
    ip: "8.8.8.8",
    socket: { remoteAddress: "8.8.8.8" },
    ...overrides,
  } as any;
}

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any;
}

function issueToken(payload: Record<string, unknown>) {
  return JWTAccessIns.generateToken(payload as any, 3600);
}

describe("auth_guard middleware", () => {
  const mockedValidateAccountStatus = vi.mocked(validateAccountStatus);
  const mockedIsLocalRequest = vi.mocked(isLocalRequest);
  const mockedReurlGetInstance = vi.mocked(ReURLService.getInstance);
  const mockedSetRequestContext = vi.mocked(setRequestContext);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedValidateAccountStatus.mockImplementation(() => undefined);
    mockedIsLocalRequest.mockReturnValue(false);
    mockedReurlGetInstance.mockReturnValue(reurlServiceMock as any);
    userRepositoryMock.findById.mockResolvedValue({
      id: "u-1",
      status: 1,
      updateTime: new Date("2026-01-01T00:00:00.000Z"),
    });
    reurlServiceMock.getToken.mockResolvedValue(undefined);
    relayTokenServiceMock.validateToken.mockResolvedValue({ id: "rt-1", userId: "u-1" });
    accessKeyServiceMock.validateKey.mockResolvedValue({ id: "ak-1", userId: "u-1" });
    accessKeyServiceMock.updateUsage.mockResolvedValue(undefined);
  });

  it("authMiddleware returns 401 when no token provided", async () => {
    const req = createRequest();
    const res = createResponse();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(HttpStatusCode.Unauthorized);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: CustomCode.AUTH_FAILED,
        message: "Unauthorized: No token provided",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("authMiddleware resolves reurl token and sets request user", async () => {
    const token = issueToken({
      userId: "u-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      status: 1,
    });
    reurlServiceMock.getToken.mockResolvedValue(token);

    const req = createRequest({ headers: { authorization: "Bearer reurl:abc123" } });
    const res = createResponse();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(reurlServiceMock.getToken).toHaveBeenCalledWith("abc123");
    expect(req.user).toEqual(
      expect.objectContaining({
        userId: "u-1",
      }),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("authMiddleware returns 401 when token verification fails", async () => {
    const req = createRequest({ headers: { authorization: "Bearer jwt-token" } });
    const res = createResponse();

    await authMiddleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(HttpStatusCode.Unauthorized);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: CustomCode.AUTH_FAILED,
        message: "Unauthorized: jwt malformed",
      }),
    );
  });

  it("authMiddleware returns 403 when account is forbidden", async () => {
    const token = issueToken({
      userId: "u-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockedValidateAccountStatus.mockImplementation(() => {
      throw new ForbiddenError("账号已被禁用，请联系管理员", CustomCode.ACCOUNT_DISABLED);
    });

    const req = createRequest({ headers: { authorization: `Bearer ${token}` } });
    const res = createResponse();

    await authMiddleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(HttpStatusCode.Forbidden);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: CustomCode.ACCOUNT_DISABLED,
      }),
    );
  });

  it("authMiddleware returns 401 when token updatedAt is missing", async () => {
    const token = issueToken({ userId: "u-1" });

    const req = createRequest({ headers: { authorization: `Bearer ${token}` } });
    const res = createResponse();

    await authMiddleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(HttpStatusCode.Unauthorized);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE,
      }),
    );
  });

  it("authMiddleware returns 401 when token updatedAt mismatches user updateTime", async () => {
    const token = issueToken({
      userId: "u-1",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const req = createRequest({ headers: { authorization: `Bearer ${token}` } });
    const res = createResponse();

    await authMiddleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(HttpStatusCode.Unauthorized);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE,
      }),
    );
  });

  it("expressAuthentication allows local requests for local-or-jwt outside test mode", async () => {
    const originalIsTest = EnvSpace.isTest;
    (EnvSpace as any).isTest = false;
    mockedIsLocalRequest.mockReturnValue(true);

    try {
      const req = createRequest();
      const result = await expressAuthentication(req, "local-or-jwt");

      expect(result).toEqual({ local: true });
      expect(mockedSetRequestContext).toHaveBeenCalledWith(req);
    } finally {
      (EnvSpace as any).isTest = originalIsTest;
    }
  });

  it("expressAuthentication supports relay token authentication", async () => {
    const req = createRequest({ headers: { authorization: "Bearer rlt_token" } });
    const result = await expressAuthentication(req, "jwt");

    expect(result).toEqual({ relayToken: true });
    expect(req.relayToken).toEqual(expect.objectContaining({ userId: "u-1" }));
  });

  it("expressAuthentication supports access key authentication", async () => {
    const req = createRequest({ headers: { authorization: "Bearer ak_token" } });
    const result = await expressAuthentication(req, "jwt");

    expect(accessKeyServiceMock.validateKey).toHaveBeenCalledWith("ak_token");
    expect(accessKeyServiceMock.updateUsage).toHaveBeenCalledWith("ak-1");
    expect(req.accessKey).toEqual(expect.objectContaining({ id: "ak-1" }));
    expect(req.user).toEqual(
      expect.objectContaining({
        userId: "u-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    expect(result).toEqual(expect.objectContaining({ userId: "u-1" }));
  });

  it("expressAuthentication rejects token without updatedAt", async () => {
    const token = issueToken({ userId: "u-1" });
    const req = createRequest({ headers: { authorization: `Bearer ${token}` } });

    await expect(expressAuthentication(req, "jwt")).rejects.toThrow("Token版本过旧，请重新登录");
  });

  it("expressAuthentication rejects token when updatedAt mismatches user updateTime", async () => {
    const token = issueToken({
      userId: "u-1",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const req = createRequest({ headers: { authorization: `Bearer ${token}` } });

    await expect(expressAuthentication(req, "jwt")).rejects.toThrow("用户信息已更新，请重新登录");
  });

  it("expressAuthentication rejects invalid reurl token", async () => {
    const req = createRequest({ headers: { authorization: "Bearer reurl:expired" } });

    await expect(expressAuthentication(req, "jwt")).rejects.toThrow(UnauthorizedError);
    await expect(expressAuthentication(req, "jwt")).rejects.toThrow("ReURL 已过期或无效");
  });

  it("expressAuthentication throws for unknown security name", async () => {
    await expect(expressAuthentication(createRequest(), "unknown" as any)).rejects.toThrow(
      "Unknown security name: unknown",
    );
  });
});
