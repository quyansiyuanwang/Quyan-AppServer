import { z } from "zod";

const authCenterClientTypeSchema = z.enum(["confidential", "public"]);
const authCenterGrantTypeSchema = z.enum(["authorization_code", "refresh_token", "client_credentials"]);
export const authCenterClientReviewStatusSchema = z.enum(["draft", "pending", "approved", "rejected"]);
const authCenterClientReviewDecisionSchema = z.enum(["approved", "rejected"]);

const trimmedOptionalUrlSchema = z.union([z.string().trim().url().max(500), z.literal(""), z.null()]).optional();
const scopeSchema = z.string().trim().min(1).max(100);

export const authCenterClientIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const authCenterClientReviewListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(999999).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  reviewStatus: authCenterClientReviewStatusSchema.optional(),
  keyword: z.string().trim().max(200).optional(),
});

export const createAuthCenterClientBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).optional(),
  redirectUris: z.array(z.string().trim().url().max(500)).max(20).optional(),
  scopes: z.array(scopeSchema).max(50).optional(),
  homepageUrl: trimmedOptionalUrlSchema,
  logoUrl: trimmedOptionalUrlSchema,
  policyUrl: trimmedOptionalUrlSchema,
  tosUrl: trimmedOptionalUrlSchema,
  clientType: authCenterClientTypeSchema.optional(),
  grantTypes: z.array(authCenterGrantTypeSchema).min(1).max(3).optional(),
  isPkceRequired: z.boolean().optional(),
  accessTokenLifetime: z.coerce.number().int().min(60).max(86400).optional(),
  refreshTokenLifetime: z.coerce.number().int().min(300).max(31536000).optional(),
});

export const updateAuthCenterClientBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.union([z.string().trim().max(2000), z.literal(""), z.null()]).optional(),
  redirectUris: z.array(z.string().trim().url().max(500)).max(20).optional(),
  scopes: z.array(scopeSchema).max(50).optional(),
  homepageUrl: trimmedOptionalUrlSchema,
  logoUrl: trimmedOptionalUrlSchema,
  policyUrl: trimmedOptionalUrlSchema,
  tosUrl: trimmedOptionalUrlSchema,
  clientType: authCenterClientTypeSchema.optional(),
  grantTypes: z.array(authCenterGrantTypeSchema).min(1).max(3).optional(),
  isPkceRequired: z.boolean().optional(),
  accessTokenLifetime: z.coerce.number().int().min(60).max(86400).optional(),
  refreshTokenLifetime: z.coerce.number().int().min(300).max(31536000).optional(),
});

export const reviewAuthCenterClientBodySchema = z.object({
  reviewStatus: authCenterClientReviewDecisionSchema,
  reviewComment: z.union([z.string().trim().max(2000), z.literal(""), z.null()]).optional(),
});
