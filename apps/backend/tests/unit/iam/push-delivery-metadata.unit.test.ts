import { describe, expect, it } from "vitest";
import {
  pushDeliveryMetadataSelect,
  toDeveloperPushDeliveryDto,
} from "@/store/developer/developer-push-delivery.mapping";
const record = {
  id: "delivery-fixture",
  channelId: "channel-fixture",
  deliveryStatus: "failed",
  attemptCount: 2,
  nextRetryAt: new Date("2026-01-01T00:01:00Z"),
  createTime: new Date("2026-01-01T00:00:00Z"),
  updateTime: new Date("2026-01-01T00:00:00Z"),
  title: "fixture-private-title",
  content: "fixture-private-content",
  errorMessage: "fixture-private-credential",
  idempotencyKey: "fixture-private-key",
};
describe("Push Delivery metadata privacy", () => {
  it("uses a narrow database projection before IAM filtering", () => {
    for (const field of ["title", "content", "errorMessage", "idempotencyKey", "config", "endpoint"])
      expect(pushDeliveryMetadataSelect).not.toHaveProperty(field);
    expect(pushDeliveryMetadataSelect).not.toHaveProperty("channel");
    expect(pushDeliveryMetadataSelect).not.toHaveProperty("project");
  });
  it("omits raw historical errors and payloads even when the legacy persistence path supplies them", () => {
    const dto = toDeveloperPushDeliveryDto(record);
    expect(dto).toMatchObject({
      id: record.id,
      status: "failed",
      failureReason: "dispatch_failed",
      success: false,
      attemptCount: 2,
      nextRetryAt: "2026-01-01T00:01:00.000Z",
    });
    for (const field of ["error", "title", "content", "errorMessage", "idempotencyKey"])
      expect(dto).not.toHaveProperty(field);
    expect(JSON.stringify(dto)).not.toContain("fixture-private");
  });
  it("does not manufacture failure metadata for successful or pending deliveries", () => {
    expect(toDeveloperPushDeliveryDto({ ...record, deliveryStatus: "success", nextRetryAt: null })).toMatchObject({
      success: true,
      nextRetryAt: undefined,
      failureReason: undefined,
    });
    expect(toDeveloperPushDeliveryDto({ ...record, deliveryStatus: "pending" }).failureReason).toBeUndefined();
  });
});
