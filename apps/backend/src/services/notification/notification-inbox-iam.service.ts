import type { IamPrincipal } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { notificationInboxItemArn, isCanonicalNotificationId } from "@/iam/resources/notification-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import {
  notificationInboxQuerySchema,
  markNotificationInboxReadBodySchema,
} from "@/api/schema/notification/notification.schema";
import {
  NotificationInboxManagementRepository,
  type NotificationInboxTarget,
} from "@/store/notification/notification-inbox-management.repository";
import { BadRequestError, ForbiddenError } from "@/util/errors";
const denied = () =>
  new ForbiddenError("Inbox authorization unavailable", undefined, { messageKey: "permission.insufficientPermission" });
const invalid = () =>
  new BadRequestError("Invalid inbox request", undefined, { messageKey: "errors.validationFailed" });
export class NotificationInboxIamService {
  private static instance: NotificationInboxIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository = NotificationInboxManagementRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new NotificationInboxIamService());
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
    return { principal, request };
  }
  private async decisions(
    principal: IamPrincipal,
    request: TypedRequest,
    action: string,
    rows: readonly NotificationInboxTarget[],
    allRequired: boolean,
  ) {
    if (!rows.length) return [];
    if (rows.some((row) => row.userId !== principal.subjectUserId || !isCanonicalNotificationId(row.id)))
      throw denied();
    const resources = rows.map((row) => notificationInboxItemArn(principal.accountOwnerId, row.userId, row.id));
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
        authorizationMode: "enforce",
        batchSize: rows.length,
        batchIndex: index,
      });
    });
    if (allRequired && results.some((result) => result.decision !== "Allow")) throw denied();
    return rows.filter((_, index) => results[index].decision === "Allow");
  }
  async list(userId: string, page: number, pageSize: number, unreadOnly: boolean, request?: TypedRequest) {
    const parsed = notificationInboxQuerySchema.safeParse({ page, pageSize, unreadOnly });
    if (!parsed.success) throw invalid();
    ({ page, pageSize, unreadOnly } = parsed.data);
    if (!Number.isSafeInteger((page - 1) * pageSize)) throw invalid();
    const { principal, request: req } = await this.principal(userId, request);
    let total = 0,
      unreadCount = 0,
      pixelOpenedUnreadCount = 0;
    const selected: NotificationInboxTarget[] = [];
    let after: NotificationInboxTarget | undefined;
    while (true) {
      // Scan all states so counters and unread-only pages use the same authorized population.
      const rows = await this.repository.scan(principal, after);
      if (!rows.length) break;
      const allowed = await this.decisions(principal, req, "quyan:notification:ListInbox", rows, false);
      const current = await this.repository.validate(principal, allowed);
      for (const row of current) {
        if (!row.isRead) {
          unreadCount++;
          if (row.pixelOpened) pixelOpenedUnreadCount++;
        }
        if (unreadOnly && row.isRead) continue;
        if (total >= (page - 1) * pageSize && selected.length < pageSize) selected.push(row);
        total++;
      }
      after = rows[rows.length - 1];
      if (rows.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    await this.iam.loadPolicies(principal);
    const items = await this.repository.hydrate(principal, selected);
    return { items, total, unreadCount, pixelOpenedUnreadCount, page, pageSize };
  }
  async markRead(userId: string, input: unknown, request?: TypedRequest) {
    const parsed = markNotificationInboxReadBodySchema.safeParse(input);
    if (!parsed.success || parsed.data.ids?.some((id) => !isCanonicalNotificationId(id))) throw invalid();
    const { principal, request: req } = await this.principal(userId, request);
    if (parsed.data.markAll) return this.markCollection(principal, req, "manual");
    const rows = await this.repository.selected(principal, [...new Set(parsed.data.ids!)]);
    await this.decisions(principal, req, "quyan:notification:MarkInboxRead", rows, true);
    return this.repository.markRead(principal, rows, "manual");
  }
  async confirmPixelOpened(userId: string, request?: TypedRequest) {
    const { principal, request: req } = await this.principal(userId, request);
    return this.markCollection(principal, req, "pixel");
  }
  private async markCollection(principal: IamPrincipal, request: TypedRequest, source: "manual" | "pixel") {
    const action =
      source === "manual" ? "quyan:notification:MarkInboxRead" : "quyan:notification:ConfirmPixelOpenedInboxRead";
    const selected: NotificationInboxTarget[] = [];
    let after: NotificationInboxTarget | undefined;
    while (true) {
      const rows = await this.repository.scan(principal, after, true, source === "pixel");
      if (!rows.length) break;
      selected.push(...(await this.decisions(principal, request, action, rows, false)));
      after = rows[rows.length - 1];
      if (rows.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    // Revalidate the selected grants after scanning; changes cannot turn a partial scan into a wider mutation.
    await this.iam.loadPolicies(principal);
    for (let offset = 0; offset < selected.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
      await this.decisions(
        principal,
        request,
        action,
        selected.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
        true,
      );
    return this.repository.markRead(principal, selected, source);
  }
}
