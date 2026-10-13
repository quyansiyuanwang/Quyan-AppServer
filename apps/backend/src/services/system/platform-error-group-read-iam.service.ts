import { performance } from "node:perf_hooks";
import { Permission, getIamActionDefinition } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { isErrorGroupResourceId, platformErrorGroupArn } from "@/iam/resources/platform-error-group-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformErrorGroupReadRepository } from "@/store/system/platform-error-group-read.repository";
import type { PlatformErrorGroupReadStore } from "@/store/system/platform-error-group-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export type PlatformErrorGroupReadAction =
  | "quyan:system:error_report:GetErrorGroup"
  | "quyan:system:error_report:ListErrorOccurrences";
export class PlatformErrorGroupReadIamService {
  private static instance: PlatformErrorGroupReadIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformErrorGroupReadStore = PlatformErrorGroupReadRepository.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformErrorGroupReadIamService());
  }
  async read<T>(
    action: PlatformErrorGroupReadAction,
    id: string,
    request: TypedRequest,
    hydrate: (native: boolean) => Promise<T>,
  ): Promise<T> {
    const identity = getIamPrincipal(request),
      definition = getIamActionDefinition(action);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !isErrorGroupResourceId(id) ||
      !["quyan:system:error_report:GetErrorGroup", "quyan:system:error_report:ListErrorOccurrences"].includes(action) ||
      !definition ||
      definition.legacyPermission !== Permission.SYSTEM_ERROR_REPORT_READ ||
      definition.authorizationBoundary !== "platform" ||
      !definition.resourceTypes.includes("platform/error-group")
    )
      throw iamAccountDenied();
    const principal = { ...identity },
      resource = platformErrorGroupArn(id);
    const prepare = async () => {
      await this.iam.loadPolicies(principal);
      const snapshot = await this.snapshots.snapshot(principal, Permission.SYSTEM_ERROR_REPORT_READ);
      const authorize = async () => {
        await this.snapshots.recheck(principal, Permission.SYSTEM_ERROR_REPORT_READ, snapshot);
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
          current.id !== target.id ||
          current.status !== 1 ||
          !(current.updateTime instanceof Date) ||
          current.updateTime.getTime() !== target.updateTime.getTime()
        )
          throw iamAccountDenied();
      };
      return recheck;
    };
    if (env.security.iamAuthorizationMode !== "enforce") {
      if (
        !["legacy", "shadow"].includes(env.security.iamAuthorizationMode) ||
        !(
          await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.SYSTEM_ERROR_REPORT_READ], {
            assumedRoleSessionId: principal.roleSessionId,
          })
        ).hasPermission
      )
        throw iamAccountDenied();
      if (env.security.iamAuthorizationMode === "shadow") {
        try {
          await prepare();
        } catch {
          getLogger("ErrorGroupReadIam", LogCategory.SECURITY).warn("Error report IAM shadow evaluation failed", {
            reason: "iam-evaluation-denied-or-unavailable",
          });
        }
      }
      return hydrate(false);
    }
    const recheck = await prepare();
    const result = await hydrate(true);
    await recheck();
    return result;
  }
}
