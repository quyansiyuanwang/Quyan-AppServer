import { z } from "zod";

const slugRegex = /^[a-z0-9_-]+$/;

export const jsonEndpointIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const publicJsonSlugParamsSchema = z.object({
  slug: z.string().trim().min(1).max(100).regex(slugRegex),
});

export const createJsonEndpointBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(1).max(100).regex(slugRegex),
  description: z.string().max(500).optional(),
  jsonContent: z.unknown(),
  isPublic: z.coerce.boolean(),
  password: z.string().min(4).max(100).optional(),
});

export const updateJsonEndpointBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  jsonContent: z.unknown().optional(),
  isPublic: z.coerce.boolean().optional(),
  password: z.string().min(4).max(100).optional(),
});
