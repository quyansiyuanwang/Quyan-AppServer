import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  aIRequestLog: {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
  },
}));

vi.mock("@/config/database", () => ({ prisma: prismaMock }));

import { AIRequestLogRepository } from "@/store/system/ai-request-log.repository";

describe("AIRequestLogRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.aIRequestLog.findMany.mockResolvedValue([]);
    prismaMock.aIRequestLog.count.mockResolvedValue(0);
    prismaMock.$queryRaw.mockResolvedValue([]);
  });

  it("filters records that are not truncated when truncated=false", async () => {
    const repository = AIRequestLogRepository.getInstance();

    await repository.query({ page: 1, pageSize: 20, truncated: false });

    expect(prismaMock.aIRequestLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [{ requestTruncated: false, responseTruncated: false }],
        }),
      }),
    );
  });

  it("searches request and response JSON content without loading it in list results", async () => {
    const repository = AIRequestLogRepository.getInstance();

    await repository.query({ page: 2, pageSize: 50, keyword: "violating content" });

    expect(prismaMock.aIRequestLog.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
    const sql = prismaMock.$queryRaw.mock.calls[0][0];
    expect(sql.sql).toContain("JSON_SEARCH");
    expect(sql.sql).toContain("LIMIT ? OFFSET ?");
    expect(sql.sql).not.toContain("violating content");
    expect(sql.values).toContain("%violating content%");
    expect(sql.values).toContain(50);
  });
});
