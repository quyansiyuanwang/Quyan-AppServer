import {
  IAM_REMOTE_TERMINAL_MANAGEMENT_MUTATIONS,
  type IamPrincipal,
  type IamTerminalManagementMutation,
} from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  platformTerminalBindingArn,
  platformTerminalEntitlementArn,
} from "@/iam/resources/platform-terminal-entitlement-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformTerminalManagementMutationRepository } from "@/store/remote-terminal-product/platform-terminal-management-mutation.repository";
import type {
  PlatformTerminalManagementMutationStore,
  TerminalManagementMutationGuard,
} from "@/store/remote-terminal-product/platform-terminal-management-mutation.store";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";

export class PlatformTerminalManagementMutationIamService {
  private static instance: PlatformTerminalManagementMutationIamService;
  static getInstance() {
    return (this.instance ??= new PlatformTerminalManagementMutationIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "authorize" | "loadPolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformTerminalManagementMutationStore = PlatformTerminalManagementMutationRepository.getInstance(),
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
    operation: IamTerminalManagementMutation,
    actorUserId: string,
    request: TypedRequest | undefined,
    id: string,
  ) {
    const definition = IAM_REMOTE_TERMINAL_MANAGEMENT_MUTATIONS.find((entry) => entry.operation === operation);
    const mode = env.security.iamAuthorizationMode;
    if (!definition || !["legacy", "shadow", "enforce"].includes(mode) || !isPlatformLogResourceId(id))
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
        await this.permissions.checkUserPermissions(actorUserId, [definition.permission], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return undefined;
    const native = async () => {
      const action = "quyan:remote_terminal:" + operation;
      const owner = await this.repository.owner(principal, operation, id);
      if (!owner) throw iamAccountDenied();
      const resource =
        definition.kind === "binding"
          ? platformTerminalBindingArn(owner, id)
          : platformTerminalEntitlementArn(owner, id);
      const snapshot = await this.snapshots.snapshot(principal, definition.permission);
      const policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const evaluate = () => this.evaluate(principal, request, action, resource);
      const recheck = async () => {
        await this.snapshots.recheck(principal, definition.permission, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
        await evaluate();
        await this.snapshots.recheck(principal, definition.permission, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const target = await this.repository.target(principal, operation, id);
      if (
        !target ||
        target.id !== id ||
        target.userId !== owner ||
        target.kind !== definition.kind ||
        ![0, 1].includes(target.status)
      )
        throw iamAccountDenied();
      const guard: TerminalManagementMutationGuard = {
        operation,
        targetId: id,
        targetUserId: owner,
        group: snapshot.group,
        users: { principal: { ...principal }, targetUserId: actorUserId, users: snapshot.users, recheck },
      };
      await recheck();
      return { guard, target };
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("TerminalManagementIam", LogCategory.SECURITY).warn(
        "Terminal management mutation shadow evaluation failed",
        {
          action: "quyan:remote_terminal:" + operation,
          reason: "iam-evaluation-denied-or-unavailable",
        },
      );
    }
    return undefined;
  }
}
