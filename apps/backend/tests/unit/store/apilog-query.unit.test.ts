import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveApiLogWhere } from "@/store/system/apilog-query";
const client = { user: { findMany: vi.fn() } };
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});
describe("shared legacy and native API log predicates", () => {
  it("preserves literal search and its precedence over individual request/path/IP filters", async () => {
    const where = await resolveApiLogWhere(client as never, {
      search: "中文%_\nneedle",
      requestID: "ignored",
      path: "ignored",
      ip: "ignored",
      method: ["GET", "POST"],
      statusCode: [200, 500],
    });
    expect(where).toMatchObject({
      status: 1,
      method: { in: ["GET", "POST"] },
      statusCode: { in: [200, 500] },
      OR: [
        { path: { contains: "中文%_\nneedle" } },
        { requestID: { contains: "中文%_\nneedle" } },
        { ipAddress: { contains: "中文%_\nneedle" } },
        { queryParams: { string_contains: "中文%_\nneedle" } },
        { bodyParams: { string_contains: "中文%_\nneedle" } },
      ],
    });
    expect(where).not.toHaveProperty("path");
    expect(where).not.toHaveProperty("requestID");
    expect(where).not.toHaveProperty("ipAddress");
  });
  it("uses the existing bounded active-user lookup and an explicit empty result", async () => {
    client.user.findMany.mockResolvedValue([]);
    expect(await resolveApiLogWhere(client as never, { user: "missing" })).toBeUndefined();
    expect(client.user.findMany).toHaveBeenCalledWith({
      where: { OR: [{ username: { contains: "missing" } }, { id: "missing" }], status: 1 },
      select: { id: true },
      take: 100,
    });
    client.user.findMany.mockResolvedValue([{ id: "one" }, { id: "two" }]);
    expect(await resolveApiLogWhere(client as never, { user: "matches" })).toMatchObject({
      userID: { in: ["one", "two"] },
    });
  });
  it("keeps the default recent range and explicit one-sided ranges", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    const start = new Date();
    start.setDate(start.getDate() - 30);
    expect(await resolveApiLogWhere(client as never, {})).toMatchObject({ createTime: { gte: start } });
    expect(await resolveApiLogWhere(client as never, { endDate: new Date(0) })).toMatchObject({
      createTime: { lte: new Date(0) },
    });
  });
  it("retains scalar and empty-list filter behavior", async () => {
    expect(
      await resolveApiLogWhere(client as never, {
        method: "GET",
        statusCode: 200,
        path: "/literal",
        requestID: "req",
        ip: "192.0.2.1",
      }),
    ).toMatchObject({
      method: "GET",
      statusCode: 200,
      path: { contains: "/literal" },
      requestID: { contains: "req" },
      ipAddress: { contains: "192.0.2.1" },
    });
    expect(await resolveApiLogWhere(client as never, { method: [], statusCode: [] })).toMatchObject({
      method: undefined,
      statusCode: undefined,
    });
  });
});
