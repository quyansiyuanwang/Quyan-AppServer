import { performance } from "node:perf_hooks";
import { DATA_LIFECYCLE_DATASETS } from "@/constant/data-maintenance-datasets";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { isLifecycleDataset, platformLifecycleDatasetArn } from "@/iam/resources/platform-lifecycle-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { PlatformLifecycleExecutionRepository } from "@/store/system/platform-lifecycle-execution.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import type {
  LifecycleExecutionAction,
  LifecycleExecutionGuard,
  PlatformLifecycleExecutionStore,
} from "@/store/system/platform-lifecycle-execution.store";
import type { TypedRequest } from "@/types/express";
export class PlatformLifecycleExecutionIamService {
  private static instance: PlatformLifecycleExecutionIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    readonly repository: PlatformLifecycleExecutionStore = PlatformLifecycleExecutionRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformLifecycleExecutionIamService());
  }
  async prepare(
    action: LifecycleExecutionAction,
    datasets: readonly string[],
    request: TypedRequest,
  ): Promise<LifecycleExecutionGuard[]> {
    const identity = getIamPrincipal(request);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !["quyan:system:data_lifecycle:RunPolicy", "quyan:system:data_lifecycle:RunBatch"].includes(action) ||
      datasets.length > DATA_LIFECYCLE_DATASETS.length ||
      new Set(datasets).size !== datasets.length ||
      datasets.some((d) => !isLifecycleDataset(d)) ||
      (action === "quyan:system:data_lifecycle:RunPolicy" && datasets.length !== 1)
    )
      throw iamAccountDenied();
    const principal = { ...identity };
    await this.iam.loadPolicies(principal);
    const snapshot = await this.snapshots.snapshot(principal, Permission.SYSTEM_DATA_LIFECYCLE_MANAGE);
    const check = async (dataset: string) => {
      await this.snapshots.recheck(principal, Permission.SYSTEM_DATA_LIFECYCLE_MANAGE, snapshot);
      const start = performance.now(),
        resource = platformLifecycleDatasetArn(dataset);
      const result = await this.iam.authorize({
        principal,
        action,
        resource,
        context: requestConditionContext(request, principal),
      });
      if (!result) throw iamAccountDenied();
      const decisions = (request.iamDecisions ??= []);
      const index = decisions.findIndex((d) => d.action === action && d.resource === resource);
      if (index < 0) decisions.push({ ...result, action, resource });
      else decisions[index] = { ...result, action, resource };
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
    // Authorize all selected resources before reading candidate data or performing any work.
    const selected = datasets.length
      ? [...datasets]
      : (await this.repository.policies()).filter((p) => p.enabled).map((p) => p.dataset);
    if (selected.some((d) => !isLifecycleDataset(d))) throw iamAccountDenied();
    for (const dataset of selected) await check(dataset);
    const guards: LifecycleExecutionGuard[] = [];
    for (const dataset of selected) {
      if (!isLifecycleDataset(dataset)) throw iamAccountDenied();
      const policy = await this.repository.policy(dataset);
      if (!policy || policy.status !== 1 || policy.dataset !== dataset || (!datasets.length && !policy.enabled))
        throw iamAccountDenied();
      const guard: LifecycleExecutionGuard = {
        action,
        dataset,
        policy,
        group: snapshot.group,
        users: {
          principal,
          targetUserId: principal.subjectUserId,
          users: snapshot.users,
          recheck: () => check(dataset),
        },
        recheck: async () => {
          await check(dataset);
          const current = await this.repository.policy(dataset);
          if (
            !current ||
            current.id !== guard.policy.id ||
            current.status !== 1 ||
            current.updateTime.getTime() !== guard.policy.updateTime.getTime()
          )
            throw iamAccountDenied();
        },
      };
      guards.push(guard);
    }
    for (const guard of guards) await guard.recheck();
    return guards;
  }
}
