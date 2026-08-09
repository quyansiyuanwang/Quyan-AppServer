export type DataMaintenanceOperation = "optimize" | "import";
export type DataMaintenanceRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface OptimizeRequest {
  datasets: string[];
  confirmation: string;
  captchaToken?: string;
}

export interface OptimizePreviewItem {
  dataset: string;
  tableName: string;
  rowCount: number;
  dataBytes: number;
  indexBytes: number;
  executable: boolean;
}

export interface OptimizePreviewResponse {
  items: OptimizePreviewItem[];
  totalRows: number;
  totalBytes: number;
}

export interface DataMaintenanceImportPreviewResponse {
  dataset: string;
  totalCount: number;
  newCount: number;
  duplicateCount: number;
  invalidCount: number;
  missingForeignKeyCount: number;
  executable: boolean;
  errors: string[];
}

export interface DataMaintenanceRunDTO {
  id: string;
  operation: string;
  dataset: string | null;
  tableNames: unknown;
  runStatus: string;
  startedByUserId: string | null;
  requestId: string | null;
  totalCount: number;
  insertedCount: number;
  skippedCount: number;
  invalidCount: number;
  failedCount: number;
  errorMessage: string | null;
  result: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  createTime: Date;
}

export interface DataMaintenanceRunListResponse {
  items: DataMaintenanceRunDTO[];
  total: number;
  page: number;
  pageSize: number;
}

