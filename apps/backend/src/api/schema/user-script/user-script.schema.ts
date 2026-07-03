import { z } from "zod";

export const userScriptIdParamsSchema = z.object({ id: z.string().trim().min(1) });

export const createUserScriptBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  content: z.string().min(1),
});

export const updateUserScriptBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  content: z.string().min(1).optional(),
});
