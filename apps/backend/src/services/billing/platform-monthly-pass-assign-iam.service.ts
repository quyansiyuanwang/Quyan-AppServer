import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { platformMonthlyPassArn } from "@/iam/resources/platform-monthly-pass-resources";
import { platformUserArn, isPlatformUserId } from "@/iam/resources/platform-user-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { MonthlyPassRepository } from "@/store/billing/monthly-pass.repository";
import type { MonthlyPassStore } from "@/store/billing/monthly-pass.store";
import { monthlyPassAssignmentUserRevision, type MonthlyPassAssignGuard } from "@/store/billing/monthly-pass-assign";
import { monthlyPassTemplateRevision } from "@/store/billing/monthly-pass-template-write";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const permission = Permission.MONTHLY_PASS_ASSIGNMENT_WRITE,
  action = "quyan:monthly_pass:AssignUserPass";
export class PlatformMonthlyPassAssignIamService {
  private static instance: PlatformMonthlyPassAssignIamService;
  static getInstance() {
    return (this.instance ??= new PlatformMonthlyPassAssignIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "authorize" | "loadPolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: Pick<
      MonthlyPassStore,
      "findAssignmentUser" | "findTemplateById"
    > = MonthlyPassRepository.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  private async evaluate(principal: IamPrincipal, request: TypedRequest, resource: string) {
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
  async prepare(actorUserId: string, request: TypedRequest | undefined, userId: string, templateId: string) {
    const mode = env.security.iamAuthorizationMode;
    if (
      !["legacy", "shadow", "enforce"].includes(mode) ||
      !isPlatformUserId(userId) ||
      !isPlatformLogResourceId(templateId)
    )
      throw iamAccountDenied();
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
        await this.permissions.checkUserPermissions(actorUserId, [permission], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return undefined;
    const native = async () => {
      const snapshot = await this.snapshots.snapshot(principal, permission),
        policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const recheck = async () => {
        await this.snapshots.recheck(principal, permission, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
        await this.evaluate(principal, request, platformUserArn(userId));
        if (templateId) await this.evaluate(principal, request, platformTemplateArn("monthly-pass", templateId));
        await this.snapshots.recheck(principal, permission, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const customer = await this.repository.findAssignmentUser(userId),
        template = await this.repository.findTemplateById(templateId);
      if (
        !customer ||
        customer.id !== userId ||
        ![0, 1].includes(customer.status) ||
        !template ||
        template.id !== templateId ||
        template.status !== 1
      )
        throw iamAccountDenied();
      const customerHash = monthlyPassAssignmentUserRevision(customer),
        templateHash = monthlyPassTemplateRevision(template);
      const guard: MonthlyPassAssignGuard = {
        operation: "AssignUserPass",
        customer,
        template,
        group: snapshot.group,
        users: {
          principal: { ...principal },
          targetUserId: actorUserId,
          users: snapshot.users,
          recheck: async () => {
            if (
              guard.operation !== "AssignUserPass" ||
              monthlyPassAssignmentUserRevision(guard.customer) !== customerHash ||
              monthlyPassTemplateRevision(guard.template) !== templateHash
            )
              throw iamAccountDenied();
            await recheck();
          },
        },
        recheckEntry: async (id) => {
          await guard.users.recheck();
          if (!isPlatformLogResourceId(id)) throw iamAccountDenied();
          await this.evaluate(principal, request, platformMonthlyPassArn(userId, id));
          await guard.users.recheck();
        },
      };
      await guard.users.recheck();
      return { guard, customer, template };
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("MonthlyPassAssignIam", LogCategory.SECURITY).warn("Monthly pass assignment shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return undefined;
  }
}
