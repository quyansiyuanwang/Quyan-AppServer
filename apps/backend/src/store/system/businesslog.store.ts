import type { BusinessLog, Prisma } from "@prisma/client";
import type { OperationCategory, OperationType } from "@/constant/operation-type";

export type BusinessLogStatsRow = Pick<
  BusinessLog,
  "createTime" | "operationType" | "operationCategory" | "actorUserId" | "targetUserId" | "success" | "ipAddress"
>;

export interface CreateBusinessLogParams {
  operationType: OperationType;
  operationCategory: OperationCategory;
  actorUserId?: string;
  targetUserId?: string;
  targetResourceId?: string;
  targetResourceType?: string;
  description: string;
  changes?: any;
  metadata?: any;
  success: boolean;
  errorMessage?: string;
  requestId?: string;
  ipAddress: string;
  userAgent?: string;
}

export interface QueryBusinessLogParams {
  page: number;
  pageSize: number;
  operationType?: OperationType;
  operationCategory?: OperationCategory;
  actorUserId?: string;
  actor?: string;
  targetUserId?: string;
  target?: string;
  startDate?: Date;
  endDate?: Date;
  success?: boolean;
  ip?: string;
}

export interface QueryBusinessLogResult {
  logs: BusinessLog[];
  total: number;
}

export interface BusinessLogStore {
  create(params: CreateBusinessLogParams): Promise<BusinessLog>;
  query(params: QueryBusinessLogParams): Promise<QueryBusinessLogResult>;
  listForStats(params: Omit<QueryBusinessLogParams, "page" | "pageSize">): Promise<BusinessLogStatsRow[]>;
  findById(id: string): Promise<BusinessLog | null>;
  findFirst(where: Prisma.BusinessLogWhereInput): Promise<BusinessLog | null>;
  findMany(
    where: Prisma.BusinessLogWhereInput,
    options?: {
      orderBy?: Prisma.BusinessLogOrderByWithRelationInput | Prisma.BusinessLogOrderByWithRelationInput[];
      skip?: number;
      take?: number;
    },
  ): Promise<BusinessLog[]>;
  count(where: Prisma.BusinessLogWhereInput): Promise<number>;
  findRecentSuccessfulOperation(
    actorUserId: string,
    operationType: OperationType,
    since: Date,
  ): Promise<BusinessLog | null>;
  deleteOldLogs(daysToKeep?: number): Promise<number>;
}
