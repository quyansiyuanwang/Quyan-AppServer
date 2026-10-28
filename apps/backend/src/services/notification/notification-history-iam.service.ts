import type { IamPrincipal } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import { requestConditionContext } from "@/iam/request/condition-context";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { isCanonicalNotificationId, notificationDeliveryLogArn } from "@/iam/resources/notification-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { notificationLogsQuerySchema } from "@/api/schema/notification/notification.schema";
import {
  NotificationHistoryManagementRepository,
  type NotificationDeliveryLogTarget,
} from "@/store/notification/notification-history-management.repository";
import { BadRequestError, ForbiddenError } from "@/util/errors";
const denied = () =>
  new ForbiddenError("Notification history authorization unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
export class NotificationHistoryIamService {
  private static instance: NotificationHistoryIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository = NotificationHistoryManagementRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new NotificationHistoryIamService());
  }
  private async principal(userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId ||
      !(await iamAuthenticatedUserResourceResolver({ request, principal }))
    )
      throw denied();
    await this.iam.loadPolicies(principal);
    await this.repository.assertPrincipal(principal);
    return { principal, request };
  }
  private async allowedRows(
    principal: IamPrincipal,
    request: TypedRequest,
    rows: readonly NotificationDeliveryLogTarget[],
    shadow: boolean,
  ) {
    if (!rows.length) return [];
    if (rows.some((row) => row.userId !== principal.subjectUserId || !isCanonicalNotificationId(row.id)))
      throw denied();
    const action = "quyan:notification:ListDeliveryLogs";
    const resources = rows.map((row) => notificationDeliveryLogArn(principal.accountOwnerId, row.userId, row.id));
    const start = performance.now();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (results.length !== rows.length || Array.from(results).some((result) => !result)) throw denied();
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
        batchSize: rows.length,
        batchIndex: index,
      });
    });
    return rows.filter((_, index) => results[index].decision === "Allow");
  }
  async list(userId: string, page: number, pageSize: number, request?: TypedRequest, shadow = false) {
    const parsed = notificationLogsQuerySchema.safeParse({ page, pageSize });
    if (!parsed.success)
      throw new BadRequestError("Invalid notification log pagination", undefined, {
        messageKey: "errors.validationFailed",
      });
    ({ page, pageSize } = parsed.data);
    if (!Number.isSafeInteger((page - 1) * pageSize))
      throw new BadRequestError("Invalid notification log offset", undefined, {
        messageKey: "errors.validationFailed",
      });
    const { principal, request: req } = await this.principal(userId, request);
    const selected: NotificationDeliveryLogTarget[] = [];
    let total = 0,
      after: NotificationDeliveryLogTarget | undefined;
    while (true) {
      const rows = await this.repository.scan(principal, after);
      if (!rows.length) break;
      const allowed = await this.allowedRows(principal, req, rows, shadow);
      const current = await this.repository.validate(principal, allowed);
      for (const row of current) {
        if (total >= (page - 1) * pageSize && selected.length < pageSize) selected.push(row);
        total++;
      }
      after = rows[rows.length - 1];
      if (rows.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    await this.iam.loadPolicies(principal);
    // A late revocation must not expose the selected page. All page targets require a fresh Allow.
    const stillAllowed = await this.allowedRows(principal, req, selected, shadow);
    if (stillAllowed.length !== selected.length) throw denied();
    const logs = await this.repository.hydrate(principal, selected);
    return { logs, total, page, pageSize };
  }
  async authorizeEvents(userId: string, request?: TypedRequest) {
    const { principal, request: req } = await this.principal(userId, request);
    const resource = await iamAuthenticatedUserResourceResolver({ request: req, principal });
    if (!resource) throw denied();
    const action = "quyan:notification:ListEvents",
      start = performance.now();
    const result = await this.iam.authorize({
      principal,
      action,
      resource,
      context: requestConditionContext(req, principal),
    });
    (req.iamDecisions ??= []).push({ ...result, action, resource });
    auditIamDecision({
      requestId: req.res?.locals.requestId,
      principal,
      action,
      resource,
      result,
      evaluationLatencyMs: performance.now() - start,
      authorizationMode: "enforce",
    });
    if (result.decision !== "Allow") throw denied();
    await this.repository.assertPrincipal(principal);
  }
}
