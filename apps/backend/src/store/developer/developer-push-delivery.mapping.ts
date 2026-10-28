import type { DeveloperPushDelivery, Prisma } from "@prisma/client";
import type { DeveloperPushDeliveryDto } from "@/api/dto/developer/developer.dto";
/** Explicit select excludes payloads, credentials and untrusted provider error text before rows reach IAM filtering. */
export const pushDeliveryMetadataSelect = {
  id: true,
  projectId: true,
  channelId: true,
  deliveryStatus: true,
  attemptCount: true,
  nextRetryAt: true,
  createTime: true,
  updateTime: true,
} satisfies Prisma.DeveloperPushDeliverySelect;
export type PushDeliveryMetadata = Pick<
  DeveloperPushDelivery,
  "id" | "channelId" | "deliveryStatus" | "attemptCount" | "nextRetryAt" | "createTime" | "updateTime"
>;
/** Every response path exposes only stable metadata; historical/provider error text is never reflected. */
export function toDeveloperPushDeliveryDto(delivery: PushDeliveryMetadata): DeveloperPushDeliveryDto {
  return {
    id: delivery.id,
    channelId: delivery.channelId,
    success: delivery.deliveryStatus === "success",
    failureReason: delivery.deliveryStatus === "failed" ? "dispatch_failed" : undefined,
    status: delivery.deliveryStatus,
    attemptCount: delivery.attemptCount,
    nextRetryAt: delivery.nextRetryAt?.toISOString(),
    createTime: delivery.createTime.toISOString(),
    updateTime: delivery.updateTime.toISOString(),
  };
}
