import { z } from "zod";

export const passkeyRegistrationVerifyBodySchema = z.object({
  response: z.record(z.string(), z.unknown()),
  name: z.string().max(100).optional(),
});

export const passkeyAuthVerifyBodySchema = z.object({
  sessionId: z.string().min(1).max(200),
  agreedToLegalPolicies: z.literal(true),
  response: z.record(z.string(), z.unknown()),
});

export const passkeyCredentialIdParamsSchema = z.object({
  credentialId: z.string().trim().min(1),
});
