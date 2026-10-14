import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { platformCarpoolOrderArn } from "@/iam/resources/platform-carpool-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { CarpoolRepository } from "@/store/billing/carpool.repository";
import {
  carpoolOrderManagementRevision,
  type CarpoolOrderManagementWriteGuard,
} from "@/store/billing/carpool-order-management-write";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";

export class PlatformCarpoolOrderWriteIamService {
  private static instance: PlatformCarpoolOrderWriteIamService;
  static getInstance() {
    return (this.instance ??= new PlatformCarpoolOrderWriteIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "authorize" | "loadPolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: Pick<CarpoolRepository, "findOrderManagementTarget"> = CarpoolRepository.getInstance(),
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
  async prepare(actorUserId: string | undefined, request: TypedRequest | undefined, id: string) {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode) || !isPlatformLogResourceId(id)) throw iamAccountDenied();
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
        await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.CARPOOL_ORDER_FULFILL], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return undefined;
    const native = async () => {
      const action = "quyan:carpool:AcceptOrder",
        resource = platformCarpoolOrderArn(id);
      const snapshot = await this.snapshots.snapshot(principal, Permission.CARPOOL_ORDER_FULFILL),
        policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const recheck = async () => {
        await this.snapshots.recheck(principal, Permission.CARPOOL_ORDER_FULFILL, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
        await this.evaluate(principal, request, action, resource);
        await this.snapshots.recheck(principal, Permission.CARPOOL_ORDER_FULFILL, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      await recheck();
      const record = await this.repository.findOrderManagementTarget(id);
      if (!record || record.id !== id || ![0, 1].includes(record.status)) throw iamAccountDenied();
      const guard: CarpoolOrderManagementWriteGuard = {
        operation: "AcceptOrder",
        target: { record, revision: carpoolOrderManagementRevision(record) },
        group: snapshot.group,
        users: { principal: { ...principal }, targetUserId: principal.subjectUserId, users: snapshot.users, recheck },
      };
      await recheck();
      return guard;
    };
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("CarpoolOrderWriteIam", LogCategory.SECURITY).warn("Carpool acceptance shadow evaluation failed", {
        action: "quyan:carpool:AcceptOrder",
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return undefined;
  }
}
