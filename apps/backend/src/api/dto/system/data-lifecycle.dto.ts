export interface UpdateDataLifecyclePolicyRequest {
  enabled: boolean;
  hotRetentionDays: number;
}

export interface DataLifecyclePolicyDTO {
  id: string;
  dataset: string;
  enabled: boolean;
  hotRetentionDays: number;
  archiveRetentionDays: number;
  lastRunAt: Date | null;
  candidateCount: number;
}

export interface DataLifecycleScheduleDTO {
  enabled: boolean;
  time: string;
  timezone: string;
}

export interface UpdateDataLifecycleScheduleRequest {
  enabled: boolean;
  time: string;
}

export interface DataLifecyclePreviewResponse {
  dataset: string;
  cutoffAt: Date;
  candidateCount: number;
  enabled: boolean;
}

export interface DataLifecycleCandidateDTO {
  id: string;
  createTime: Date;
  summary: string;
}

export interface DataLifecycleCandidateListResponse {
  dataset: string;
  cutoffAt: Date;
  candidateCount: number;
  items: DataLifecycleCandidateDTO[];
  page: number;
  pageSize: number;
}

export interface DataLifecycleRunDTO {
  id: string;
  dataset: string;
  runType: string;
  runStatus: string;
  cutoffAt: Date;
  candidateCount: number;
  archivedCount: number;
  deletedCount: number;
  errorMessage: string | null;
  completedAt: Date | null;
  createTime: Date;
  artifactCount: number;
}

export interface DataLifecycleRunListResponse {
  items: DataLifecycleRunDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ArchiveDownloadResponse {
  url: string;
  expiresInSeconds: number;
}

export interface ArchiveArtifactDTO {
  id: string;
  objectKey: string;
  sha256: string;
  recordCount: number;
  byteSize: string;
  createTime: Date;
  expiresAt: Date;
  deletedAt: Date | null;
}

export interface ArchiveArtifactListResponse {
  items: ArchiveArtifactDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DataLifecycleRunResultResponse {
  runId: string;
  candidateCount: number;
  archivedCount: number;
  deletedCount: number;
  artifactId?: string;
}

export interface BatchDataLifecycleRunRequest {
  datasets?: string[];
}

export interface BatchDataLifecycleRunItem {
  dataset: string;
  runId?: string;
  status: "completed" | "failed" | "skipped";
  candidateCount: number;
  archivedCount: number;
  deletedCount: number;
  errorMessage?: string;
}

export interface BatchDataLifecycleRunResponse {
  items: BatchDataLifecycleRunItem[];
  completedCount: number;
  failedCount: number;
  skippedCount: number;
}
