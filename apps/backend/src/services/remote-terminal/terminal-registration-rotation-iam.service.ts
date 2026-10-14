import {
  IAM_TERMINAL_REGISTRATION_ROTATIONS,
  Permission,
  type IamPrincipal,
  type IamTerminalRegistrationRotation,
} from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  platformTerminalEntitlementArn,
  platformTerminalRegistrationTokenArn,
} from "@/iam/resources/platform-terminal-entitlement-resources";
import {
  remoteTerminalProductEntitlementArn,
  remoteTerminalProductRegistrationTokenArn,
  isRemoteTerminalId,
} from "@/iam/resources/remote-terminal-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { TerminalRegistrationRotationRepository } from "@/store/remote-terminal-product/terminal-registration-rotation.repository";
import type {
  TerminalRegistrationRotationStore,
  TerminalRegistrationRotationGuard,
} from "@/store/remote-terminal-product/terminal-registration-rotation.store";
import { PermissionService } from "@/services/users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export class TerminalRegistrationRotationIamService {
  private static instance: TerminalRegistrationRotationIamService;
  static getInstance() {
    return (this.instance ??= new TerminalRegistrationRotationIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "authorize" | "loadPolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: TerminalRegistrationRotationStore = TerminalRegistrationRotationRepository.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly accounts: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
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
    operation: IamTerminalRegistrationRotation,
    actorUserId: string,
    request: TypedRequest | undefined,
    id: string,
  ) {
    const definition = IAM_TERMINAL_REGISTRATION_ROTATIONS.find((entry) => entry.operation === operation),
      mode = env.security.iamAuthorizationMode;
    if (!definition || !isRemoteTerminalId(id) || !["legacy", "shadow", "enforce"].includes(mode))
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
      definition.management &&
      !(
        await this.permissions.checkUserPermissions(
          actorUserId,
          [Permission.REMOTE_TERMINAL_REGISTRATION_TOKEN_WRITE],
          { assumedRoleSessionId: principal.roleSessionId },
        )
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return undefined;
    const native = async () => {
      const action = "quyan:remote_terminal:" + operation;
      const owner = await this.repository.owner(principal, operation, id);
      if (!owner || (!definition.management && owner !== actorUserId)) throw iamAccountDenied();
      const resource = definition.management
        ? platformTerminalEntitlementArn(owner, id)
        : remoteTerminalProductEntitlementArn(principal.accountOwnerId, owner, id);
      const ids = [...new Set([actorUserId, principal.accountOwnerId])];
      const platformSnapshot = definition.management
        ? await this.snapshots.snapshot(principal, Permission.REMOTE_TERMINAL_REGISTRATION_TOKEN_WRITE)
        : undefined;
      const users = platformSnapshot?.users ?? (await this.accounts.targets(principal, ids));
      const policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const identities = async () => {
        if (platformSnapshot)
          await this.snapshots.recheck(
            principal,
            Permission.REMOTE_TERMINAL_REGISTRATION_TOKEN_WRITE,
            platformSnapshot,
          );
        else {
          const current = await this.accounts.targets(principal, ids);
          if (
            current.length !== ids.length ||
            users.length !== ids.length ||
            current.some(
              (row) => !users.some((old) => row.id === old.id && row.updateTime.getTime() === old.updateTime.getTime()),
            )
          )
            throw iamAccountDenied();
        }
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      const recheck = async () => {
        await identities();
        await this.evaluate(principal, request, action, resource);
        await identities();
      };
      await recheck();
      const target = await this.repository.target(principal, operation, id);
      if (!target || target.id !== id || target.userId !== owner || ![0, 1].includes(target.status))
        throw iamAccountDenied();
      const guard: TerminalRegistrationRotationGuard = {
        operation,
        targetId: id,
        targetUserId: owner,
        ...(platformSnapshot ? { group: platformSnapshot.group } : {}),
        users: {
          principal: { ...principal },
          targetUserId: actorUserId,
          users,
          recheck: async () => {
            if (guard.operation !== operation || guard.targetId !== id || guard.targetUserId !== owner)
              throw iamAccountDenied();
            await recheck();
          },
        },
        recheckToken: async (tokenId) => {
          await guard.users.recheck();
          const arn = definition.management
            ? platformTerminalRegistrationTokenArn(owner, id, tokenId)
            : remoteTerminalProductRegistrationTokenArn(principal.accountOwnerId, owner, id, tokenId);
          await this.evaluate(principal, request, action, arn);
          await guard.users.recheck();
        },
      };
      await recheck();
      if (target.registrationToken) await guard.recheckToken(target.registrationToken.id);
      return { guard, target };
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("TerminalRegistrationIam", LogCategory.SECURITY).warn(
        "Registration rotation shadow evaluation failed",
        { action: "quyan:remote_terminal:" + operation, reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
    return undefined;
  }
}
