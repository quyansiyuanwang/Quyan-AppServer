import { describe, expect, it } from "vitest";
import {
  getCurrentIP,
  getCurrentPath,
  getCurrentUser,
  getCurrentUserId,
  getRequestContext,
  setRequestContext,
} from "@/util/request-context";

describe("request-context util", () => {
  it("stores and returns current request context", () => {
    const req = {
      path: "/users/me",
      ip: "127.0.0.1",
      user: { userId: "user-1", username: "alice" },
    } as any;

    setRequestContext(req);

    expect(getRequestContext()).toBe(req);
    expect(getCurrentUserId()).toBe("user-1");
    expect(getCurrentUser()).toEqual({ userId: "user-1", username: "alice" });
    expect(getCurrentIP()).toBe("127.0.0.1");
    expect(getCurrentPath()).toBe("/users/me");
  });

  it("falls back to socket remoteAddress when ip is missing", () => {
    const req = {
      path: "/health",
      socket: { remoteAddress: "10.0.0.1" },
      user: { userId: "user-2" },
    } as any;

    setRequestContext(req);

    expect(getCurrentIP()).toBe("10.0.0.1");
    expect(getCurrentUserId()).toBe("user-2");
  });

  it("returns undefined for missing fields in context", () => {
    setRequestContext({} as any);

    expect(getCurrentUserId()).toBeUndefined();
    expect(getCurrentUser()).toBeUndefined();
    expect(getCurrentIP()).toBeUndefined();
    expect(getCurrentPath()).toBeUndefined();
  });
});
