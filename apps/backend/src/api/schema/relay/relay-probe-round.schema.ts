import { z } from "zod";
export const saveProbeDailyScheduleSchema = z
  .object({
    enabled: z.boolean(),
    minuteOfDay: z.number().int().min(0).max(1439),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export const probeRoundPageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
