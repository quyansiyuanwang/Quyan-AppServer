import { performance } from "node:perf_hooks";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { DATA_LIFECYCLE_DATASETS } from "@/constant/data-maintenance-datasets";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { requestConditionContext } from "@/iam/request/condition-context";
import { getIamPrincipal } from "@/iam/request/principal-context";
import {
  isLifecycleDataset,
  platformLifecycleDatasetArn,
  platformLifecycleScheduleArn,
} from "@/iam/resources/platform-lifecycle-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export type LifecycleDatasetReadAction =
  | "quyan:system:data_lifecycle:ListPolicies"
  | "quyan:system:data_lifecycle:PreviewPolicy"
  | "quyan:system:data_lifecycle:ListCandidates";
type LifecycleReadAction = LifecycleDatasetReadAction | "quyan:system:data_lifecycle:GetSchedule";

export class PlatformLifecycleReadIamService {
  private static instance: PlatformLifecycleReadIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformLifecycleReadIamService());
  }

  async readDatasets<T>(
    action: LifecycleDatasetReadAction,
    datasets: readonly string[],
    request: TypedRequest | undefined,
    read: (allowed: ReadonlySet<string>) => Promise<T>,
  ) {
    if (
      ![
        "quyan:system:data_lifecycle:ListPolicies",
        "quyan:system:data_lifecycle:PreviewPolicy",
        "quyan:system:data_lifecycle:ListCandidates",
      ].includes(action) ||
      !Array.isArray(datasets) ||
      !datasets.length ||
      datasets.length > DATA_LIFECYCLE_DATASETS.length ||
      datasets.some((d) => !isLifecycleDataset(d)) ||
      (action !== "quyan:system:data_lifecycle:ListPolicies" && datasets.length !== 1)
    )
      throw iamAccountDenied();
    const selected = [...new Set(datasets)];
    return this.read(
      action,
      selected.map(platformLifecycleDatasetArn),
      request,
      (allowed) => read(new Set(selected.filter((_, i) => allowed.has(i)))),
      action === "quyan:system:data_lifecycle:ListPolicies",
    );
  }
  readSchedule<T>(request: TypedRequest | undefined, read: () => Promise<T>) {
    return this.read("quyan:system:data_lifecycle:GetSchedule", [platformLifecycleScheduleArn()], request, read, false);
  }
  private async read<T>(
    action: LifecycleReadAction,
    resources: readonly string[],
    request: TypedRequest | undefined,
    read: (allowed: ReadonlySet<number>) => Promise<T>,
    filtered: boolean,
  ) {
    const identity = request && getIamPrincipal(request),
      mode = env.security.iamAuthorizationMode;
    if (
      !request ||
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !["legacy", "shadow", "enforce"].includes(mode)
    )
      throw iamAccountDenied();
    const principal = { ...identity };
    const evaluate = async (indices: readonly number[]) => {
      if (!indices.length) return new Set<number>();
      const start = performance.now(),
        results = await this.iam.authorizeMany({
          principal,
          action,
          resources: indices.map((i) => resources[i]),
          context: requestConditionContext(request, principal),
        });
      if (!Array.isArray(results) || results.length !== indices.length || results.some((r) => !r))
        throw iamAccountDenied();
      results.forEach((result, i) => {
        (request.iamDecisions ??= []).push({ ...result, action, resource: resources[indices[i]] });
        auditIamDecision({
          requestId: request.res?.locals.requestId,
          principal,
          action,
          resource: resources[indices[i]],
          result,
          evaluationLatencyMs: performance.now() - start,
          authorizationMode: mode === "shadow" ? "shadow" : "enforce",
          ...(mode === "shadow" ? { legacyAllowed: true } : {}),
        });
      });
      return new Set(indices.filter((_, i) => results[i].decision === "Allow"));
    };
    const all = resources.map((_, i) => i);
    const prepare = async () => {
      await this.iam.loadPolicies(principal);
      const snapshot = await this.snapshots.snapshot(principal, Permission.SYSTEM_DATA_LIFECYCLE_MANAGE);
      const allowed = await evaluate(all);
      if (!filtered && allowed.size !== resources.length) throw iamAccountDenied();
      return {
        allowed,
        recheck: async () => {
          await this.iam.loadPolicies(principal);
          await this.snapshots.recheck(principal, Permission.SYSTEM_DATA_LIFECYCLE_MANAGE, snapshot);
          const remaining = await evaluate([...allowed]);
          if (remaining.size !== allowed.size) throw iamAccountDenied();
          await this.snapshots.recheck(principal, Permission.SYSTEM_DATA_LIFECYCLE_MANAGE, snapshot);
        },
      };
    };
    if (mode === "enforce") {
      const guard = await prepare();
      const result = await read(guard.allowed);
      await guard.recheck();
      return result;
    }
    if (
      !(
        await this.permissions.checkUserPermissions(
          principal.subjectUserId,
          [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE],
          { assumedRoleSessionId: principal.roleSessionId },
        )
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "shadow") {
      try {
        const guard = await prepare();
        await guard.recheck();
      } catch {
        getLogger("LifecycleReadIam", LogCategory.SECURITY).warn("Lifecycle read IAM shadow evaluation failed", {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    }
    return read(new Set(all));
  }
}
