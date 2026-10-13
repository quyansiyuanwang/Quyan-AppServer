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

import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { PLATFORM_AI_LOG_COLLECTION_SELECT } from "@/store/system/platform-ai-request-log-read.store";
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
  it("scans minimal identities with fixed boundaries independently of requested page", async () => {
    const after = { id: "log-after", createTime: new Date("2020-01-01") };
    const boundary = { id: "log-boundary", createTime: new Date("2021-01-01") };
    await AIRequestLogRepository.getInstance().scan({ page: 100, pageSize: 20, truncated: false }, after, boundary);
    expect(prismaMock.aIRequestLog.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          expect.objectContaining({ status: 1, AND: [{ requestTruncated: false, responseTruncated: false }] }),
          { OR: [{ createTime: { lt: after.createTime } }, { createTime: after.createTime, id: { lt: after.id } }] },
          {
            OR: [
              { createTime: { lt: boundary.createTime } },
              { createTime: boundary.createTime, id: { lte: boundary.id } },
            ],
          },
        ],
      },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      select: PLATFORM_AI_LOG_COLLECTION_SELECT,
    });
    expect(prismaMock.aIRequestLog.count).not.toHaveBeenCalled();
  });
  it("binds keyword and cursors without projecting searchable bodies", async () => {
    const after = { id: "log-after", createTime: new Date("2020-01-01") };
    await AIRequestLogRepository.getInstance().scan({ page: 10, pageSize: 20, keyword: "%'_" }, after, after);
    const sql = prismaMock.$queryRaw.mock.calls[0][0];
    expect(sql.sql).toContain("JSON_SEARCH");
    expect(sql.sql).toContain("id < ?");
    expect(sql.sql).toContain("id <= ?");
    expect(sql.values).toContain("log-after");
    expect(sql.values).toContain("%=%'=_%");
    expect(sql.sql.split(" FROM ")[0]).toBe("SELECT `id`, `status`, `updateTime`, `createTime`");
    expect(sql.sql).not.toContain("OFFSET");
    expect(prismaMock.aIRequestLog.findMany).not.toHaveBeenCalled();
  });
  it("hydrates only authorized active versions and skips empty hydration", async () => {
    const repository = AIRequestLogRepository.getInstance();
    expect(await repository.hydrate([])).toEqual([]);
    expect(prismaMock.aIRequestLog.findMany).not.toHaveBeenCalled();
    const target = { id: "log-1", status: 1, createTime: new Date(0), updateTime: new Date(1) };
    await repository.hydrate([target]);
    const args = prismaMock.aIRequestLog.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      status: 1,
      OR: [{ id: target.id, createTime: target.createTime, updateTime: target.updateTime }],
    });
    expect(args.select).not.toHaveProperty("requestBody");
    expect(args.select).not.toHaveProperty("responseBody");
    expect(args.select).not.toHaveProperty("attempts");
    await expect(repository.hydrate([target, target])).rejects.toMatchObject({ statusCode: 403 });
  });
});
