import type { IamPrincipal } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { ForbiddenError } from "@/util/errors";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import { requestConditionContext } from "@/iam/request/condition-context";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { NotificationPreferenceManagementRepository } from "@/store/notification/notification-preference-management.repository";
import { normalizeNotificationPreferenceUpdate } from "./notification-preference-validation";
import { NotificationPreferenceInitializerService } from "./notification-preference-initializer.service";

/** Enforce-only API boundary; client Action and target identity fields are never consumed. */
export class NotificationPreferenceIamService {
  private static instance: NotificationPreferenceIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository = NotificationPreferenceManagementRepository.getInstance(),
    private readonly initializer = NotificationPreferenceInitializerService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new NotificationPreferenceIamService());
  }
  private async authorize(userId: string, action: string, request?: TypedRequest): Promise<IamPrincipal> {
    const principal = request && getIamPrincipal(request);
    if (!request || !principal || principal.subjectUserId !== userId || principal.principalUserId !== userId)
      throw new ForbiddenError("Notification preference actor unavailable", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    const resource = await iamAuthenticatedUserResourceResolver({ request, principal });
    if (!resource)
      throw new ForbiddenError("Notification preference resource unavailable", undefined, {
        messageKey: "iam.resourceResolutionFailed",
      });
    const start = performance.now();
    const result = await this.iam.authorize({
      principal,
      action,
      resource,
      context: requestConditionContext(request, principal),
    });
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
    if (result.decision !== "Allow")
      throw new ForbiddenError("Notification preference denied", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    return principal;
  }
  async get(userId: string, request?: TypedRequest) {
    const principal = await this.authorize(userId, "quyan:notification:GetPreferences", request);
    return this.initializer.getOrInitializeForAccount(principal);
  }
  async update(userId: string, changes: unknown, request?: TypedRequest) {
    const principal = await this.authorize(userId, "quyan:notification:UpdatePreferences", request);
    return this.repository.update(principal, normalizeNotificationPreferenceUpdate(changes));
  }
}
