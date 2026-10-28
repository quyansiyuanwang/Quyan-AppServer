import type { Prisma } from "@prisma/client";
import type { DataLifecycleDataset } from "@/constant/data-maintenance-datasets";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export type LifecycleExecutionAction = "quyan:system:data_lifecycle:RunPolicy" | "quyan:system:data_lifecycle:RunBatch";
export type LifecycleExecutionPolicy = Prisma.DataLifecyclePolicyGetPayload<Record<string, never>>;
export interface LifecycleExecutionGuard {
  action: LifecycleExecutionAction;
  dataset: DataLifecycleDataset;
  policy: LifecycleExecutionPolicy;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  recheck(): Promise<void>;
}
export interface LifecycleArchiveInput {
  lifecycleRunId: string;
  dataset: DataLifecycleDataset;
  objectKey: string;
  sha256: string;
  recordCount: number;
  byteSize: bigint;
  expiresAt: Date | null;
}
export interface PlatformLifecycleExecutionStore {
  policy(dataset: DataLifecycleDataset): Promise<LifecycleExecutionPolicy | null>;
  policies(): Promise<LifecycleExecutionPolicy[]>;
  start(
    guard: LifecycleExecutionGuard,
    cutoffAt: Date,
    candidateCount: number,
  ): Promise<Prisma.DataLifecycleRunGetPayload<Record<string, never>>>;
  commitArchive(
    guard: LifecycleExecutionGuard,
    artifact: LifecycleArchiveInput,
    records: readonly Record<string, unknown>[],
  ): Promise<{ artifact: Prisma.ArchiveArtifactGetPayload<Record<string, never>>; deletedCount: number }>;
  complete(guard: LifecycleExecutionGuard, runId: string): Promise<LifecycleExecutionPolicy>;
  fail(guard: LifecycleExecutionGuard, runId: string): Promise<void>;
  recordExternalDeletion(guard: LifecycleExecutionGuard, runId: string): Promise<void>;
}
