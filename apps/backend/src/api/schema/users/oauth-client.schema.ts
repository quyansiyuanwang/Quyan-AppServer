import { z } from "zod";

const oauthClientTypeSchema = z.enum(["confidential", "public"]);
export const oauthClientReviewStatusSchema = z.enum(["draft", "pending", "approved", "rejected"]);
const oauthClientReviewDecisionSchema = z.enum(["approved", "rejected"]);

const trimmedOptionalUrlSchema = z.union([z.string().trim().url().max(500), z.literal(""), z.null()]).optional();

const scopeSchema = z.string().trim().min(1).max(100);

export const oauthClientIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const oauthClientReviewListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(999999).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  reviewStatus: oauthClientReviewStatusSchema.optional(),
  keyword: z.string().trim().max(200).optional(),
});

export const createOAuthClientBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).optional(),
  redirectUris: z.array(z.string().trim().url().max(500)).min(1).max(20),
  scopes: z.array(scopeSchema).max(50).optional(),
  homepageUrl: trimmedOptionalUrlSchema,
  logoUrl: trimmedOptionalUrlSchema,
  policyUrl: trimmedOptionalUrlSchema,
  tosUrl: trimmedOptionalUrlSchema,
  clientType: oauthClientTypeSchema.optional(),
});

export const updateOAuthClientBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.union([z.string().trim().max(2000), z.literal(""), z.null()]).optional(),
  redirectUris: z.array(z.string().trim().url().max(500)).min(1).max(20).optional(),
  scopes: z.array(scopeSchema).max(50).optional(),
  homepageUrl: trimmedOptionalUrlSchema,
  logoUrl: trimmedOptionalUrlSchema,
  policyUrl: trimmedOptionalUrlSchema,
  tosUrl: trimmedOptionalUrlSchema,
  clientType: oauthClientTypeSchema.optional(),
});

export const reviewOAuthClientBodySchema = z.object({
  reviewStatus: oauthClientReviewDecisionSchema,
  reviewComment: z.union([z.string().trim().max(2000), z.literal(""), z.null()]).optional(),
});
