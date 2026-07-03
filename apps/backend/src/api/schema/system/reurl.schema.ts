import { z } from "zod";

export const generateReURLBodySchema = z.object({
  ttl: z.coerce.number().int().min(1).max(3600).optional(),
  token: z.string().max(2000).optional(),
});
