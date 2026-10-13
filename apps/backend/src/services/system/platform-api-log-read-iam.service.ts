import { performance } from "node:perf_hooks";
import { iamLegacyPermissionsForAction } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { isApiLogResourceId, platformApiLogArn } from "@/iam/resources/platform-api-log-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformApiLogReadRepository } from "@/store/system/platform-api-log-read.repository";
import type { PlatformApiLogReadStore } from "@/store/system/platform-api-log-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import { NotFoundError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
import type { SystemLogDetailDTO } from "@/api/dto/system/system.dto";
const action = "quyan:system:log:GetLogDetail";
export class PlatformApiLogReadIamService {
  private static instance: PlatformApiLogReadIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorize"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformApiLogReadStore = PlatformApiLogReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformApiLogReadIamService());
  }
  async read(
    id: string,
    request: TypedRequest,
    hydrate: () => Promise<SystemLogDetailDTO | null>,
  ): Promise<SystemLogDetailDTO> {
    const identity = getIamPrincipal(request),
      required = iamLegacyPermissionsForAction(action);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !isApiLogResourceId(id) ||
      !required.length ||
      !["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode)
    )
      throw iamAccountDenied();
    const principal = { ...identity },
      resource = platformApiLogArn(id);
    const prepare = async () => {
      const policyHash = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const snapshot = await this.snapshots.snapshot(principal, required);
      const authorize = async () => {
        await this.snapshots.recheck(principal, required, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policyHash) throw iamAccountDenied();
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
        await this.snapshots.recheck(principal, required, snapshot);
      };
      await authorize();
      const target = await this.repository.target(id);
      if (
        !target ||
        target.id !== id ||
        target.status !== 1 ||
        !(target.updateTime instanceof Date) ||
        !Number.isFinite(target.updateTime.getTime())
      )
        throw iamAccountDenied();
      const recheck = async () => {
        await authorize();
        const current = await this.repository.target(id);
        if (
          !current ||
          current.id !== id ||
          current.status !== 1 ||
          !(current.updateTime instanceof Date) ||
          current.updateTime.getTime() !== target.updateTime.getTime()
        )
          throw iamAccountDenied();
      };
      return { target, recheck };
    };
    if (env.security.iamAuthorizationMode !== "enforce") {
      const result = await this.permissions.checkUserPermissions(principal.subjectUserId, required, {
        assumedRoleSessionId: principal.roleSessionId,
      });
      if (
        !result.checkedPermissions.some(
          (permission) => required.includes(permission) && !result.missingPermissions?.includes(permission),
        )
      )
        throw iamAccountDenied();
      if (env.security.iamAuthorizationMode === "shadow") {
        try {
          await prepare();
        } catch {
          getLogger("ApiLogReadIam", LogCategory.SECURITY).warn("API log IAM shadow evaluation failed", {
            action,
            reason: "iam-evaluation-denied-or-unavailable",
          });
        }
      }
      const log = await hydrate();
      if (!log) throw new NotFoundError("Log not found", undefined, { messageKey: "system.logNotFound" });
      return log;
    }
    const guard = await prepare(),
      log = await hydrate();
    if (
      !log ||
      log.id !== id ||
      log.status !== 1 ||
      !(log.updateTime instanceof Date) ||
      log.updateTime.getTime() !== guard.target.updateTime.getTime()
    )
      throw iamAccountDenied();
    await guard.recheck();
    return log;
  }
}
