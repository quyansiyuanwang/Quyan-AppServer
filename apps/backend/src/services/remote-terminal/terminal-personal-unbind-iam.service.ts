import {
  getIamActionDefinition,
  IAM_TERMINAL_PERSONAL_UNBIND_OPERATIONS,
  type IamTerminalPersonalUnbindOperation,
  type IamPrincipal,
} from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  remoteTerminalProductBindingArn,
  remoteTerminalProductEntitlementArn,
  isRemoteTerminalId,
} from "@/iam/resources/remote-terminal-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { TerminalPersonalUnbindRepository } from "@/store/remote-terminal-product/terminal-personal-unbind.repository";
import type {
  TerminalPersonalUnbindStore,
  TerminalPersonalUnbindGuard,
} from "@/store/remote-terminal-product/terminal-personal-unbind.store";
import { PermissionService } from "@/services/users/permission.service";
import { ConfigService } from "@/services/system/config.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export class TerminalPersonalUnbindIamService {
  private static instance: TerminalPersonalUnbindIamService;
  static getInstance() {
    return (this.instance ??= new TerminalPersonalUnbindIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "authorize" | "loadPolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: TerminalPersonalUnbindStore = TerminalPersonalUnbindRepository.getInstance(),
    private readonly users: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly config: Pick<ConfigService, "getRemoteTerminalUnbindConfig"> = ConfigService.getInstance(),
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
  async prepare(operation: IamTerminalPersonalUnbindOperation, userId: string, id: string, request?: TypedRequest) {
    const action = "quyan:remote_terminal:" + operation,
      definition = getIamActionDefinition(action),
      mode = env.security.iamAuthorizationMode;
    if (
      !IAM_TERMINAL_PERSONAL_UNBIND_OPERATIONS.includes(operation) ||
      !definition ||
      !isRemoteTerminalId(id) ||
      !["legacy", "shadow", "enforce"].includes(mode)
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
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId
    )
      throw iamAccountDenied();
    if (mode !== "enforce" && operation === "RevokeMyDeviceBinding") {
      const permissions = definition.legacyPermissions;
      if (!permissions?.length) throw iamAccountDenied();
      const checks = await Promise.all(
        permissions.map((permission) =>
          this.permissions.checkUserPermissions(userId, [permission], {
            assumedRoleSessionId: principal.roleSessionId,
          }),
        ),
      );
      if (!checks.some((check) => check.hasPermission)) throw iamAccountDenied();
    }
    if (mode === "legacy") return undefined;
    const native = async () => {
      // The binding belongs to the authenticated user; parent identity is obtained from persisted metadata.
      const bindingArn = remoteTerminalProductBindingArn(principal.accountOwnerId, userId, id);
      await this.evaluate(principal, request, action, bindingArn);
      const target = await this.repository.target(principal, id);
      if (!target || target.id !== id || target.userId !== userId) throw iamAccountDenied();
      const entitlementArn = remoteTerminalProductEntitlementArn(
        principal.accountOwnerId,
        userId,
        target.entitlementId,
      );
      const ids = [...new Set([userId, principal.accountOwnerId])];
      const snapshot = await this.users.targets(principal, ids);
      const policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const config = await this.config.getRemoteTerminalUnbindConfig();
      const recheck = async () => {
        const current = await this.users.targets(principal, ids);
        if (
          snapshot.length !== ids.length ||
          current.length !== ids.length ||
          current.some(
            (row) =>
              !snapshot.some((old) => old.id === row.id && old.updateTime.getTime() === row.updateTime.getTime()),
          ) ||
          fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies ||
          JSON.stringify(await this.config.getRemoteTerminalUnbindConfig()) !== JSON.stringify(config)
        )
          throw iamAccountDenied();
        await this.evaluate(principal, request, action, bindingArn);
        await this.evaluate(principal, request, action, entitlementArn);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const guard: TerminalPersonalUnbindGuard = {
        operation,
        targetId: id,
        entitlementId: target.entitlementId,
        config,
        users: {
          principal: { ...principal },
          targetUserId: userId,
          users: snapshot,
          recheck: async () => {
            if (guard.operation !== operation || guard.targetId !== id || guard.entitlementId !== target.entitlementId)
              throw iamAccountDenied();
            await recheck();
          },
        },
      };
      return { target, guard };
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("TerminalPersonalUnbindIam", LogCategory.SECURITY).warn("Personal unbind shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return undefined;
  }
}
