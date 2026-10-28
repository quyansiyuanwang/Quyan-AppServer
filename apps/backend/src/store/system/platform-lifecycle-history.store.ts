import type { IamPrincipal } from "@quyan/shared";
import type { Prisma } from "@prisma/client";
export const LIFECYCLE_RUN_TARGET_SELECT = {
  id: true,
  status: true,
  createTime: true,
  updateTime: true,
  dataset: true,
} as const;
export const LIFECYCLE_ARTIFACT_TARGET_SELECT = { ...LIFECYCLE_RUN_TARGET_SELECT, lifecycleRunId: true } as const;
export const LIFECYCLE_RUN_VIEW_SELECT = {
  ...LIFECYCLE_RUN_TARGET_SELECT,
  runType: true,
  runStatus: true,
  cutoffAt: true,
  candidateCount: true,
  archivedCount: true,
  deletedCount: true,
  errorMessage: true,
  completedAt: true,
} as const;
export const LIFECYCLE_ARTIFACT_VIEW_SELECT = {
  ...LIFECYCLE_ARTIFACT_TARGET_SELECT,
  objectKey: true,
  sha256: true,
  recordCount: true,
  byteSize: true,
  expiresAt: true,
  deletedAt: true,
} as const;
export type LifecycleRunTarget = Prisma.DataLifecycleRunGetPayload<{ select: typeof LIFECYCLE_RUN_TARGET_SELECT }>;
export type LifecycleArtifactTarget = Prisma.ArchiveArtifactGetPayload<{
  select: typeof LIFECYCLE_ARTIFACT_TARGET_SELECT;
}>;
export type LifecycleRunView = Prisma.DataLifecycleRunGetPayload<{ select: typeof LIFECYCLE_RUN_VIEW_SELECT }>;
export type LifecycleArtifactView = Prisma.ArchiveArtifactGetPayload<{ select: typeof LIFECYCLE_ARTIFACT_VIEW_SELECT }>;
export interface PlatformLifecycleHistoryStore {
  scanRuns(principal: IamPrincipal, after?: string): Promise<LifecycleRunTarget[]>;
  targetRun(principal: IamPrincipal, id: string): Promise<LifecycleRunTarget | null>;
  checkRuns(principal: IamPrincipal, targets: readonly LifecycleRunTarget[]): Promise<LifecycleRunTarget[]>;
  hydrateRuns(principal: IamPrincipal, targets: readonly LifecycleRunTarget[]): Promise<LifecycleRunView[]>;
  scanArtifacts(principal: IamPrincipal, run: LifecycleRunTarget, after?: string): Promise<LifecycleArtifactTarget[]>;
  checkArtifacts(
    principal: IamPrincipal,
    run: LifecycleRunTarget,
    targets: readonly LifecycleArtifactTarget[],
  ): Promise<LifecycleArtifactTarget[]>;
  hydrateArtifacts(
    principal: IamPrincipal,
    run: LifecycleRunTarget,
    targets: readonly LifecycleArtifactTarget[],
  ): Promise<LifecycleArtifactView[]>;
}

export type LifecycleDownloadTarget = LifecycleArtifactTarget & { lifecycleRun: LifecycleRunTarget };
export interface PlatformLifecycleDownloadStore {
  targetDownload(principal: IamPrincipal, id: string): Promise<LifecycleDownloadTarget | null>;
  checkRuns(principal: IamPrincipal, targets: readonly LifecycleRunTarget[]): Promise<LifecycleRunTarget[]>;
  checkArtifacts(
    principal: IamPrincipal,
    run: LifecycleRunTarget,
    targets: readonly LifecycleArtifactTarget[],
  ): Promise<LifecycleArtifactTarget[]>;
  hydrateArtifacts(
    principal: IamPrincipal,
    run: LifecycleRunTarget,
    targets: readonly LifecycleArtifactTarget[],
  ): Promise<LifecycleArtifactView[]>;
}
