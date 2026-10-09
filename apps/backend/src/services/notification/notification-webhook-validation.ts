import {
  createNotificationWebhookBodySchema,
  updateNotificationWebhookBodySchema,
} from "@/api/schema/notification/notification.schema";
import { BadRequestError } from "@/util/errors";
const invalid = () =>
  new BadRequestError("Invalid notification webhook input", undefined, { messageKey: "errors.validationFailed" });
/** HTTP and internal inputs share one whitelist. No caller identity, preference, or lifecycle fields survive. */
export function normalizeNotificationWebhookCreate(input: unknown) {
  const parsed = createNotificationWebhookBodySchema.safeParse(input);
  if (!parsed.success) throw invalid();
  return { ...parsed.data, secret: parsed.data.secret ?? null, enabled: parsed.data.enabled ?? true };
}
export function normalizeNotificationWebhookUpdate(input: unknown) {
  const parsed = updateNotificationWebhookBodySchema.safeParse(input);
  if (!parsed.success) throw invalid();
  return parsed.data;
}
