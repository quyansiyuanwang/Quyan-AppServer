import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { platformTerminalEntitlementArn } from "@/iam/resources/platform-terminal-entitlement-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformTerminalManagementMutationRepository } from "@/store/remote-terminal-product/platform-terminal-management-mutation.repository";
import type { PlatformTerminalManagementMutationStore } from "@/store/remote-terminal-product/platform-terminal-management-mutation.store";
import { PlatformTerminalEntitlementUpdateRepository } from "@/store/remote-terminal-product/platform-terminal-entitlement-update.repository";
import type {
  PlatformTerminalEntitlementUpdateStore,
  TerminalEntitlementUpdateGuard,
} from "@/store/remote-terminal-product/platform-terminal-entitlement-update.store";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const permission = Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE;
export class PlatformTerminalEntitlementUpdateIamService {
  private static instance: PlatformTerminalEntitlementUpdateIamService;
  static getInstance() {
    return (this.instance ??= new PlatformTerminalEntitlementUpdateIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "authorize" | "loadPolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformTerminalEntitlementUpdateStore = PlatformTerminalEntitlementUpdateRepository.getInstance(),
    private readonly owners: Pick<
      PlatformTerminalManagementMutationStore,
      "owner"
    > = PlatformTerminalManagementMutationRepository.getInstance(),
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
  async prepare(actorUserId: string, request: TypedRequest | undefined, id: string, deleteViaUpdate = false) {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode) || !isPlatformLogResourceId(id)) throw iamAccountDenied();
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
      const owner = await this.owners.owner(principal, "DeleteEntitlement", id);
      if (!owner) throw iamAccountDenied();
      const resource = platformTerminalEntitlementArn(owner, id);
      const snapshot = await this.snapshots.snapshot(principal, permission);
      const policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const recheck = async () => {
        await this.snapshots.recheck(principal, permission, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
        await this.evaluate(principal, request, "quyan:remote_terminal:UpdateEntitlement", resource);
        if (deleteViaUpdate)
          await this.evaluate(principal, request, "quyan:remote_terminal:DeleteEntitlement", resource);
        await this.snapshots.recheck(principal, permission, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const target = await this.repository.target(principal, id);
      if (!target || target.record.id !== id || target.record.userId !== owner) throw iamAccountDenied();
      const guard: TerminalEntitlementUpdateGuard = {
        operation: "UpdateEntitlement",
        targetId: id,
        targetUserId: owner,
        deleteViaUpdate,
        group: snapshot.group,
        users: {
          principal: { ...principal },
          targetUserId: actorUserId,
          users: snapshot.users,
          recheck: async () => {
            if (
              guard.operation !== "UpdateEntitlement" ||
              guard.targetId !== id ||
              guard.targetUserId !== owner ||
              guard.deleteViaUpdate !== deleteViaUpdate
            )
              throw iamAccountDenied();
            await recheck();
          },
        },
      };
      await recheck();
      return { guard, target };
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("TerminalEntitlementUpdateIam", LogCategory.SECURITY).warn(
        "Entitlement update shadow evaluation failed",
        { action: "quyan:remote_terminal:UpdateEntitlement", reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return undefined;
  }
}
