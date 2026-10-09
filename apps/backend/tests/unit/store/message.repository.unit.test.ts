import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), findMany: vi.fn() }));
vi.mock("@/config/database", () => ({ prisma: { $queryRaw: mocks.query, message: { findMany: mocks.findMany } } }));
import { MessageRepository } from "@/store/chat/message.repository";
beforeEach(() => vi.clearAllMocks());
describe("chat context repository budgets", () => {
  it("aggregates bytes and count without loading content; replacement bounds are parameterized", async () => {
    mocks.query.mockResolvedValue([{ count: 3n, bytes: 15n }]);
    const before = { id: "fixture-id", createTime: new Date("2026-01-01") };
    expect(await MessageRepository.getInstance().getContextSize("fixture-conversation", before)).toEqual({
      count: 3,
      bytes: 15,
    });
    const sql = mocks.query.mock.calls[0][0];
    expect(sql.sql).toContain("OCTET_LENGTH(content)");
    expect(sql.sql).not.toContain("fixture-conversation");
    expect(sql.values).toContain(before.id);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it("loads only role/content and a bounded number of rows", async () => {
    mocks.findMany.mockResolvedValue([]);
    await MessageRepository.getInstance().findContext("fixture-conversation", 20);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 21, select: { role: true, content: true } }),
    );
  });
  it("does not impose a hidden count limit when the configured count is zero", async () => {
    mocks.findMany.mockResolvedValue([]);
    await MessageRepository.getInstance().findContext("fixture-conversation", 0);
    expect(mocks.findMany.mock.calls[0][0]).not.toHaveProperty("take");
  });
});
