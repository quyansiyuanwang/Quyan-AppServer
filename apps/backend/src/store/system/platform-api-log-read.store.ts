import type { Prisma } from "@prisma/client";
export const PLATFORM_API_LOG_TARGET_SELECT = { id: true, status: true, updateTime: true } as const;
export type PlatformApiLogReadTarget = Prisma.APILogGetPayload<{ select: typeof PLATFORM_API_LOG_TARGET_SELECT }>;
export interface PlatformApiLogReadStore {
  target(id: string): Promise<PlatformApiLogReadTarget | null>;
}
