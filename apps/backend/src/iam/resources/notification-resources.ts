import { buildAcsResource } from "@quyan/shared";
export const isCanonicalNotificationId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
export function notificationInboxItemArn(accountOwnerId: string, userId: string, itemId: string): string {
  if (!isCanonicalNotificationId(userId) || !isCanonicalNotificationId(itemId))
    throw new Error("Invalid inbox resource identity");
  return buildAcsResource({
    service: "notification",
    region: "*",
    accountId: accountOwnerId,
    path: "inbox-item/" + userId + "/" + itemId,
  });
}

export function notificationDeliveryLogArn(accountOwnerId: string, userId: string, logId: string): string {
  if (!isCanonicalNotificationId(userId) || !isCanonicalNotificationId(logId))
    throw new Error("Invalid delivery log identity");
  return buildAcsResource({
    service: "notification",
    region: "*",
    accountId: accountOwnerId,
    path: "delivery-log/" + userId + "/" + logId,
  });
}

export function notificationWebhookArn(accountOwnerId: string, userId: string, webhookId: string): string {
  if (!isCanonicalNotificationId(userId) || !isCanonicalNotificationId(webhookId))
    throw new Error("Invalid webhook identity");
  return buildAcsResource({
    service: "notification",
    region: "*",
    accountId: accountOwnerId,
    path: "webhook/" + userId + "/" + webhookId,
  });
}
