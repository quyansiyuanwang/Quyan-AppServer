import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationTestDeliveryIamService } from "@/services/notification/notification-test-delivery-iam.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import { ForbiddenError } from "@/util/errors";
import { getIamActionDefinition } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
vi.mock("@/iam/iam-authorization.service");
vi.mock("@/services/notification/notification-webhook-iam.service");
vi.mock("@/services/notification/notification-preference-initializer.service");
vi.mock("@/services/notification/notification.service");
vi.mock("@/iam/request/principal-context");
vi.mock("@/iam/request/resource-resolvers");
vi.mock("@/iam/request/condition-context", () => ({ requestConditionContext: () => ({}) }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
const principal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user" as const,
};
const preference = { notificationEmail: "own@example.invalid" };
let iam: any,
  webhooks: any,
  initializer: any,
  delivery: any,
  service: NotificationTestDeliveryIamService,
  request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getIamPrincipal).mockReturnValue(principal);
  vi.mocked(iamAuthenticatedUserResourceResolver).mockReturnValue("acs:quyan:*:owner:user/actor");
  iam = { authorize: vi.fn().mockResolvedValue({ decision: "Allow", reason: "matched-allow", matchedStatements: [] }) };
  webhooks = { authorizeTest: vi.fn().mockResolvedValue({ principal, target: { id: "hook" } }) };
  initializer = { getOrInitializeForAccount: vi.fn().mockResolvedValue(preference) };
  delivery = {
    sendAuthorizedTestEmail: vi.fn().mockResolvedValue(undefined),
    sendAuthorizedTestWebhook: vi.fn().mockResolvedValue(undefined),
  };
  service = new (NotificationTestDeliveryIamService as any)(iam, webhooks, initializer, delivery);
  request = { params: {}, headers: {}, user: { userId: "actor" } } as unknown as TypedRequest;
});
describe("test delivery IAM boundary", () => {
  it("requires exact executing identity", async () => {
    await expect(service.email("actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.email("peer", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(initializer.getOrInitializeForAccount).not.toHaveBeenCalled();
  });
  it.each([{ decision: "ExplicitDeny" }, { decision: "ImplicitDeny" }, undefined])(
    "does not initialize or deliver after missing or denied authorization",
    async (result) => {
      iam.authorize.mockResolvedValue(result);
      await expect(service.email("actor", request)).rejects.toMatchObject({ statusCode: 403 });
      expect(initializer.getOrInitializeForAccount).not.toHaveBeenCalled();
      expect(delivery.sendAuthorizedTestEmail).not.toHaveBeenCalled();
    },
  );
  it("uses fixed TestEmail and own user ARN regardless of client header", async () => {
    request.headers["x-action"] = "quyan:notification:Manage";
    expect(await service.email("actor", request)).toEqual({ success: true });
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:notification:TestEmail",
        resource: "acs:quyan:*:owner:user/actor",
        principal,
      }),
    );
    expect(delivery.sendAuthorizedTestEmail).toHaveBeenCalledWith(
      principal,
      preference,
      expect.objectContaining({ event: "balance_low" }),
    );
  });
  it("does not convert transaction authorization errors into transport success", async () => {
    delivery.sendAuthorizedTestWebhook.mockRejectedValue(
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
    );
    await expect(service.webhook("hook", "actor", request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("sanitizes transport error details and honors request locale", async () => {
    request.locale = "zh-CN";
    delivery.sendAuthorizedTestEmail.mockRejectedValue(new Error("smtp secret token fixture"));
    expect(await service.email("actor", request)).toEqual({
      success: false,
      error: "测试投递失败，请检查目标地址和投递配置。",
    });
  });
  it("does not send when email is explicitly unconfigured", async () => {
    initializer.getOrInitializeForAccount.mockResolvedValue({ notificationEmail: null });
    expect(await service.email("actor", request)).toEqual({
      success: false,
      error: "Notification email is not configured",
    });
    expect(delivery.sendAuthorizedTestEmail).not.toHaveBeenCalled();
  });
  it("does not mask policy-store failure or initialize preferences", async () => {
    iam.authorize.mockRejectedValue(new Error("fixture store unavailable"));
    await expect(service.email("actor", request)).rejects.toThrow("fixture store unavailable");
    expect(initializer.getOrInitializeForAccount).not.toHaveBeenCalled();
  });
  it("registers sensitive test operations without implicit self grants", () => {
    for (const operation of ["TestWebhook", "TestEmail"]) {
      const definition = getIamActionDefinition("quyan:notification:" + operation);
      expect(definition).toMatchObject({
        accessLevel: "Write",
        sensitive: true,
        authorizationStage: "declared",
        resourceTypes: [operation === "TestEmail" ? "quyan/user" : "notification/webhook"],
      });
      expect(definition?.defaultAuthorizationScope).toBeUndefined();
    }
  });
});
