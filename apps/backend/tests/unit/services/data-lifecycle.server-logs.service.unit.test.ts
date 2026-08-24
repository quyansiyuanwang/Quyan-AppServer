import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  env: {
    database: { url: "mysql://test:test@localhost:3306/test" },
    runtime: {
      cwd: "D:/appserver",
      isDevelopment: false,
      logging: { disableConsoleLog: true, enableFileLogging: false },
    },
    integrations: {
      objectStorage: {
        archive: {
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
  },
}));

vi.mock("fs", () => ({
  promises: {
    readdir: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
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
    "server_logs",
  ],
  ObservabilityRepository: { getInstance: vi.fn() },
}));

import { promises as fs } from "fs";
import path from "path";
import { DataLifecycleService } from "@/services/system/data-lifecycle.service";

describe("DataLifecycleService server log archival", () => {
  const repository = {
    getLifecyclePolicy: vi.fn(),
    countDatasetBefore: vi.fn(),
    createLifecycleRun: vi.fn(),
    createArchiveArtifact: vi.fn(),
    updateLifecycleRun: vi.fn(),
    updateLifecyclePolicy: vi.fn(),
  };
  const ServiceCtor = DataLifecycleService as unknown as new (...args: any[]) => DataLifecycleService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository.getLifecyclePolicy.mockResolvedValue({
      id: "policy-logs",
      dataset: "server_logs",
      enabled: true,
      hotRetentionDays: 14,
      archiveRetentionDays: 365,
    });
    repository.createLifecycleRun.mockResolvedValue({ id: "run-logs" });
    repository.createArchiveArtifact.mockResolvedValue({ id: "artifact-logs" });
    repository.updateLifecycleRun.mockResolvedValue(undefined);
    repository.updateLifecyclePolicy.mockResolvedValue(undefined);
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: "combined-2026-07-01.log", isFile: () => true } as any,
      { name: "combined-2026-08-09.log", isFile: () => true } as any,
    ]);
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("old log line\n"));
    vi.mocked(fs.unlink).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes an old local log only after OSS verification", async () => {
    // Keep the Aug 9 fixture on the hot-retention side of the cutoff. Without
    // a fixed clock this test changes behavior as the calendar advances.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00.000Z"));
    let checksum = "";
    let uploadedLength = 0;
    const ossClient = {
      put: vi.fn(async (_key: string, body: Buffer, options: { headers: Record<string, string> }) => {
        checksum = options.headers["x-oss-meta-sha256"];
        uploadedLength = body.byteLength;
      }),
      head: vi.fn(async () => ({
        res: { headers: { "x-oss-meta-sha256": checksum, "content-length": String(uploadedLength) } },
      })),
    };
    const service = new ServiceCtor(repository);
    (service as any).ossClient = ossClient;

    const result = await service.runPolicy("server_logs", "manual", "admin-1");

    expect(ossClient.put).toHaveBeenCalledTimes(1);
    expect(repository.createArchiveArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ dataset: "server_logs", recordCount: 1 }),
    );
    expect(fs.unlink).toHaveBeenCalledWith(path.join("D:/appserver", "logs", "combined-2026-07-01.log"));
    expect(result).toMatchObject({ candidateCount: 1, archivedCount: 1, deletedCount: 1 });
  });

  it("keeps the local log when OSS upload fails", async () => {
    const ossClient = {
      put: vi.fn().mockRejectedValue(new Error("OSS unavailable")),
      head: vi.fn(),
    };
    const service = new ServiceCtor(repository);
    (service as any).ossClient = ossClient;

    await expect(service.runPolicy("server_logs", "manual", "admin-1")).rejects.toThrow("OSS unavailable");

    expect(fs.unlink).not.toHaveBeenCalled();
    expect(repository.updateLifecycleRun).toHaveBeenLastCalledWith(
      "run-logs",
      expect.objectContaining({ runStatus: "failed", archivedCount: 0, deletedCount: 0 }),
    );
  });
});
