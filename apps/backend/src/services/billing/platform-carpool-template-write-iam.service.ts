import {
  Permission,
  IAM_CARPOOL_TEMPLATE_WRITE_OPERATIONS,
  type IamPrincipal,
  type IamCarpoolTemplateWriteOperation,
} from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { platformTemplateArn, platformCarpoolTemplateControlArn } from "@/iam/resources/platform-template-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { CarpoolRepository } from "@/store/billing/carpool.repository";
import { carpoolTemplateRevision, type CarpoolTemplateWriteGuard } from "@/store/billing/carpool-template-write";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";

export class PlatformCarpoolTemplateWriteIamService {
  private static instance: PlatformCarpoolTemplateWriteIamService;
  static getInstance() {
    return (this.instance ??= new PlatformCarpoolTemplateWriteIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "authorize" | "loadPolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: Pick<
      CarpoolRepository,
      "findTemplate" | "findActiveMonthlyPassTemplate"
    > = CarpoolRepository.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  private async evaluate(principal: IamPrincipal, request: TypedRequest, action: string, resource: string) {
    const start = performance.now();
    const result = await this.iam.authorize({
      principal,
      action,
      resource,
      context: requestConditionContext(request, principal),
    });
    if (!result) throw iamAccountDenied();
    (request.iamDecisions ??= []).push({ ...result, action, resource });
    auditIamDecision({
      requestId: request.res?.locals.requestId,
      principal,
      action,
      resource,
      result,
      evaluationLatencyMs: performance.now() - start,
      authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
      ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
    });
    if (result.decision !== "Allow") throw iamAccountDenied();
  }
  async prepare(
    operation: IamCarpoolTemplateWriteOperation,
    actorUserId: string,
    request?: TypedRequest,
    id?: string,
    monthlyPassTemplateId?: string,
  ) {
    const definition = IAM_CARPOOL_TEMPLATE_WRITE_OPERATIONS.find((entry) => entry.operation === operation);
    const mode = env.security.iamAuthorizationMode;
    if (
      !definition ||
      !["legacy", "shadow", "enforce"].includes(mode) ||
      (operation === "CreateTemplate" ? id !== undefined : !isPlatformLogResourceId(id)) ||
      (["CreateTemplate", "UpdateTemplate"].includes(operation)
        ? !isPlatformLogResourceId(monthlyPassTemplateId)
        : monthlyPassTemplateId !== undefined)
    )
      throw iamAccountDenied();
    // Preserve trusted in-process legacy callers; HTTP always supplies the authenticated request.
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return undefined;
    }
    const principal = getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== actorUserId ||
      principal.principalUserId !== actorUserId
    )
      throw iamAccountDenied();
    if (
      mode !== "enforce" &&
      !(
        await this.permissions.checkUserPermissions(actorUserId, [Permission.CARPOOL_TEMPLATE_WRITE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return undefined;
    const native = async () => {
      const action = "quyan:carpool:" + operation;
      const resource = definition.create ? platformCarpoolTemplateControlArn() : platformTemplateArn("carpool", id!);
      const snapshot = await this.snapshots.snapshot(principal, Permission.CARPOOL_TEMPLATE_WRITE);
      const policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const evaluate = async (arn: string) => {
        await this.evaluate(principal, request, action, arn);
      };
      const recheck = async () => {
        await this.snapshots.recheck(principal, Permission.CARPOOL_TEMPLATE_WRITE, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
        await evaluate(resource);
        if (operation === "DuplicateTemplate") await evaluate(platformTemplateArn("carpool", id!));
        if (monthlyPassTemplateId) await evaluate(platformTemplateArn("monthly-pass", monthlyPassTemplateId));
        await this.snapshots.recheck(principal, Permission.CARPOOL_TEMPLATE_WRITE, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const record = operation === "CreateTemplate" ? undefined : await this.repository.findTemplate(id!);
      const target = record ? { record, revision: carpoolTemplateRevision(record) } : undefined;
      if (
        operation !== "CreateTemplate" &&
        (!target || target.record.id !== id || ![0, 1].includes(target.record.status))
      )
        throw iamAccountDenied();
      const monthlySource = monthlyPassTemplateId
        ? await this.repository.findActiveMonthlyPassTemplate(monthlyPassTemplateId)
        : undefined;
      if (
        monthlyPassTemplateId &&
        (!monthlySource || monthlySource.id !== monthlyPassTemplateId || monthlySource.status !== 1)
      )
        throw iamAccountDenied();
      const guard: CarpoolTemplateWriteGuard = {
        target,
        operation,
        monthlySource: monthlySource
          ? { record: monthlySource, revision: carpoolTemplateRevision(monthlySource) }
          : undefined,
        group: snapshot.group,
        users: { principal: { ...principal }, targetUserId: actorUserId, users: snapshot.users, recheck },
        recheckEntry: async (entryId) => {
          await recheck();
          await evaluate(platformTemplateArn("carpool", entryId));
          await this.snapshots.recheck(principal, Permission.CARPOOL_TEMPLATE_WRITE, snapshot);
          if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
        },
      };
      await recheck();
      return { guard, target };
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("CarpoolTemplateIam", LogCategory.SECURITY).warn("Template write shadow evaluation failed", {
        action: "quyan:carpool:" + operation,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return undefined;
  }
}
