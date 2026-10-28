import type { TypedRequest } from "@/types/express";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import { requestConditionContext } from "@/iam/request/condition-context";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { ApiError, ForbiddenError } from "@/util/errors";
import { translateMessage, DEFAULT_BACKEND_LOCALE } from "@/locales";
import { NotificationWebhookIamService } from "./notification-webhook-iam.service";
import { NotificationPreferenceInitializerService } from "./notification-preference-initializer.service";
import { NotificationService } from "./notification.service";
import { NotificationTemplateRegistry } from "./notification-template";
import { NotificationEvent } from "@quyan/shared";
const denied = () =>
  new ForbiddenError("Notification test delivery unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
const document = () =>
  NotificationTemplateRegistry.build(NotificationEvent.BALANCE_LOW, {
    currentBalance: "100.0000",
    threshold: "10.0000",
    source: "test",
  });
export class NotificationTestDeliveryIamService {
  private static instance: NotificationTestDeliveryIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly webhooks = NotificationWebhookIamService.getInstance(),
    private readonly initializer = NotificationPreferenceInitializerService.getInstance(),
    private readonly delivery = NotificationService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new NotificationTestDeliveryIamService());
  }
  private failure(request?: TypedRequest) {
    return {
      success: false,
      error: translateMessage("notification.testDeliveryFailed", request?.locale ?? DEFAULT_BACKEND_LOCALE),
    };
  }
  async webhook(id: string, userId: string, request?: TypedRequest): Promise<{ success: boolean; error?: string }> {
    const { principal, target } = await this.webhooks.authorizeTest(id, userId, request);
    try {
      await this.delivery.sendAuthorizedTestWebhook(principal, target, document());
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return this.failure(request);
    }
  }
  async email(userId: string, request?: TypedRequest): Promise<{ success: boolean; error?: string }> {
    const principal = request && getIamPrincipal(request);
    if (!request || !principal || principal.subjectUserId !== userId || principal.principalUserId !== userId)
      throw denied();
    const resource = await iamAuthenticatedUserResourceResolver({ request, principal });
    if (!resource) throw denied();
    const action = "quyan:notification:TestEmail",
      start = performance.now();
    const result = await this.iam.authorize({
      principal,
      action,
      resource,
      context: requestConditionContext(request, principal),
    });
    if (!result) throw denied();
    (request.iamDecisions ??= []).push({ ...result, action, resource });
    auditIamDecision({
      requestId: request.res?.locals.requestId,
      principal,
      action,
      resource,
      result,
      evaluationLatencyMs: performance.now() - start,
      authorizationMode: "enforce",
    });
    if (result.decision !== "Allow") throw denied();
    const preference = await this.initializer.getOrInitializeForAccount(principal);
    if (!preference.notificationEmail)
      return {
        success: false,
        error: translateMessage("notification.emailNotConfigured", request.locale ?? DEFAULT_BACKEND_LOCALE),
      };
    try {
      await this.delivery.sendAuthorizedTestEmail(principal, preference, document());
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return this.failure(request);
    }
  }
}
