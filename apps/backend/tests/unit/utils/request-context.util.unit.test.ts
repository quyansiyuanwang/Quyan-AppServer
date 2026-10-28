import { describe, expect, it } from "vitest";
import {
  getCurrentIP,
  getCurrentPath,
  getCurrentUser,
  getCurrentUserId,
  getRequestContext,
  setRequestContext,
  runWithRequestContext,
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

describe("scoped request contexts", () => {
  it("restores the caller after synchronous authentication enters a request context", () => {
    const outer = { user: { userId: "caller" } } as any;
    const request = { user: { userId: "request" } } as any;
    setRequestContext(outer);
    runWithRequestContext(request, () => {
      setRequestContext(request);
      expect(getCurrentUserId()).toBe("request");
    });
    expect(getRequestContext()).toBe(outer);
    expect(() =>
      runWithRequestContext(request, () => {
        throw new Error("fixture failure");
      }),
    ).toThrow("fixture failure");
    expect(getRequestContext()).toBe(outer);
  });
  it("isolates overlapping asynchronous requests and restores their awaiting caller", async () => {
    const outer = { user: { userId: "caller" } } as any;
    setRequestContext(outer);
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runWithRequestContext({ user: { userId: "first" } } as any, async () => {
      await ready;
      expect(getCurrentUserId()).toBe("first");
      throw new Error("fixture rejection");
    });
    const rejected = expect(first).rejects.toThrow("fixture rejection");
    await runWithRequestContext({ user: { userId: "second" } } as any, async () => {
      await Promise.resolve();
      expect(getCurrentUserId()).toBe("second");
      release();
      await rejected;
      expect(getCurrentUserId()).toBe("second");
    });
    expect(getRequestContext()).toBe(outer);
  });
});
