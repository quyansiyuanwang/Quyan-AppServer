import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
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

    const call = prismaMock.aIRequestLog.findMany.mock.calls[0][0];
    expect(call.skip).toBe(50);
    expect(call.take).toBe(50);
    expect(call.select).not.toHaveProperty("requestBody");
    expect(call.select).not.toHaveProperty("responseBody");
    expect(call.where.AND[0].OR).toEqual(
      expect.arrayContaining([
        { requestBody: { string_contains: "violating content" } },
        { responseBody: { string_contains: "violating content" } },
      ]),
    );
  });
});
