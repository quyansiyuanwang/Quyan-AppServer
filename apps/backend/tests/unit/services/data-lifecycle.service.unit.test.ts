import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  env: {
    runtime: {
      isDevelopment: false,
      logging: { disableConsoleLog: true, enableFileLogging: false },
    },
    integrations: {
      archiveOss: {
        enabled: false,
        endpoint: "",
        region: "",
        bucket: "",
        accessKeyId: "",
        accessKeySecret: "",
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

describe("DataLifecycleService", () => {
  const repository = {
    getLifecyclePolicy: vi.fn(),
    listLifecyclePolicies: vi.fn(),
    countDatasetBefore: vi.fn(),
    createLifecycleRun: vi.fn(),
    listDatasetBatch: vi.fn(),
    deleteDatasetIds: vi.fn(),
    listArchiveArtifacts: vi.fn(),
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
    repository.countDatasetBefore.mockResolvedValue(2);
    repository.createLifecycleRun.mockResolvedValue({ id: "run-1" });
  });

  it("does not delete source data when OSS is not configured", async () => {
    const service = new ServiceCtor(repository);

    await expect(service.runPolicy("api_logs", "manual", "admin-1")).rejects.toThrow("OSS is not configured");
    expect(repository.createLifecycleRun).not.toHaveBeenCalled();
    expect(repository.listDatasetBatch).not.toHaveBeenCalled();
    expect(repository.deleteDatasetIds).not.toHaveBeenCalled();
  });

  it("rejects unsupported datasets and invalid retention values", async () => {
    const service = new ServiceCtor(repository);

    await expect(service.updatePolicy("balance_transactions", true, 90)).rejects.toThrow(
      "Unsupported lifecycle dataset",
    );
    await expect(service.updatePolicy("api_logs", true, 0)).rejects.toThrow("between 1 and 3650");
  });

  it("delegates archive artifact pagination", async () => {
    const result = { items: [{ id: "artifact-1" }], total: 1 };
    repository.listArchiveArtifacts.mockResolvedValue(result);
    const service = new ServiceCtor(repository);

    await expect(service.listArchiveArtifacts("run-1", 2, 10)).resolves.toBe(result);
    expect(repository.listArchiveArtifacts).toHaveBeenCalledWith("run-1", 2, 10);
  });

  it("runs selected policies independently and reports skipped datasets", async () => {
    repository.listLifecyclePolicies.mockResolvedValue([
      { dataset: "api_logs", enabled: true },
      { dataset: "business_logs", enabled: true },
    ]);
    const service = new ServiceCtor(repository);
    vi.spyOn(service, "runPolicy").mockResolvedValue({
      runId: "run-1",
      candidateCount: 3,
      archivedCount: 3,
      deletedCount: 3,
    } as any);

    const result = await service.runPolicies(["api_logs", "track_events"], "manual", "admin-1");

    expect(result).toMatchObject({ completedCount: 1, failedCount: 0, skippedCount: 1 });
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dataset: "api_logs", status: "completed" }),
        expect.objectContaining({ dataset: "track_events", status: "skipped" }),
      ]),
    );
  });
});
