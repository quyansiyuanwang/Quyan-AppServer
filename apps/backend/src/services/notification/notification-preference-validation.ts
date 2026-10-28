import { ALL_NOTIFICATION_EVENTS } from "@quyan/shared";
import { updateNotificationPreferenceBodySchema } from "@/api/schema/notification/notification.schema";
import type { NotificationPreferenceUpdateInput } from "@/store/notification/notification-preference.repository";
import { BadRequestError } from "@/util/errors";

/** One HTTP/internal whitelist; event-version metadata is always owned by the server. */
export function normalizeNotificationPreferenceUpdate(input: unknown): NotificationPreferenceUpdateInput {
  const parsed = updateNotificationPreferenceBodySchema.safeParse(input);
  if (!parsed.success)
    throw new BadRequestError("Invalid notification preference", undefined, {
      messageKey: "errors.validationFailed",
    });
  return {
    ...parsed.data,
    ...(parsed.data.subscribedEvents !== undefined && { knownEvents: [...ALL_NOTIFICATION_EVENTS] }),
  };
}
