import { performance } from "node:perf_hooks";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { isMaintenanceDataset, platformMaintenanceDatasetArn } from "@/iam/resources/platform-maintenance-resources";
import { DATA_MAINTENANCE_DATASETS, type DataMaintenanceDataset } from "@/constant/data-maintenance-datasets";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformMaintenanceOptimizeRepository } from "@/store/system/platform-maintenance-optimize.repository";
import type {
  MaintenanceOptimizeGuard,
  MaintenanceOptimizeInput,
  PlatformMaintenanceOptimizeStore,
} from "@/store/system/platform-maintenance-optimize.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
export class PlatformMaintenanceOptimizeIamService {
  private static instance: PlatformMaintenanceOptimizeIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformMaintenanceOptimizeStore = PlatformMaintenanceOptimizeRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformMaintenanceOptimizeIamService());
  }
  async prepare(datasets: readonly string[], request?: TypedRequest, hydrate = true) {
    const identity = request && getIamPrincipal(request);
    if (
      !request ||
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !Array.isArray(datasets) ||
      !datasets.length ||
      datasets.length > DATA_MAINTENANCE_DATASETS.length ||
      datasets.some((d) => !isMaintenanceDataset(d))
    )
      throw iamAccountDenied();
    const principal = { ...identity },
      selected = [...new Set(datasets)] as DataMaintenanceDataset[],
      resources = selected.map(platformMaintenanceDatasetArn),
      action = "quyan:system:data_maintenance:CreateOptimizeRun" as const;
    await this.iam.loadPolicies(principal);
    const snapshot = await this.snapshots.snapshot(principal, Permission.SYSTEM_DATA_MAINTENANCE_MANAGE);
    const recheck = async () => {
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
    await recheck();
    if (!hydrate) return undefined;
    const guard: MaintenanceOptimizeGuard = {
      action,
      datasets: selected,
      group: snapshot.group,
      users: { principal, targetUserId: principal.subjectUserId, users: snapshot.users, recheck },
    };
    return guard;
  }
  create(guard: MaintenanceOptimizeGuard, input: MaintenanceOptimizeInput, requestId?: string) {
    return this.repository.create(guard, input, requestId);
  }
}
