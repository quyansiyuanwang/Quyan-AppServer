import type { ResourceResolver } from "./resource-resolvers";
import { notificationWebhookArn, isCanonicalNotificationId } from "../resources/notification-resources";
/** A route target only; the service/storage boundary proves current ownership and preference relation. */
export const notificationWebhookResourceResolver: ResourceResolver = ({ request, principal }) => {
  const id = request.params.id;
  if (!isCanonicalNotificationId(id) || !isCanonicalNotificationId(principal.subjectUserId)) return undefined;
  return notificationWebhookArn(principal.accountOwnerId, principal.subjectUserId, id);
};
