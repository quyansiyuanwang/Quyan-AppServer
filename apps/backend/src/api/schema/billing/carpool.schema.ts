import { z } from "zod";
const id = z.string().trim().min(1).max(50);
const ratio = z.coerce.number().min(0).max(100);
export const createCarpoolPackageTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).optional(),
  salePrice: z.coerce.number().positive(),
  upstreamCost: z.coerce.number().min(0),
  maxMembers: z.coerce.number().int().min(1).max(100),
  monthlyPassTemplateId: id,
});
export const createCarpoolOrderBodySchema = z.object({
  packageTemplateId: id,
  inviteValidityHours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .optional(),
});
export const createCarpoolInviteBodySchema = z.object({
  validityHours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .optional(),
});
export const acceptCarpoolInviteBodySchema = z.object({ token: z.string().min(24).max(200) });
export const allocateCarpoolRatiosBodySchema = z.object({
  members: z
    .array(z.object({ memberId: id, paymentRatio: ratio, quotaRatio: ratio }))
    .min(1)
    .max(100),
});
export const fulfillCarpoolOrderBodySchema = z.object({ relayChannelId: id });
export const carpoolIdParamsSchema = z.object({ id: id });
