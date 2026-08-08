import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";

export const DATA_LIFECYCLE_DATASETS = [
  "api_logs",
  "business_logs",
  "notification_logs",
  "track_events",
  "heatmap_points",
  "relay_usages",
  "monthly_pass_usages",
  "server_logs",
] as const;

export type DataLifecycleDataset = (typeof DATA_LIFECYCLE_DATASETS)[number];

export const DATA_LIFECYCLE_DEFAULTS: Record<DataLifecycleDataset, number> = {
  api_logs: 90,
  business_logs: 180,
  notification_logs: 90,
  track_events: 30,
  heatmap_points: 30,
  relay_usages: 180,
  monthly_pass_usages: 180,
  server_logs: 14,
};

type DatabaseLifecycleDataset = Exclude<DataLifecycleDataset, "server_logs">;

const dataSetDelegates: Record<DatabaseLifecycleDataset, string> = {
  api_logs: "aPILog",
  business_logs: "businessLog",
  notification_logs: "notificationLog",
  track_events: "trackEvent",
  heatmap_points: "heatmapPoint",
  relay_usages: "relayUsage",
  monthly_pass_usages: "monthlyPassUsage",
};

export interface ErrorGroupQuery {
  page: number;
  pageSize: number;
  resolutionStatus?: string;
  source?: string;
  search?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface CreateErrorOccurrenceInput {
  fingerprint: string;
  source: string;
  errorType: string;
  message: string;
  route?: string;
  severity: string;
  userId?: string;
  requestId?: string;
  httpMethod?: string;
  httpStatus?: number;
  clientVersion?: string;
  userAgent?: string;
  ipAddress?: string;
  stack?: string;
  context?: Prisma.InputJsonValue;
}

export class ObservabilityRepository {
  private static instance: ObservabilityRepository;

  public static getInstance(): ObservabilityRepository {
    if (!this.instance) this.instance = new ObservabilityRepository();
    return this.instance;
  }

  public async createErrorOccurrence(input: CreateErrorOccurrenceInput) {
    return prisma.$transaction(async (tx) => {
      const previousUserOccurrence = input.userId
        ? await tx.errorOccurrence.findFirst({
            where: { userId: input.userId, errorGroup: { fingerprint: input.fingerprint } },
          })
        : null;
      const group = await tx.errorGroup.upsert({
        where: { fingerprint: input.fingerprint },
        create: {
          fingerprint: input.fingerprint,
          source: input.source,
          errorType: input.errorType,
          message: input.message,
          route: input.route,
          severity: input.severity,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          affectedUserCount: input.userId ? 1 : 0,
        },
        update: {
          lastSeenAt: new Date(),
          occurrenceCount: { increment: 1 },
          route: input.route,
          severity: input.severity,
          ...(input.userId && !previousUserOccurrence ? { affectedUserCount: { increment: 1 } } : {}),
        },
      });
      const occurrence = await tx.errorOccurrence.create({
        data: {
          errorGroupId: group.id,
          userId: input.userId,
          requestId: input.requestId,
          source: input.source,
          route: input.route,
          httpMethod: input.httpMethod,
          httpStatus: input.httpStatus,
          clientVersion: input.clientVersion,
          userAgent: input.userAgent,
          ipAddress: input.ipAddress,
          stack: input.stack,
          context: input.context,
        },
      });
      return { group, occurrence };
    });
  }

  public async queryErrorGroups(query: ErrorGroupQuery) {
    const where: Prisma.ErrorGroupWhereInput = {};
    if (query.resolutionStatus) where.resolutionStatus = query.resolutionStatus;
    if (query.source) where.source = query.source;
    if (query.search)
      where.OR = [
        { message: { contains: query.search } },
        { errorType: { contains: query.search } },
        { route: { contains: query.search } },
        { fingerprint: { contains: query.search } },
      ];
    if (query.startDate || query.endDate)
      where.lastSeenAt = {
        ...(query.startDate ? { gte: query.startDate } : {}),
        ...(query.endDate ? { lte: query.endDate } : {}),
      };

    const [items, total] = await Promise.all([
      prisma.errorGroup.findMany({
        where,
        orderBy: { lastSeenAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.errorGroup.count({ where }),
    ]);
    return { items, total };
  }

  public getErrorGroup(id: string) {
    return prisma.errorGroup.findUnique({ where: { id } });
  }

  public updateErrorGroupStatus(id: string, resolutionStatus: string) {
    return prisma.errorGroup.update({ where: { id }, data: { resolutionStatus } });
  }

  public async listErrorOccurrences(errorGroupId: string, page: number, pageSize: number) {
    const where = { errorGroupId };
    const [items, total] = await Promise.all([
      prisma.errorOccurrence.findMany({
        where,
        orderBy: { createTime: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.errorOccurrence.count({ where }),
    ]);
    return { items, total };
  }

  public async deleteErrorsBefore(cutoffAt: Date): Promise<number> {
    const result = await prisma.errorGroup.deleteMany({ where: { lastSeenAt: { lt: cutoffAt } } });
    return result.count;
  }

  public async ensureLifecyclePolicies() {
    await Promise.all(
      DATA_LIFECYCLE_DATASETS.map((dataset) =>
        prisma.dataLifecyclePolicy.upsert({
          where: { dataset },
          create: { dataset, hotRetentionDays: DATA_LIFECYCLE_DEFAULTS[dataset] },
          update: {},
        }),
      ),
    );
  }

  public listLifecyclePolicies() {
    return prisma.dataLifecyclePolicy.findMany({ orderBy: { dataset: "asc" } });
  }

  public updateLifecyclePolicy(
    dataset: DataLifecycleDataset,
    data: { enabled: boolean; hotRetentionDays: number; lastRunAt?: Date },
  ) {
    return prisma.dataLifecyclePolicy.update({ where: { dataset }, data });
  }

  public getLifecyclePolicy(dataset: DataLifecycleDataset) {
    return prisma.dataLifecyclePolicy.findUnique({ where: { dataset } });
  }

  public countDatasetBefore(dataset: DatabaseLifecycleDataset, cutoffAt: Date): Promise<number> {
    const delegate = prisma[dataSetDelegates[dataset] as keyof typeof prisma] as any;
    return delegate.count({ where: { createTime: { lt: cutoffAt } } });
  }

  public listDatasetBatch(
    dataset: DatabaseLifecycleDataset,
    cutoffAt: Date,
    take: number,
  ): Promise<Array<Record<string, unknown>>> {
    const delegate = prisma[dataSetDelegates[dataset] as keyof typeof prisma] as any;
    return delegate.findMany({ where: { createTime: { lt: cutoffAt } }, orderBy: { createTime: "asc" }, take });
  }

  public deleteDatasetIds(dataset: DatabaseLifecycleDataset, ids: string[]): Promise<number> {
    const delegate = prisma[dataSetDelegates[dataset] as keyof typeof prisma] as any;
    return delegate.deleteMany({ where: { id: { in: ids } } }).then((result: { count: number }) => result.count);
  }

  public createLifecycleRun(input: {
    policyId?: string;
    dataset: DataLifecycleDataset;
    runType: string;
    cutoffAt: Date;
    startedByUserId?: string;
  }) {
    return prisma.dataLifecycleRun.create({ data: input });
  }

  public updateLifecycleRun(id: string, data: Prisma.DataLifecycleRunUpdateInput) {
    return prisma.dataLifecycleRun.update({ where: { id }, data });
  }

  public createArchiveArtifact(input: {
    lifecycleRunId: string;
    dataset: DataLifecycleDataset;
    objectKey: string;
    sha256: string;
    recordCount: number;
    byteSize: bigint;
    expiresAt: Date;
  }) {
    return prisma.archiveArtifact.create({ data: input });
  }

  public listLifecycleRuns(page: number, pageSize: number) {
    return Promise.all([
      prisma.dataLifecycleRun.findMany({
        orderBy: { createTime: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { artifacts: true },
      }),
      prisma.dataLifecycleRun.count(),
    ]).then(([items, total]) => ({ items, total }));
  }

  public getArchiveArtifact(id: string) {
    return prisma.archiveArtifact.findUnique({ where: { id } });
  }

  public listExpiredArchiveArtifacts(now: Date) {
    return prisma.archiveArtifact.findMany({ where: { expiresAt: { lt: now }, deletedAt: null } });
  }

  public markArchiveArtifactDeleted(id: string) {
    return prisma.archiveArtifact.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
