import { createHash } from "crypto";
import { gzipSync } from "zlib";
import OSS from "ali-oss";
import { env } from "@/config/env";
import { getLogger, LogCategory } from "@/util/logger";
import { BadRequestError, NotFoundError } from "@/util/errors";
import {
  DATA_LIFECYCLE_DATASETS,
  ObservabilityRepository,
  type DataLifecycleDataset,
} from "@/store/system/observability.repository";

const logger = getLogger("DataLifecycleService", LogCategory.SYSTEM);
const ARCHIVE_BATCH_SIZE = 1000;

const isDataset = (value: string): value is DataLifecycleDataset =>
  (DATA_LIFECYCLE_DATASETS as readonly string[]).includes(value);

function stringifyArchiveRow(row: Record<string, unknown>): string {
  return JSON.stringify(row, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
}

export class DataLifecycleService {
  private static instance: DataLifecycleService;
  private ossClient: OSS | null = null;

  private constructor(private readonly repository: ObservabilityRepository = ObservabilityRepository.getInstance()) {}

  public static getInstance(): DataLifecycleService {
    if (!this.instance) this.instance = new DataLifecycleService();
    return this.instance;
  }

  public async initialize(): Promise<void> {
    await this.repository.ensureLifecyclePolicies();
  }

  public listPolicies() {
    return this.repository.listLifecyclePolicies();
  }

  public async updatePolicy(dataset: string, enabled: boolean, hotRetentionDays: number) {
    if (!isDataset(dataset)) throw new BadRequestError("Unsupported lifecycle dataset");
    if (!Number.isInteger(hotRetentionDays) || hotRetentionDays < 1 || hotRetentionDays > 3650)
      throw new BadRequestError("hotRetentionDays must be between 1 and 3650");
    return this.repository.updateLifecyclePolicy(dataset, { enabled, hotRetentionDays });
  }

  public async preview(dataset: string) {
    if (!isDataset(dataset)) throw new BadRequestError("Unsupported lifecycle dataset");
    const policy = await this.repository.getLifecyclePolicy(dataset);
    if (!policy) throw new NotFoundError("Lifecycle policy not found");
    const cutoffAt = this.cutoff(policy.hotRetentionDays);
    return {
      dataset,
      cutoffAt,
      candidateCount: await this.repository.countDatasetBefore(dataset, cutoffAt),
      enabled: policy.enabled,
    };
  }

  public async runPolicy(dataset: string, runType: "manual" | "scheduled", startedByUserId?: string) {
    if (!isDataset(dataset)) throw new BadRequestError("Unsupported lifecycle dataset");
    if (!env.integrations.archiveOss.enabled) throw new BadRequestError("Archive OSS is not configured");
    const policy = await this.repository.getLifecyclePolicy(dataset);
    if (!policy) throw new NotFoundError("Lifecycle policy not found");
    if (!policy.enabled && runType === "scheduled") return null;

    const cutoffAt = this.cutoff(policy.hotRetentionDays);
    const candidateCount = await this.repository.countDatasetBefore(dataset, cutoffAt);
    const run = await this.repository.createLifecycleRun({
      policyId: policy.id,
      dataset,
      runType,
      cutoffAt,
      startedByUserId,
    });
    if (candidateCount === 0) {
      await this.repository.updateLifecycleRun(run.id, { runStatus: "completed", completedAt: new Date() });
      return { runId: run.id, candidateCount: 0, archivedCount: 0, deletedCount: 0 };
    }

    try {
      let archivedCount = 0;
      let deletedCount = 0;
      let batchNumber = 0;
      let lastArtifact: Awaited<ReturnType<ObservabilityRepository["createArchiveArtifact"]>> | undefined;
      const client = this.getOssClient();

      // Fetch the oldest remaining rows after each successful deletion. This keeps
      // the export bounded while ensuring a run drains all candidates, even when
      // the dataset is much larger than ARCHIVE_BATCH_SIZE.
      while (true) {
        const records = await this.repository.listDatasetBatch(dataset, cutoffAt, ARCHIVE_BATCH_SIZE);
        if (records.length === 0) break;

        const body = Buffer.from(`${records.map(stringifyArchiveRow).join("\n")}\n`, "utf8");
        const compressed = gzipSync(body, { level: 9 });
        const sha256 = createHash("sha256").update(compressed).digest("hex");
        const objectKey = this.objectKey(dataset, run.id, cutoffAt, batchNumber);
        await client.put(objectKey, compressed, {
          headers: {
            "Content-Type": "application/x-ndjson",
            "Content-Encoding": "gzip",
            "x-oss-meta-sha256": sha256,
          },
        });
        const head = await client.head(objectKey);
        const metadata = (head.res.headers || {}) as Record<string, string | undefined>;
        const uploadedChecksum = metadata["x-oss-meta-sha256"];
        const uploadedLength = Number(metadata["content-length"] || 0);
        if (uploadedChecksum !== sha256 || uploadedLength !== compressed.byteLength)
          throw new Error("Archive object verification failed");

        const ids = records.map((record) => String(record.id)).filter(Boolean);
        if (ids.length === 0) throw new Error("Archive batch contained no identifiable records");
        lastArtifact = await this.repository.createArchiveArtifact({
          lifecycleRunId: run.id,
          dataset,
          objectKey,
          sha256,
          recordCount: ids.length,
          byteSize: BigInt(compressed.byteLength),
          expiresAt: new Date(Date.now() + policy.archiveRetentionDays * 24 * 60 * 60 * 1000),
        });
        const batchDeletedCount = await this.repository.deleteDatasetIds(dataset, ids);
        archivedCount += ids.length;
        deletedCount += batchDeletedCount;
        batchNumber += 1;
        await this.repository.updateLifecycleRun(run.id, { candidateCount, archivedCount, deletedCount });
      }

      await this.repository.updateLifecycleRun(run.id, {
        candidateCount,
        archivedCount,
        deletedCount,
        runStatus: "completed",
        completedAt: new Date(),
      });
      await this.repository.updateLifecyclePolicy(dataset, {
        enabled: policy.enabled,
        hotRetentionDays: policy.hotRetentionDays,
        lastRunAt: new Date(),
      });
      return { runId: run.id, artifact: lastArtifact, candidateCount, archivedCount, deletedCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.updateLifecycleRun(run.id, {
        candidateCount,
        runStatus: "failed",
        errorMessage: message,
        completedAt: new Date(),
      });
      throw error;
    }
  }

  public async runScheduledPolicies(): Promise<void> {
    await this.initialize();
    if (!env.integrations.archiveOss.enabled) {
      logger.info("Data lifecycle archive skipped because OSS is not configured");
      return;
    }
    const policies = await this.repository.listLifecyclePolicies();
    for (const policy of policies)
      if (policy.enabled)
        try {
          await this.runPolicy(policy.dataset, "scheduled");
        } catch (error) {
          logger.error("Scheduled data lifecycle run failed", { dataset: policy.dataset, error: String(error) });
        }
  }

  public listRuns(page: number, pageSize: number) {
    return this.repository.listLifecycleRuns(page, pageSize);
  }

  public async getArchiveDownloadUrl(artifactId: string): Promise<string> {
    if (!env.integrations.archiveOss.enabled) throw new BadRequestError("Archive OSS is not configured");
    const artifact = await this.repository.getArchiveArtifact(artifactId);
    if (!artifact || artifact.deletedAt) throw new NotFoundError("Archive artifact not found");
    return this.getOssClient().signatureUrl(artifact.objectKey, { expires: 300, method: "GET" });
  }

  public async deleteExpiredArtifacts(): Promise<number> {
    if (!env.integrations.archiveOss.enabled) return 0;
    const artifacts = await this.repository.listExpiredArchiveArtifacts(new Date());
    let deleted = 0;
    for (const artifact of artifacts)
      try {
        await this.getOssClient().delete(artifact.objectKey);
        await this.repository.markArchiveArtifactDeleted(artifact.id);
        deleted += 1;
      } catch (error) {
        logger.error("Failed to delete expired archive artifact", { artifactId: artifact.id, error: String(error) });
      }
    return deleted;
  }

  private cutoff(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  private objectKey(dataset: DataLifecycleDataset, runId: string, cutoffAt: Date, batchNumber: number): string {
    const month = cutoffAt.toISOString().slice(0, 7);
    const prefix = env.integrations.archiveOss.prefix;
    return `${prefix}/${dataset}/${month}/${runId}-${batchNumber}.ndjson.gz`;
  }

  private getOssClient(): OSS {
    if (this.ossClient) return this.ossClient;
    const config = env.integrations.archiveOss;
    if (!config.enabled) throw new BadRequestError("Archive OSS is not configured");
    this.ossClient = new OSS({
      region: config.region,
      endpoint: config.endpoint,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      secure: true,
    });
    return this.ossClient;
  }
}
