import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { authMiddleware } from "@/middleware/auth/auth_guard";
import { isLocalIP, isLocalRequest, localAuthMiddleware } from "@/middleware/auth/local_auth";

vi.mock("@/middleware/auth/auth_guard", () => ({
  authMiddleware: vi.fn(),
}));

describe("local_auth middleware", () => {
  const mockedAuthMiddleware = vi.mocked(authMiddleware);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects known local IP variants", () => {
    expect(isLocalIP("127.0.0.1")).toBe(true);
    expect(isLocalIP("::1")).toBe(true);
    expect(isLocalIP("::ffff:127.0.0.1")).toBe(true);
    expect(isLocalIP("127.1.2.3")).toBe(true);
    expect(isLocalIP("localhost")).toBe(true);
  });

  it("rejects non-local and empty IP values", () => {
    expect(isLocalIP(undefined)).toBe(false);
    expect(isLocalIP("8.8.8.8")).toBe(false);
    expect(isLocalIP("example.com")).toBe(false);
  });

  it("isLocalRequest checks req.ip first and falls back to socket.remoteAddress", () => {
    const reqWithIp = {
      ip: "127.0.0.1",
      socket: { remoteAddress: "8.8.8.8" },
    } as Request;

    const reqWithSocket = {
      ip: undefined,
      socket: { remoteAddress: "127.0.0.2" },
    } as Request;

    const reqExternal = {
      ip: "8.8.8.8",
      socket: { remoteAddress: "8.8.4.4" },
    } as Request;

    expect(isLocalRequest(reqWithIp)).toBe(true);
    expect(isLocalRequest(reqWithSocket)).toBe(true);
    expect(isLocalRequest(reqExternal)).toBe(false);
  });

  it("localAuthMiddleware allows local requests without JWT", async () => {
    const req = {
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    } as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await localAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockedAuthMiddleware).not.toHaveBeenCalled();
  });

  it("localAuthMiddleware delegates non-local requests to auth middleware", async () => {
    mockedAuthMiddleware.mockImplementation((_req, _res, next) => {
      next();
      return Promise.resolve(undefined);
    });

    const req = {
      ip: "8.8.8.8",
      socket: { remoteAddress: "8.8.8.8" },
    } as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await localAuthMiddleware(req, res, next);

    expect(mockedAuthMiddleware).toHaveBeenCalledWith(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
