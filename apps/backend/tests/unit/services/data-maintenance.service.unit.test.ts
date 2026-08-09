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
});
