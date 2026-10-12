import { performance } from "node:perf_hooks";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import { isMaintenanceDataset, platformMaintenanceDatasetArn } from "@/iam/resources/platform-maintenance-resources";
import { DATA_MAINTENANCE_DATASETS } from "@/constant/data-maintenance-datasets";
export type MaintenancePreviewAction =
  | "quyan:system:data_maintenance:PreviewOptimize"
  | "quyan:system:data_maintenance:PreviewImport";
export class PlatformMaintenancePreviewIamService {
  private static instance: PlatformMaintenancePreviewIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformMaintenancePreviewIamService());
  }
  async read<T>(
    action: MaintenancePreviewAction,
    datasets: readonly string[],
    request: TypedRequest | undefined,
    read: () => Promise<T>,
  ) {
    const identity = request && getIamPrincipal(request);
    if (
      !request ||
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode) ||
      !["quyan:system:data_maintenance:PreviewOptimize", "quyan:system:data_maintenance:PreviewImport"].includes(
        action,
      ) ||
      !Array.isArray(datasets) ||
      !datasets.length ||
      datasets.length > DATA_MAINTENANCE_DATASETS.length ||
      datasets.some((d) => !isMaintenanceDataset(d)) ||
      (action === "quyan:system:data_maintenance:PreviewImport" && datasets.length !== 1)
    )
      throw iamAccountDenied();
    const principal = { ...identity },
      resources = [...new Set(datasets)].map(platformMaintenanceDatasetArn);
    const evaluate = async () => {
      const start = performance.now(),
        results = await this.iam.authorizeMany({
          principal,
          action,
          resources,
          context: requestConditionContext(request, principal),
        });
      if (!Array.isArray(results) || results.length !== resources.length || results.some((r) => !r))
        throw iamAccountDenied();
      results.forEach((result, i) => {
        (request.iamDecisions ??= []).push({ ...result, action, resource: resources[i] });
        auditIamDecision({
          requestId: request.res?.locals.requestId,
          principal,
          action,
          resource: resources[i],
          result,
          evaluationLatencyMs: performance.now() - start,
          authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
          ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
        });
      });
      if (results.some((r) => r.decision !== "Allow")) throw iamAccountDenied();
    };
    const prepare = async () => {
      await this.iam.loadPolicies(principal);
      const snapshot = await this.repository.snapshot(principal, Permission.SYSTEM_DATA_MAINTENANCE_MANAGE);
      await evaluate();
      return async () => {
        await this.repository.recheck(principal, Permission.SYSTEM_DATA_MAINTENANCE_MANAGE, snapshot);
        await evaluate();
        await this.repository.recheck(principal, Permission.SYSTEM_DATA_MAINTENANCE_MANAGE, snapshot);
      };
    };
    if (env.security.iamAuthorizationMode === "enforce") {
      const recheck = await prepare();
      const result = await read();
      await recheck();
      return result;
    }
    if (
      !(
        await this.permissions.checkUserPermissions(
          principal.subjectUserId,
          [Permission.SYSTEM_DATA_MAINTENANCE_MANAGE],
          { assumedRoleSessionId: principal.roleSessionId },
        )
      ).hasPermission
    )
      throw iamAccountDenied();
    if (env.security.iamAuthorizationMode === "shadow") {
      try {
        const recheck = await prepare();
        await recheck();
      } catch {
        getLogger("MaintenancePreviewIam", LogCategory.SECURITY).warn(
          "Maintenance preview IAM shadow evaluation failed",
          { action, reason: "iam-evaluation-denied-or-unavailable" },
        );
      }
    }
    return read();
  }
}
