import { createHash } from "crypto";
import { gzipSync } from "zlib";
import { describe, expect, it, vi } from "vitest";
import { DataMaintenanceService } from "@/services/system/data-maintenance.service";

function archive(rows: unknown[]): Buffer {
  return gzipSync(Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n"), "utf8"));
}

describe("DataMaintenanceService", () => {
  it("previews gzip NDJSON and counts duplicate IDs", async () => {
    const delegate = {
      findMany: vi.fn().mockResolvedValue([{ id: "existing" }]),
    };
    const repository = {
      getDatasetDelegate: vi.fn().mockReturnValue(delegate),
      getDelegateByName: vi.fn(),
    };
    const service = new (DataMaintenanceService as any)(repository) as DataMaintenanceService;
    const result = await service.previewImport(
      "api_logs",
      archive([
        { id: "existing", requestID: "r1", path: "/", method: "GET", ipAddress: "127.0.0.1", statusCode: 200 },
        { id: "new", requestID: "r2", path: "/", method: "GET", ipAddress: "127.0.0.1", statusCode: 200 },
      ]),
    );

    expect(result.totalCount).toBe(2);
    expect(result.duplicateCount).toBe(1);
    expect(result.newCount).toBe(1);
    expect(result.executable).toBe(true);
  });

  it("rejects unknown archive fields", async () => {
    const repository = {
      getDatasetDelegate: vi.fn().mockReturnValue({ findMany: vi.fn().mockResolvedValue([]) }),
      getDelegateByName: vi.fn(),
    };
    const service = new (DataMaintenanceService as any)(repository) as DataMaintenanceService;
    const result = await service.previewImport("api_logs", archive([{ id: "x", secretToken: "nope" }]));

    expect(result.invalidCount).toBe(1);
    expect(result.executable).toBe(false);
    expect(result.errors[0]).toContain("unknown fields");
  });

  it("reports malformed NDJSON lines in the preview", async () => {
    const repository = {
      getDatasetDelegate: vi.fn().mockReturnValue({ findMany: vi.fn().mockResolvedValue([]) }),
      getDelegateByName: vi.fn(),
    };
    const service = new (DataMaintenanceService as any)(repository) as DataMaintenanceService;
    const result = await service.previewImport("api_logs", gzipSync(Buffer.from('{"id":"ok"}\nnot-json')));

    expect(result.totalCount).toBe(2);
    expect(result.invalidCount).toBe(1);
    expect(result.executable).toBe(false);
  });

  it("keeps an import task when OSS returns matching object metadata", async () => {
    const payload = archive([{ id: "new" }]);
    const repository = {
      getDatasetDelegate: vi.fn().mockReturnValue({ findMany: vi.fn().mockResolvedValue([]) }),
      getDelegateByName: vi.fn(),
      createMaintenanceRun: vi.fn().mockResolvedValue({ id: "run-1" }),
    };
    const service = new (DataMaintenanceService as any)(repository) as DataMaintenanceService;
    const ossClient = {
      put: vi.fn(),
      head: vi.fn().mockResolvedValue({
        res: {
          headers: {
            "x-oss-meta-sha256": createHash("sha256").update(payload).digest("hex"),
            "content-length": String(payload.length),
            "x-oss-storage-class": "Standard",
          },
        },
      }),
      delete: vi.fn(),
    };
    (service as any).ossClient = ossClient;

    await expect(service.createImportRun("api_logs", payload, "admin-1", "request-1")).resolves.toEqual({
      id: "run-1",
    });
    expect(repository.createMaintenanceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset: "api_logs",
        operation: "import",
        totalCount: 1,
      }),
    );
    expect(ossClient.put).toHaveBeenCalledWith(
      expect.any(String),
      payload,
      expect.objectContaining({
        headers: expect.objectContaining({ "x-oss-storage-class": "Standard" }),
      }),
    );
    expect(ossClient.delete).not.toHaveBeenCalled();
  });
});
