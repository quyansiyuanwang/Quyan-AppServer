import { createHash } from "crypto";
import { gunzipSync } from "zlib";
import OSS from "ali-oss";
import { Prisma } from "@prisma/client";
import { env } from "@/config/env";
import { BadRequestError, NotFoundError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import { createObjectStorageClient } from "@/services/infrastructure/object-storage-client";
import {
  DATA_MAINTENANCE_DATASETS,
  DATA_MAINTENANCE_TABLES,
  ObservabilityRepository,
  type DataMaintenanceDataset,
} from "@/store/system/observability.repository";

const logger = getLogger("DataMaintenanceService", LogCategory.SYSTEM);
const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_LINE_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 2_000_000;
const IMPORT_BATCH_SIZE = 500;
const TEMPORARY_IMPORT_STORAGE_CLASS = "Standard";

const modelMeta = new Map(
  Prisma.dmmf.datamodel.models
    .filter((model) => typeof model.dbName === "string")
    .map((model) => [model.dbName as string, model]),
);

function assertDataset(value: string): asserts value is DataMaintenanceDataset {
  if (!(DATA_MAINTENANCE_DATASETS as readonly string[]).includes(value))
    throw new BadRequestError(`Unsupported maintenance dataset: ${value}`);
}

interface ParsedArchive {
  rows: Array<Record<string, unknown> | null>;
  errors: string[];
}

function parseArchive(buffer: Buffer): ParsedArchive {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new BadRequestError("A gzip NDJSON file is required");
  const maxCompressedBytes = env.runtime.requestSizeLimits.archiveImportBodyLimitMb * 1024 * 1024;
  if (buffer.length > maxCompressedBytes) throw new BadRequestError("Archive file is too large");
  let decompressed: Buffer;
  try {
    decompressed = gunzipSync(buffer, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
  } catch {
    throw new BadRequestError("Invalid gzip archive");
  }
  if (decompressed.length > MAX_DECOMPRESSED_BYTES) throw new BadRequestError("Decompressed archive is too large");
  const lines = decompressed.toString("utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length > MAX_RECORDS) throw new BadRequestError("Archive contains too many records");
  const errors: string[] = [];
  const rows = lines.map((line, index) => {
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new BadRequestError(`Archive line ${index + 1} is too large`);
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      if (errors.length < 20) errors.push(`line ${index + 1}: invalid JSON`);
      return null;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      if (errors.length < 20) errors.push(`line ${index + 1}: invalid record`);
      return null;
    }
    return value as Record<string, unknown>;
  });
  return { rows, errors };
}

function getOssHeaders(result: unknown): Record<string, string | undefined> {
  const headers = (result as { res?: { headers?: unknown } } | null)?.res?.headers;
  if (!headers || typeof headers !== "object") return {};
  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? String(value[0] ?? "") : String(value ?? ""),
    ]),
  );
}

function normalizeValue(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return value;
  if (type === "DateTime") {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new BadRequestError("Invalid DateTime value");
    return date;
  }
  if (type === "BigInt") return BigInt(String(value));
  if (type === "Int" || type === "Float") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new BadRequestError("Invalid numeric value");
    return number;
  }
  if (type === "Json" && typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw new BadRequestError("Invalid JSON value");
    }
  }
  return value;
}

export type ImportPreviewResult = DataMaintenanceImportPreviewResponseShape;
interface DataMaintenanceImportPreviewResponseShape {
  dataset: string;
  totalCount: number;
  newCount: number;
  duplicateCount: number;
  invalidCount: number;
  missingForeignKeyCount: number;
  executable: boolean;
  errors: string[];
  rows: Array<Record<string, unknown>>;
}

export class DataMaintenanceService {
  private static instance: DataMaintenanceService;
  private ossClient: OSS | null = null;

  private constructor(private readonly repository = ObservabilityRepository.getInstance()) {}

  public static getInstance(): DataMaintenanceService {
    if (!this.instance) this.instance = new DataMaintenanceService();
    return this.instance;
  }

  public async optimizePreview(datasets: string[]) {
    const normalized = [...new Set(datasets)].map((value) => {
      assertDataset(value);
      return value;
    });
    const items = await Promise.all(normalized.map((dataset) => this.repository.getMaintenanceTableStats(dataset)));
    return {
      items: items.map((item) => ({ ...item, executable: true })),
      totalRows: items.reduce((sum, item) => sum + item.rowCount, 0),
      totalBytes: items.reduce((sum, item) => sum + item.dataBytes + item.indexBytes, 0),
    };
  }

  public async createOptimizeRun(datasets: string[], actorUserId?: string, requestId?: string) {
    const preview = await this.optimizePreview(datasets);
    return this.repository.createMaintenanceRun({
      operation: "optimize",
      dataset: null,
      tableNames: preview.items.map((item) => item.tableName),
      startedByUserId: actorUserId,
      requestId,
      totalCount: preview.totalRows,
      result: preview.items,
    });
  }

  public async previewImport(dataset: string, buffer: Buffer): Promise<ImportPreviewResult> {
    assertDataset(dataset);
    const parsed = parseArchive(buffer);
    const rows = parsed.rows;
    const meta = modelMeta.get(DATA_MAINTENANCE_TABLES[dataset]);
    if (!meta) throw new BadRequestError("Unsupported archive dataset");

    const allowedFields = new Map(meta.fields.filter((field) => field.kind === "scalar").map((field) => [field.name, field]));
    const errors: string[] = [...parsed.errors];
    const normalizedRows: Array<Record<string, unknown>> = [];
    let invalidCount = 0;
    for (const [index, row] of rows.entries()) {
      try {
        if (!row) throw new Error("invalid record");
        if (typeof row.id !== "string" || row.id.length === 0) throw new Error("id is required");
        const unknown = Object.keys(row).filter((key) => !allowedFields.has(key));
        if (unknown.length > 0) throw new Error(`unknown fields: ${unknown.join(", ")}`);
        const normalized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) normalized[key] = normalizeValue(value, allowedFields.get(key)!.type);
        normalizedRows.push(normalized);
      } catch (error) {
        invalidCount += 1;
        if (errors.length < 20) errors.push(`line ${index + 1}: ${String(error instanceof Error ? error.message : error)}`);
      }
    }

    const delegate = (this.repository as any).getDatasetDelegate(dataset);
    const ids = normalizedRows.map((row) => String(row.id));
    const existingIds = await this.findExistingIds(delegate, ids);
    const seenIds = new Set<string>();
    const duplicateCount = ids.reduce((count, id) => {
      if (existingIds.has(id) || seenIds.has(id)) return count + 1;
      seenIds.add(id);
      return count;
    }, 0);
    const missingForeignKeyCount = await this.countMissingForeignKeys(dataset, normalizedRows);
    return {
      dataset,
      totalCount: rows.length,
      newCount: Math.max(0, normalizedRows.length - duplicateCount),
      duplicateCount,
      invalidCount,
      missingForeignKeyCount,
      executable: invalidCount === 0 && missingForeignKeyCount === 0,
      errors,
      rows: normalizedRows,
    };
  }

  public async createImportRun(dataset: string, buffer: Buffer, actorUserId?: string, requestId?: string) {
    assertDataset(dataset);
    const preview = await this.previewImport(dataset, buffer);
    if (!preview.executable) throw new BadRequestError(`Archive preview failed: ${preview.errors.join("; ") || "missing foreign key"}`);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const objectKey = `${env.integrations.objectStorage.staging.prefix}/maintenance/import/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${sha256}.ndjson.gz`;
    const client = this.getOssClient();
    await client.put(objectKey, buffer, {
      headers: {
        "Content-Type": "application/gzip",
        "x-oss-meta-sha256": sha256,
        "x-oss-storage-class": TEMPORARY_IMPORT_STORAGE_CLASS,
      },
    });
    const metadata = getOssHeaders(await client.head(objectKey));
    if (
      metadata["x-oss-meta-sha256"] !== sha256 ||
      Number(metadata["content-length"] || 0) !== buffer.length ||
      metadata["x-oss-storage-class"]?.toLowerCase() !== TEMPORARY_IMPORT_STORAGE_CLASS.toLowerCase()
    ) {
      await client.delete(objectKey).catch(() => undefined);
      throw new BadRequestError("Uploaded archive verification failed");
    }
    try {
      return await this.repository.createMaintenanceRun({
        operation: "import",
        dataset,
        tableNames: [DATA_MAINTENANCE_TABLES[dataset]],
        startedByUserId: actorUserId,
        requestId,
        tempObjectKey: objectKey,
        totalCount: preview.totalCount,
        invalidCount: preview.invalidCount,
        result: { duplicateCount: preview.duplicateCount },
      });
    } catch (error) {
      try {
        await this.getOssClient().delete(objectKey);
      } catch (cleanupError) {
        logger.warn("Failed to cleanup temporary archive after task creation failure", { objectKey, error: String(cleanupError) });
      }
      throw error;
    }
  }

  public listRuns(page: number, pageSize: number, filters?: { operation?: string; runStatus?: string }) {
    return this.repository.listMaintenanceRuns(page, pageSize, filters);
  }

  public async getRun(id: string) {
    const run = await this.repository.getMaintenanceRun(id);
    if (!run) throw new NotFoundError("Maintenance run not found");
    return run;
  }

  public async processQueuedRuns(limit = 3): Promise<void> {
    const runs = await this.repository.listQueuedMaintenanceRuns(limit);
    for (const run of runs) await this.processRun(run.id);
  }

  public async processRun(id: string): Promise<void> {
    const run = await this.repository.getMaintenanceRun(id);
    if (!run || run.runStatus !== "queued") return;
    await this.repository.updateMaintenanceRun(id, { runStatus: "running", startedAt: new Date() });
    try {
      if (run.operation === "optimize") {
        const tables = Array.isArray(run.tableNames) ? run.tableNames.map(String) : [];
        let completed = 0;
        for (const table of tables) {
          const dataset = (Object.keys(DATA_MAINTENANCE_TABLES) as DataMaintenanceDataset[]).find((key) => DATA_MAINTENANCE_TABLES[key] === table);
          if (!dataset) throw new BadRequestError("Invalid optimize table");
          await this.repository.optimizeTable(dataset);
          completed += 1;
          await this.repository.updateMaintenanceRun(id, { result: { completedTables: completed, totalTables: tables.length } });
        }
        await this.repository.updateMaintenanceRun(id, { runStatus: "completed", completedAt: new Date(), result: { completedTables: completed } });
      } else if (run.operation === "import" && run.dataset && run.tempObjectKey) {
        const result = await this.importFromOss(id, run.dataset, run.tempObjectKey);
        await this.repository.updateMaintenanceRun(id, {
          runStatus: "completed",
          completedAt: new Date(),
          insertedCount: result.insertedCount,
          skippedCount: result.skippedCount,
          failedCount: result.failedCount,
          result,
        });
      } else {
        throw new BadRequestError("Invalid maintenance task");
      }
    } catch (error) {
      await this.repository.updateMaintenanceRun(id, { runStatus: "failed", completedAt: new Date(), errorMessage: String(error instanceof Error ? error.message : error) });
      logger.error("Data maintenance task failed", { id, error: String(error) });
    } finally {
      if (run.tempObjectKey) {
        try {
          await this.getOssClient().delete(run.tempObjectKey);
        } catch (error) {
          logger.warn("Failed to delete maintenance temporary object", { key: run.tempObjectKey, error: String(error) });
        }
      }
    }
  }

  private async importFromOss(runId: string, dataset: string, objectKey: string) {
    assertDataset(dataset);
    const result = await this.getOssClient().get(objectKey);
    const buffer = Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content as Uint8Array);
    const preview = await this.previewImport(dataset, buffer);
    if (!preview.executable) throw new BadRequestError("Archive is no longer valid");
    const delegate = (this.repository as any).getDatasetDelegate(dataset);
    if (!delegate) throw new BadRequestError("Unsupported archive dataset");
    let insertedCount = 0;
    for (let offset = 0; offset < preview.rows.length; offset += IMPORT_BATCH_SIZE) {
      const batch = preview.rows.slice(offset, offset + IMPORT_BATCH_SIZE);
      const created = await delegate.createMany({ data: batch, skipDuplicates: true });
      insertedCount += created.count;
      await this.repository.updateMaintenanceRun(runId, {
        insertedCount,
        skippedCount: offset + batch.length - insertedCount,
      });
    }
    return { totalCount: preview.totalCount, insertedCount, skippedCount: preview.totalCount - insertedCount, failedCount: 0 };
  }

  private async countMissingForeignKeys(dataset: string, rows: Array<Record<string, unknown>>): Promise<number> {
    const repository = this.repository as any;
    if (dataset === "relay_usages") {
      const ids = [...new Set(rows.map((row) => row.relayTokenId).filter((value): value is string => typeof value === "string"))];
      const set = await this.findExistingIds(repository.getDelegateByName("relayToken"), ids);
      const logicalIds = [...new Set(rows.map((row) => row.logicalRequestId).filter((value): value is string => typeof value === "string"))];
      const logicalSet = await this.findExistingIds(repository.getDelegateByName("relayLogicalRequest"), logicalIds);
      return rows.filter(
        (row) =>
          typeof row.relayTokenId !== "string" ||
          !set.has(row.relayTokenId) ||
          (row.logicalRequestId !== null && row.logicalRequestId !== undefined &&
            (typeof row.logicalRequestId !== "string" || !logicalSet.has(row.logicalRequestId))),
      ).length;
    }
    if (dataset === "monthly_pass_usages") {
      const ids = [...new Set(rows.map((row) => row.userMonthlyPassId).filter((value): value is string => typeof value === "string"))];
      const set = await this.findExistingIds(repository.getDelegateByName("userMonthlyPass"), ids);
      return rows.filter((row) => typeof row.userMonthlyPassId !== "string" || !set.has(row.userMonthlyPassId)).length;
    }
    return 0;
  }

  private async findExistingIds(delegate: any, ids: string[]): Promise<Set<string>> {
    const result = new Set<string>();
    if (!delegate || ids.length === 0) return result;
    for (let offset = 0; offset < ids.length; offset += 1000) {
      const rows = await delegate.findMany({ where: { id: { in: ids.slice(offset, offset + 1000) } }, select: { id: true } });
      for (const row of rows as Array<{ id: string }>) result.add(row.id);
    }
    return result;
  }

  private getOssClient(): OSS {
    if (this.ossClient) return this.ossClient;
    this.ossClient = createObjectStorageClient(env.integrations.objectStorage.staging, "staging");
    return this.ossClient;
  }
}
