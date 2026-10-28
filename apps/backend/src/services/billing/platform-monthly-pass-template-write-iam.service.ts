import {
  Permission,
  IAM_MONTHLY_PASS_TEMPLATE_WRITE_OPERATIONS,
  type IamPrincipal,
  type IamMonthlyPassTemplateWriteOperation,
} from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  platformTemplateArn,
  platformMonthlyPassTemplateControlArn,
} from "@/iam/resources/platform-template-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { MonthlyPassRepository } from "@/store/billing/monthly-pass.repository";
import type { MonthlyPassStore } from "@/store/billing/monthly-pass.store";
import {
  monthlyPassTemplateRevision,
  type MonthlyPassTemplateWriteGuard,
} from "@/store/billing/monthly-pass-template-write";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";

export class PlatformMonthlyPassTemplateWriteIamService {
  private static instance: PlatformMonthlyPassTemplateWriteIamService;
  static getInstance() {
    return (this.instance ??= new PlatformMonthlyPassTemplateWriteIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "authorize" | "loadPolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: Pick<MonthlyPassStore, "findTemplateById"> = MonthlyPassRepository.getInstance(),
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
    operation: IamMonthlyPassTemplateWriteOperation,
    actorUserId: string,
    request?: TypedRequest,
    id?: string,
    deleteViaUpdate = false,
  ) {
    const definition = IAM_MONTHLY_PASS_TEMPLATE_WRITE_OPERATIONS.find((entry) => entry.operation === operation);
    const mode = env.security.iamAuthorizationMode;
    if (
      !definition ||
      !["legacy", "shadow", "enforce"].includes(mode) ||
      (!definition.create && !isPlatformLogResourceId(id)) ||
      (definition.create && id !== undefined) ||
      (deleteViaUpdate && operation !== "UpdateTemplate")
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
        await this.permissions.checkUserPermissions(actorUserId, [Permission.MONTHLY_PASS_TEMPLATE_WRITE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return undefined;
    const native = async () => {
      const action = "quyan:monthly_pass:" + operation;
      const resource = definition.create
        ? platformMonthlyPassTemplateControlArn()
        : platformTemplateArn("monthly-pass", id!);
      const snapshot = await this.snapshots.snapshot(principal, Permission.MONTHLY_PASS_TEMPLATE_WRITE);
      const policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const evaluate = async (arn: string) => {
        await this.evaluate(principal, request, action, arn);
        if (deleteViaUpdate) await this.evaluate(principal, request, "quyan:monthly_pass:DeleteTemplate", arn);
      };
      const recheck = async () => {
        await this.snapshots.recheck(principal, Permission.MONTHLY_PASS_TEMPLATE_WRITE, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
        await evaluate(resource);
        await this.snapshots.recheck(principal, Permission.MONTHLY_PASS_TEMPLATE_WRITE, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const record = definition.create ? undefined : await this.repository.findTemplateById(id!);
      const target = record ? { record, revision: monthlyPassTemplateRevision(record) } : undefined;
      if (!definition.create && (!target || target.record.id !== id || ![0, 1].includes(target.record.status)))
        throw iamAccountDenied();
      const guard: MonthlyPassTemplateWriteGuard = {
        target,
        operation,
        deleteViaUpdate,
        group: snapshot.group,
        users: { principal: { ...principal }, targetUserId: actorUserId, users: snapshot.users, recheck },
        recheckEntry: async (entryId) => {
          await recheck();
          await evaluate(platformTemplateArn("monthly-pass", entryId));
          await this.snapshots.recheck(principal, Permission.MONTHLY_PASS_TEMPLATE_WRITE, snapshot);
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
      getLogger("MonthlyPassTemplateIam", LogCategory.SECURITY).warn("Template write shadow evaluation failed", {
        action: "quyan:monthly_pass:" + operation,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return undefined;
  }
}
