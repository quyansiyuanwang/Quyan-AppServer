import { describe, expect, it } from "vitest";
import { DATA_LIFECYCLE_ARCHIVE_DEFAULTS, DATA_MAINTENANCE_DATASETS } from "@/store/system/observability.repository";

describe("AI request log lifecycle metadata", () => {
  it("uses a permanent archive and excludes AI audit rows from maintenance imports", () => {
    expect(DATA_LIFECYCLE_ARCHIVE_DEFAULTS.ai_request_logs).toBeNull();
    expect(DATA_MAINTENANCE_DATASETS).not.toContain("ai_request_logs");
  });
});
