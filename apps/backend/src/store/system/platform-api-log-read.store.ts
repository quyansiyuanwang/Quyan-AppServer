import type { Prisma } from "@prisma/client";
export const PLATFORM_API_LOG_TARGET_SELECT = { id: true, status: true, updateTime: true } as const;
export type PlatformApiLogReadTarget = Prisma.APILogGetPayload<{ select: typeof PLATFORM_API_LOG_TARGET_SELECT }>;
export interface PlatformApiLogReadStore {
  target(id: string): Promise<PlatformApiLogReadTarget | null>;
}

export const PLATFORM_API_LOG_COLLECTION_SELECT = { ...PLATFORM_API_LOG_TARGET_SELECT, createTime: true } as const;
export type PlatformApiLogCollectionTarget = Prisma.APILogGetPayload<{
  select: typeof PLATFORM_API_LOG_COLLECTION_SELECT;
}>;
export type PlatformApiLogCollectionCursor = Pick<PlatformApiLogCollectionTarget, "id" | "createTime">;
export interface PlatformApiLogCollectionStore {
  where(query: import("./apilog.store").ApiLogFilters): Promise<Prisma.APILogWhereInput | undefined>;
  scan(
    where: Prisma.APILogWhereInput,
    after?: PlatformApiLogCollectionCursor,
    boundary?: PlatformApiLogCollectionCursor,
  ): Promise<PlatformApiLogCollectionTarget[]>;
  hydrate(
    targets: readonly PlatformApiLogCollectionTarget[],
  ): Promise<import("./apilog.store").APILogWithoutResponse[]>;
}

export type PlatformApiLogStatisticsRow = PlatformApiLogCollectionTarget & import("./apilog.store").APILogStatsRow;
export interface PlatformApiLogStatisticsStore extends Pick<PlatformApiLogCollectionStore, "where" | "scan"> {
  hydrateStats(targets: readonly PlatformApiLogCollectionTarget[]): Promise<PlatformApiLogStatisticsRow[]>;
}
