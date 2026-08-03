import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { swaggerAuthMiddleware } from "@/middleware/auth/swagger_auth";
import { authMiddleware } from "@/middleware/auth/auth_guard";
import { isLocalRequest } from "@/middleware/auth/local_auth";

vi.mock("@/middleware/auth/auth_guard", () => ({
  authMiddleware: vi.fn(),
}));

vi.mock("@/middleware/auth/local_auth", () => ({
  isLocalRequest: vi.fn(),
}));

describe("swaggerAuthMiddleware", () => {
  const mockedAuthMiddleware = vi.mocked(authMiddleware);
  const mockedIsLocalRequest = vi.mocked(isLocalRequest);

  const res = {} as Response;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsLocalRequest.mockReturnValue(false);
  });

  it("allows swagger static resources without auth", async () => {
    const req = { path: "/docs/swagger-ui.css" } as Request;
    const next = vi.fn() as unknown as NextFunction;

    await swaggerAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockedIsLocalRequest).not.toHaveBeenCalled();
    expect(mockedAuthMiddleware).not.toHaveBeenCalled();
  });

  it("allows local requests without auth", async () => {
    mockedIsLocalRequest.mockReturnValue(true);

    const req = { path: "/docs" } as Request;
    const next = vi.fn() as unknown as NextFunction;

    await swaggerAuthMiddleware(req, res, next);

    expect(mockedIsLocalRequest).toHaveBeenCalledWith(req);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockedAuthMiddleware).not.toHaveBeenCalled();
  });

  it("delegates non-local non-static requests to authMiddleware", async () => {
    mockedIsLocalRequest.mockReturnValue(false);
    mockedAuthMiddleware.mockImplementation((_req, _res, next) => {
      next();
      return Promise.resolve(undefined);
    });

    const req = { path: "/docs" } as Request;
    const next = vi.fn() as unknown as NextFunction;

    await swaggerAuthMiddleware(req, res, next);

    expect(mockedAuthMiddleware).toHaveBeenCalledWith(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
