import type { Prisma } from "@prisma/client";
export const PLATFORM_AI_LOG_TARGET_SELECT = { id: true, status: true, updateTime: true } as const;
export type PlatformAiLogReadTarget = Prisma.AIRequestLogGetPayload<{ select: typeof PLATFORM_AI_LOG_TARGET_SELECT }>;
export interface PlatformAiRequestLogReadStore {
  target(id: string): Promise<PlatformAiLogReadTarget | null>;
}

export const PLATFORM_AI_LOG_COLLECTION_SELECT = { ...PLATFORM_AI_LOG_TARGET_SELECT, createTime: true } as const;
export type PlatformAiLogCollectionTarget = Prisma.AIRequestLogGetPayload<{
  select: typeof PLATFORM_AI_LOG_COLLECTION_SELECT;
}>;
export type PlatformAiLogCollectionCursor = Pick<PlatformAiLogCollectionTarget, "id" | "createTime">;
export interface PlatformAiRequestLogCollectionStore {
  scan(
    query: import("./ai-request-log.store").AIRequestLogQuery,
    after?: PlatformAiLogCollectionCursor,
    boundary?: PlatformAiLogCollectionCursor,
  ): Promise<PlatformAiLogCollectionTarget[]>;
  hydrate(
    targets: readonly PlatformAiLogCollectionTarget[],
  ): Promise<import("./ai-request-log.store").AIRequestLogListItem[]>;
}
