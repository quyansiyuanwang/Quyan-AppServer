import type { IamPrincipal } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import { requestConditionContext } from "@/iam/request/condition-context";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { notificationWebhookArn, isCanonicalNotificationId } from "@/iam/resources/notification-resources";
import {
  NotificationWebhookManagementRepository,
  type NotificationWebhookTarget,
  type NotificationWebhookView,
} from "@/store/notification/notification-webhook-management.repository";
import { NotificationPreferenceInitializerService } from "./notification-preference-initializer.service";
import {
  normalizeNotificationWebhookCreate,
  normalizeNotificationWebhookUpdate,
} from "./notification-webhook-validation";
import { ForbiddenError } from "@/util/errors";
const denied = () =>
  new ForbiddenError("Notification webhook authorization unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
/** Fixed server operations, actual target metadata, and live transactional identity checks. */
export class NotificationWebhookIamService {
  private static instance: NotificationWebhookIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository = NotificationWebhookManagementRepository.getInstance(),
    private readonly initializer = NotificationPreferenceInitializerService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new NotificationWebhookIamService());
  }
  private async actor(userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      !isCanonicalNotificationId(userId) ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId ||
      !(await iamAuthenticatedUserResourceResolver({ request, principal }))
    )
      throw denied();
    await this.iam.loadPolicies(principal);
    await this.repository.assertPrincipal(principal);
    return { principal, request };
  }
  private async evaluate(
    principal: IamPrincipal,
    request: TypedRequest,
    action: string,
    resources: string[],
    shadow = false,
  ) {
    const start = performance.now();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (!Array.isArray(results) || results.length !== resources.length || Array.from(results).some((result) => !result))
      throw denied();
    results.forEach((result, index) => {
      (request.iamDecisions ??= []).push({ ...result, action, resource: resources[index] });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource: resources[index],
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: shadow ? "shadow" : "enforce",
        ...(shadow ? { legacyAllowed: true } : {}),
        batchSize: resources.length,
        batchIndex: index,
      });
    });
    return results;
  }
  private async allowedRows(
    principal: IamPrincipal,
    request: TypedRequest,
    rows: readonly NotificationWebhookTarget[],
    shadow: boolean,
  ) {
    if (!rows.length) return [];
    if (rows.some((row) => row.userId !== principal.subjectUserId || !isCanonicalNotificationId(row.id)))
      throw denied();
    const results = await this.evaluate(
      principal,
      request,
      "quyan:notification:ListWebhooks",
      rows.map((row) => notificationWebhookArn(principal.accountOwnerId, row.userId, row.id)),
      shadow,
    );
    return rows.filter((_, index) => results[index].decision === "Allow");
  }
  async list(userId: string, request?: TypedRequest, shadow = false): Promise<NotificationWebhookView[]> {
    const actor = await this.actor(userId, request);
    const selected: NotificationWebhookTarget[] = [];
    let after: NotificationWebhookTarget | undefined;
    while (true) {
      const rows = await this.repository.scan(actor.principal, after);
      if (!rows.length) break;
      selected.push(...(await this.allowedRows(actor.principal, actor.request, rows, shadow)));
      after = rows[rows.length - 1];
      if (rows.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    await this.iam.loadPolicies(actor.principal);
    const result: NotificationWebhookView[] = [];
    for (let i = 0; i < selected.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const rows = await this.allowedRows(
        actor.principal,
        actor.request,
        selected.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
        shadow,
      );
      if (rows.length !== selected.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest).length) throw denied();
      result.push(...(await this.repository.hydrate(actor.principal, rows)));
    }
    await this.repository.assertPrincipal(actor.principal);
    return result;
  }
  async create(userId: string, input: unknown, request?: TypedRequest) {
    const data = normalizeNotificationWebhookCreate(input);
    const actor = await this.actor(userId, request);
    const resource = await iamAuthenticatedUserResourceResolver(actor);
    if (!resource) throw denied();
    const [result] = await this.evaluate(actor.principal, actor.request, "quyan:notification:CreateWebhook", [
      resource,
    ]);
    if (result.decision !== "Allow") throw denied();
    return this.repository.create(actor.principal, data, await this.initializer.getInitializationDefaults());
  }
  private async target(id: string, userId: string, action: string, request?: TypedRequest) {
    if (!isCanonicalNotificationId(id)) throw denied();
    const actor = await this.actor(userId, request);
    const target = await this.repository.target(actor.principal, id);
    const resource = notificationWebhookArn(actor.principal.accountOwnerId, userId, target.id);
    const [result] = await this.evaluate(actor.principal, actor.request, action, [resource]);
    if (result.decision !== "Allow") throw denied();
    return { ...actor, target };
  }
  async update(id: string, userId: string, input: unknown, request?: TypedRequest) {
    const data = normalizeNotificationWebhookUpdate(input);
    const { principal, target } = await this.target(id, userId, "quyan:notification:UpdateWebhook", request);
    return this.repository.update(principal, target, data);
  }
  async authorizeTest(id: string, userId: string, request?: TypedRequest) {
    const { principal, target } = await this.target(id, userId, "quyan:notification:TestWebhook", request);
    return { principal, target };
  }
  async delete(id: string, userId: string, request?: TypedRequest) {
    const { principal, target } = await this.target(id, userId, "quyan:notification:DeleteWebhook", request);
    return this.repository.delete(principal, target);
  }
}
