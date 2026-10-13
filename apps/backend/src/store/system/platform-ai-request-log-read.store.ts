import type { Prisma } from "@prisma/client";
export const PLATFORM_AI_LOG_TARGET_SELECT = { id: true, status: true, updateTime: true } as const;
export type PlatformAiLogReadTarget = Prisma.AIRequestLogGetPayload<{ select: typeof PLATFORM_AI_LOG_TARGET_SELECT }>;
export interface PlatformAiRequestLogReadStore {
  target(id: string): Promise<PlatformAiLogReadTarget | null>;
}
