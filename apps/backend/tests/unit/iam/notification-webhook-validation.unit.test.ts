import { describe, expect, it } from "vitest";
import {
  normalizeNotificationWebhookCreate,
  normalizeNotificationWebhookUpdate,
} from "@/services/notification/notification-webhook-validation";
import { notificationWebhookResourceResolver } from "@/iam/request/notification-resource-resolvers";
import { getIamActionDefinition } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const input = { name: "  Hook  ", url: "https://example.invalid/webhook", format: "generic" };
describe("notification webhook input and catalog boundary", () => {
  it("normalizes create fields and strips caller identity and lifecycle data", () => {
    expect(
      normalizeNotificationWebhookCreate({
        ...input,
        userId: "peer",
        preferenceId: "foreign",
        accountOwnerId: "foreign",
        status: -1,
      }),
    ).toEqual({ ...input, name: "Hook", secret: null, enabled: true });
  });
  it("retains explicit clearing without defaulting partial updates", () => {
    expect(normalizeNotificationWebhookUpdate({ secret: null, enabled: false, userId: "peer" })).toEqual({
      secret: null,
      enabled: false,
    });
    expect(normalizeNotificationWebhookUpdate({ name: "Hook" })).toEqual({ name: "Hook" });
  });
  it.each([
    { ...input, name: " " },
    { ...input, url: "invalid" },
    { ...input, format: "unknown" },
    { ...input, secret: "x".repeat(201) },
    { ...input, enabled: "true" },
  ])("rejects invalid create data", (data) => {
    expect(() => normalizeNotificationWebhookCreate(data)).toThrow();
  });
  it("declares native CRUD without granting implicit self access", () => {
    for (const operation of ["List", "Create", "Update", "Delete"]) {
      const definition = getIamActionDefinition(
        "quyan:notification:" + operation + (operation === "List" ? "Webhooks" : "Webhook"),
      );
      expect(definition).toMatchObject({
        authorizationStage: "declared",
        sensitive: true,
        resourceTypes: [operation === "Create" ? "quyan/user" : "notification/webhook"],
      });
      expect(definition?.defaultAuthorizationScope).toBeUndefined();
    }
  });
  it("constructs a route target only from trusted actor/account and canonical path ID", async () => {
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    const request = {
      params: { id: "hook" },
      body: { userId: "peer", accountId: "foreign" },
      headers: { "x-action": "*" },
    } as unknown as TypedRequest;
    expect(await notificationWebhookResourceResolver({ request, principal })).toBe(
      "acs:notification:*:owner:webhook/actor/hook",
    );
    request.params.id = "hook/*";
    expect(await notificationWebhookResourceResolver({ request, principal })).toBeUndefined();
  });
});
