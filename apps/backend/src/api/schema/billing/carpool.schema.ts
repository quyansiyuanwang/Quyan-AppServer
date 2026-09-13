import { z } from "zod";
const id = z.string().trim().min(1).max(50);
const ratio = z.coerce.number().min(0).max(100);
const page = z.coerce.number().int().min(1).optional();
const pageSize = z.coerce.number().int().min(1).max(100).optional();

export const createCarpoolPackageTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  salePrice: z.coerce.number().positive(),
  upstreamCost: z.coerce.number().min(0),
  maxMembers: z.coerce.number().int().min(1).max(100),
  formationDeadlineHours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(72),
  monthlyPassTemplateId: id,
});
export const updateCarpoolPackageTemplateBodySchema = createCarpoolPackageTemplateBodySchema;
export const carpoolPageQuerySchema = z.object({
  page,
  pageSize,
  keyword: z.string().trim().max(100).optional(),
  orderId: id.optional(),
  state: z.enum(["open", "submitted", "accepted", "fulfilled", "failed", "cancelled", "expired"]).optional(),
  publishStatus: z.enum(["draft", "published"]).optional(),
});
export const createCarpoolOrderBodySchema = z.object({ packageTemplateId: id });
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
  allocationMode: z.enum(["equal", "custom"]).optional(),
  // Equal allocation ignores client ratios and recalculates every active member.
  members: z
    .array(z.object({ memberId: id, paymentRatio: ratio, quotaRatio: ratio }))
    .min(1)
    .max(100)
    .optional(),
});
export const fulfillCarpoolOrderBodySchema = z.object({ relayChannelId: id });
export const failCarpoolOrderBodySchema = z.object({ reason: z.string().trim().min(1).max(1000) });
export const carpoolIdParamsSchema = z.object({ id });
