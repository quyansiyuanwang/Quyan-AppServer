import { z } from "zod";

const slugRegex = /^[a-z0-9_-]+$/;

export const articleIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const articleSlugParamsSchema = z.object({
  slug: z.string().trim().min(1).max(200).regex(slugRegex),
});

export const createArticleBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(200).regex(slugRegex),
  category: z.string().max(100).optional(),
  summary: z.string().max(500).optional(),
  content: z.string().min(1),
  isPublic: z.boolean().optional(),
  requirePermission: z.string().max(100).optional(),
});

export const updateArticleBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().min(1).max(200).regex(slugRegex).optional(),
  category: z.string().max(100).optional(),
  summary: z.string().max(500).optional(),
  content: z.string().optional(),
  isPublic: z.boolean().optional(),
  requirePermission: z.string().max(100).optional(),
});

const reorderArticleItemSchema = z.object({
  id: z.string().trim().min(1),
  sortOrder: z.coerce.number().int().min(0),
});

export const reorderArticlesBodySchema = z.object({
  items: z.array(reorderArticleItemSchema).min(1).max(500),
});
