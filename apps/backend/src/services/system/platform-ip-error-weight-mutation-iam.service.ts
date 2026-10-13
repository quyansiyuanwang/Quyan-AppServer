import { performance } from "node:perf_hooks";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { platformIpAddressIdentifier, platformIpAddressArn } from "@/iam/resources/platform-ip-address-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformIpErrorWeightMutationRepository } from "@/store/security/platform-ip-error-weight-mutation.repository";
import type {
  IpErrorWeightAction,
  IpErrorWeightMutationGuard,
  PlatformIpErrorWeightMutationStore,
} from "@/store/security/platform-ip-error-weight-mutation.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { RedisService } from "@/services/infrastructure/redis.service";
import type { IpErrorWeightWrite } from "@/services/infrastructure/ip-error-weight-script";
import { IPBlackListService } from "./ipblacklist.service";
import { setIpErrorWeightBodySchema } from "@/api/schema/system/ipblacklist.schema";
import { BadRequestError, InternalServerError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export class PlatformIpErrorWeightMutationIamService {
  private static instance: PlatformIpErrorWeightMutationIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorize"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformIpErrorWeightMutationStore = PlatformIpErrorWeightMutationRepository.getInstance(),
    private readonly redis: Pick<RedisService, "writeIpErrorWeightWithResult"> = RedisService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly reports: Pick<
      IPBlackListService,
      "setIpErrorWeight" | "resetIpErrorWeight"
    > = IPBlackListService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformIpErrorWeightMutationIamService());
  }
  private async prepare(
    action: IpErrorWeightAction,
    ip: string,
    principal: IamPrincipal,
    request: TypedRequest,
  ): Promise<IpErrorWeightMutationGuard> {
    const policyHash = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
    const snapshot = await this.snapshots.snapshot(principal, Permission.IP_BLACKLIST_UPDATE),
      revision = await this.repository.authorizationRevision(principal),
      resource = platformIpAddressArn(ip);
    const recheck = async () => {
      await this.snapshots.recheck(principal, Permission.IP_BLACKLIST_UPDATE, snapshot);
      if (
        (await this.repository.authorizationRevision(principal)) !== revision ||
        fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policyHash
      )
        throw iamAccountDenied();
      const start = performance.now(),
        result = await this.iam.authorize({
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
      await this.snapshots.recheck(principal, Permission.IP_BLACKLIST_UPDATE, snapshot);
      if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policyHash) throw iamAccountDenied();
    };
    await recheck();
    return {
      action,
      ipAddress: ip,
      authorizationRevision: revision,
      group: snapshot.group,
      users: { principal, targetUserId: principal.subjectUserId, users: snapshot.users, recheck },
    };
  }
  async set(ip: string, weight: number, request: TypedRequest): Promise<void> {
    const parsed = setIpErrorWeightBodySchema.strict().safeParse({ weight });
    if (!parsed.success) throw new BadRequestError("Invalid IP weight", undefined, { messageKey: "errors.badRequest" });
    return this.write(
      "quyan:system:ip_blacklist:SetIPAddressErrorWeight",
      ip,
      { kind: "set", weight: parsed.data.weight },
      request,
    );
  }
  async reset(ip: string, request: TypedRequest): Promise<void> {
    return this.write("quyan:system:ip_blacklist:ResetIPAddressErrorWeight", ip, { kind: "reset" }, request);
  }
  private async write(
    action: IpErrorWeightAction,
    ip: string,
    input: IpErrorWeightWrite,
    request: TypedRequest,
  ): Promise<void> {
    const identity = getIamPrincipal(request);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !platformIpAddressIdentifier(ip) ||
      !["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode)
    )
      throw iamAccountDenied();
    const principal = { ...identity };
    if (env.security.iamAuthorizationMode !== "enforce") {
      if (
        !(
          await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.IP_BLACKLIST_UPDATE], {
            assumedRoleSessionId: principal.roleSessionId,
          })
        ).hasPermission
      )
        throw iamAccountDenied();
      if (env.security.iamAuthorizationMode === "shadow")
        try {
          await this.prepare(action, ip, principal, request);
        } catch {
          getLogger("IPErrorWeightMutationIam", LogCategory.SECURITY).warn("IP weight IAM shadow evaluation failed", {
            action,
            reason: "iam-evaluation-denied-or-unavailable",
          });
        }
      if (input.kind === "set") return this.reports.setIpErrorWeight(ip, input.weight);
      return this.reports.resetIpErrorWeight(ip);
    }
    const guard = await this.prepare(action, ip, principal, request);
    await this.repository.admit(guard, async () => {
      const confirmed = await this.redis.writeIpErrorWeightWithResult(ip, input);
      if (confirmed !== true)
        throw new InternalServerError("IP weight mutation not confirmed", undefined, {
          messageKey: "ipBlacklist.weightMutationUnavailable",
        });
    });
  }
}
