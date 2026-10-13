import type { Prisma } from "@prisma/client";
export const PLATFORM_ERROR_GROUP_TARGET_SELECT = { id: true, status: true, updateTime: true } as const;
export type PlatformErrorGroupReadTarget = Prisma.ErrorGroupGetPayload<{
  select: typeof PLATFORM_ERROR_GROUP_TARGET_SELECT;
}>;
export interface PlatformErrorGroupReadStore {
  target(id: string): Promise<PlatformErrorGroupReadTarget | null>;
}

export const PLATFORM_ERROR_GROUP_COLLECTION_SELECT = {
  ...PLATFORM_ERROR_GROUP_TARGET_SELECT,
  lastSeenAt: true,
} as const;
export type PlatformErrorGroupCollectionTarget = Prisma.ErrorGroupGetPayload<{
  select: typeof PLATFORM_ERROR_GROUP_COLLECTION_SELECT;
}>;
export type PlatformErrorGroupCollectionCursor = Pick<PlatformErrorGroupCollectionTarget, "id" | "lastSeenAt">;
export interface PlatformErrorGroupCollectionStore {
  scan(
    query: import("./observability.repository").ErrorGroupQuery,
    after?: PlatformErrorGroupCollectionCursor,
    boundary?: PlatformErrorGroupCollectionCursor,
  ): Promise<PlatformErrorGroupCollectionTarget[]>;
  hydrate(
    targets: readonly PlatformErrorGroupCollectionTarget[],
  ): Promise<Prisma.ErrorGroupGetPayload<Record<string, never>>[]>;
}
