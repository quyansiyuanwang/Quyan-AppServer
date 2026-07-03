import { z } from "zod";

const optionalTrimmedString = z.string().trim().min(1).optional();
const optionalUrlString = z.union([z.string().trim().url().max(500), z.literal(""), z.undefined()]).optional();

export const authCenterAuthorizeQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().trim().min(1).max(255),
  redirect_uri: z.string().trim().url().max(500),
  scope: z.string().trim().max(2000).optional(),
  state: z.string().trim().max(2000).optional(),
  code_challenge: z.string().trim().min(1).max(255).optional(),
  code_challenge_method: z.enum(["S256", "plain"]).optional(),
  nonce: z.string().trim().max(500).optional(),
});

export const authCenterAuthorizeDecisionBodySchema = authCenterAuthorizeQuerySchema.extend({
  approve: z.boolean(),
});

export const authCenterTokenBodySchema = z.object({
  grant_type: z.enum(["authorization_code", "refresh_token", "client_credentials"]),
  code: optionalTrimmedString,
  redirect_uri: optionalUrlString,
  client_id: optionalTrimmedString,
  client_secret: optionalTrimmedString,
  code_verifier: optionalTrimmedString,
  refresh_token: optionalTrimmedString,
  scope: z.string().trim().max(2000).optional(),
});

export const authCenterRevokeBodySchema = z.object({
  token: z.string().trim().min(1),
  client_id: optionalTrimmedString,
  client_secret: optionalTrimmedString,
  token_type_hint: z.enum(["access_token", "refresh_token"]).optional(),
});
