import { z } from "zod";

const slugRegex = /^[a-z0-9_-]+$/;

export const jsonEndpointIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const publicJsonSlugParamsSchema = z.object({
  slug: z.string().trim().min(1).max(100).regex(slugRegex),
});

export const publicJsonNamespaceParamsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/),
  slug: z.string().trim().min(1).max(100).regex(slugRegex),
});

export const createJsonEndpointBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(1).max(100).regex(slugRegex),
  description: z.string().max(500).optional(),
  jsonContent: z.unknown(),
  isPublic: z.coerce.boolean(),
  password: z.string().min(4).max(100).optional(),
  ownerUserId: z.string().trim().min(1).optional(),
  isRootSlug: z.coerce.boolean().optional(),
});

export const updateJsonEndpointBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  jsonContent: z.unknown().optional(),
  isPublic: z.coerce.boolean().optional(),
  password: z.string().min(4).max(100).optional(),
  isRootSlug: z.coerce.boolean().optional(),
});
