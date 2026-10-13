import type { Prisma } from "@prisma/client";
export const PLATFORM_ERROR_GROUP_TARGET_SELECT = { id: true, status: true, updateTime: true } as const;
export type PlatformErrorGroupReadTarget = Prisma.ErrorGroupGetPayload<{
  select: typeof PLATFORM_ERROR_GROUP_TARGET_SELECT;
}>;
export interface PlatformErrorGroupReadStore {
  target(id: string): Promise<PlatformErrorGroupReadTarget | null>;
}
