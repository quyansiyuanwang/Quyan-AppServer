import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  env: {
    database: { url: "mysql://test:test@localhost:3306/test" },
    runtime: { isDevelopment: false, logging: { disableConsoleLog: true, enableFileLogging: false } },
    integrations: {
      archiveOss: {
        enabled: true,
        endpoint: "https://oss.example.test",
        region: "oss-cn-test",
        bucket: "archives",
        accessKeyId: "test-key",
        accessKeySecret: "test-secret",
        prefix: "archives",
      },
    },
  },
}));

vi.mock("@/store/system/observability.repository", () => ({
  DATA_LIFECYCLE_DATASETS: [
    "api_logs",
    "business_logs",
    "notification_logs",
    "track_events",
    "heatmap_points",
    "relay_usages",
    "monthly_pass_usages",
  ],
  ObservabilityRepository: { getInstance: vi.fn() },
}));

import { DataLifecycleService } from "@/services/system/data-lifecycle.service";

describe("DataLifecycleService archive batching", () => {
  const repository = {
    getLifecyclePolicy: vi.fn(),
    countDatasetBefore: vi.fn(),
    createLifecycleRun: vi.fn(),
    listDatasetBatch: vi.fn(),
    createArchiveArtifact: vi.fn(),
    deleteDatasetIds: vi.fn(),
    updateLifecycleRun: vi.fn(),
    updateLifecyclePolicy: vi.fn(),
  };
  const ServiceCtor = DataLifecycleService as unknown as new (...args: any[]) => DataLifecycleService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository.getLifecyclePolicy.mockResolvedValue({
      id: "policy-1",
      dataset: "api_logs",
      enabled: true,
      hotRetentionDays: 90,
      archiveRetentionDays: 365,
    });
    repository.countDatasetBefore.mockResolvedValue(3);
    repository.createLifecycleRun.mockResolvedValue({ id: "run-1" });
    repository.listDatasetBatch
      .mockResolvedValueOnce([{ id: "log-1", createTime: new Date("2026-01-01") }, { id: "log-2" }])
      .mockResolvedValueOnce([{ id: "log-3" }])
      .mockResolvedValueOnce([]);
    repository.createArchiveArtifact.mockImplementation(async (input) => ({
      id: `artifact-${input.recordCount}`,
      ...input,
    }));
    repository.deleteDatasetIds.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    repository.updateLifecycleRun.mockResolvedValue(undefined);
    repository.updateLifecyclePolicy.mockResolvedValue(undefined);
  });

  it("exports and deletes every batch only after its object is verified", async () => {
    let checksum = "";
    const ossClient = {
      put: vi.fn(async (_key: string, _body: Buffer, options: { headers: Record<string, string> }) => {
        checksum = options.headers["x-oss-meta-sha256"];
      }),
      head: vi.fn(async () => ({ res: { headers: { "x-oss-meta-sha256": checksum, "content-length": "56" } } })),
    };
    const service = new ServiceCtor(repository);
    (service as any).ossClient = ossClient;

    // The mocked length must match each generated gzip payload. Keep head dynamic.
    ossClient.head.mockImplementation(async () => ({
      res: {
        headers: {
          "x-oss-meta-sha256": checksum,
          "content-length": String((ossClient.put.mock.calls.at(-1)?.[1] as Buffer).byteLength),
        },
      },
    }));

    const result = await service.runPolicy("api_logs", "manual", "admin-1");

    expect(ossClient.put).toHaveBeenCalledTimes(2);
    expect(ossClient.put.mock.calls[0][2].headers).toMatchObject({
      "Content-Type": "application/gzip",
    });
    expect(ossClient.put.mock.calls[0][2].headers).not.toHaveProperty("Content-Encoding");
    expect(repository.deleteDatasetIds).toHaveBeenNthCalledWith(1, "api_logs", ["log-1", "log-2"]);
    expect(repository.deleteDatasetIds).toHaveBeenNthCalledWith(2, "api_logs", ["log-3"]);
    expect(repository.createArchiveArtifact.mock.calls.map(([input]) => input.objectKey)).toEqual([
      expect.stringMatching(/run-1-0\.ndjson\.gz$/),
      expect.stringMatching(/run-1-1\.ndjson\.gz$/),
    ]);
    expect(result).toMatchObject({ candidateCount: 3, archivedCount: 3, deletedCount: 3 });
  });
});
