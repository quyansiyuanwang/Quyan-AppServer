import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { platformTerminalEntitlementArn } from "@/iam/resources/platform-terminal-entitlement-resources";
import { platformUserArn, isPlatformUserId } from "@/iam/resources/platform-user-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformTerminalEntitlementAssignRepository } from "@/store/remote-terminal-product/platform-terminal-entitlement-assign.repository";
import type {
  PlatformTerminalEntitlementAssignStore,
  TerminalEntitlementAssignGuard,
} from "@/store/remote-terminal-product/platform-terminal-entitlement-assign.store";
import { terminalTemplateRevision } from "@/store/remote-terminal-product/platform-terminal-template-write.repository";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const permission = Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE,
  action = "quyan:remote_terminal:AssignEntitlement";
export class PlatformTerminalEntitlementAssignIamService {
  private static instance: PlatformTerminalEntitlementAssignIamService;
  static getInstance() {
    return (this.instance ??= new PlatformTerminalEntitlementAssignIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "authorize" | "loadPolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformTerminalEntitlementAssignStore = PlatformTerminalEntitlementAssignRepository.getInstance(),
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
  async prepare(actorUserId: string, request: TypedRequest | undefined, userId: string, templateId?: string) {
    const mode = env.security.iamAuthorizationMode;
    if (
      !["legacy", "shadow", "enforce"].includes(mode) ||
      !isPlatformUserId(userId) ||
      (templateId !== undefined && !isPlatformLogResourceId(templateId))
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
        if (templateId) await this.evaluate(principal, request, platformTemplateArn("remote-terminal", templateId));
        await this.snapshots.recheck(principal, permission, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const customer = await this.repository.user(principal, userId),
        template = templateId ? await this.repository.template(principal, templateId) : null;
      if (
        !customer ||
        customer.id !== userId ||
        customer.status !== 1 ||
        (templateId && (!template || template.id !== templateId || ![0, 1].includes(template.status)))
      )
        throw iamAccountDenied();
      const customerHash = JSON.stringify(customer),
        templateHash = template ? terminalTemplateRevision(template) : null;
      const guard: TerminalEntitlementAssignGuard = {
        operation: "AssignEntitlement",
        customer,
        template,
        group: snapshot.group,
        users: {
          principal: { ...principal },
          targetUserId: actorUserId,
          users: snapshot.users,
          recheck: async () => {
            if (
              guard.operation !== "AssignEntitlement" ||
              JSON.stringify(guard.customer) !== customerHash ||
              (guard.template ? terminalTemplateRevision(guard.template) : null) !== templateHash
            )
              throw iamAccountDenied();
            await recheck();
          },
        },
        recheckEntry: async (id) => {
          await guard.users.recheck();
          if (!isPlatformLogResourceId(id)) throw iamAccountDenied();
          await this.evaluate(principal, request, platformTerminalEntitlementArn(userId, id));
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
      getLogger("TerminalEntitlementAssignIam", LogCategory.SECURITY).warn(
        "Entitlement assignment shadow evaluation failed",
        { action, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return undefined;
  }
}
