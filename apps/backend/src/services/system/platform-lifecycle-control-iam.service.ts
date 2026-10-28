import { performance } from "node:perf_hooks";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { requestConditionContext } from "@/iam/request/condition-context";
import { getIamPrincipal } from "@/iam/request/principal-context";
import {
  isLifecycleDataset,
  platformLifecycleDatasetArn,
  platformLifecycleScheduleArn,
} from "@/iam/resources/platform-lifecycle-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformLifecycleControlRepository } from "@/store/system/platform-lifecycle-control.repository";
import type {
  LifecycleControlAction,
  LifecycleControlGuard,
  PlatformLifecycleControlStore,
} from "@/store/system/platform-lifecycle-control.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
export class PlatformLifecycleControlIamService {
  private static instance: PlatformLifecycleControlIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformLifecycleControlStore = PlatformLifecycleControlRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformLifecycleControlIamService());
  }
  async prepare(
    action: LifecycleControlAction,
    request: TypedRequest,
    dataset?: string,
    hydrate = true,
  ): Promise<LifecycleControlGuard | undefined> {
    const identity = getIamPrincipal(request);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !["quyan:system:data_lifecycle:UpdatePolicy", "quyan:system:data_lifecycle:UpdateSchedule"].includes(action) ||
      (action.endsWith(":UpdatePolicy") ? !isLifecycleDataset(dataset) : dataset !== undefined)
    )
      throw iamAccountDenied();
    const principal = { ...identity },
      resource = dataset ? platformLifecycleDatasetArn(dataset) : platformLifecycleScheduleArn();
    await this.iam.loadPolicies(principal);
    const snapshot = await this.snapshots.snapshot(principal, Permission.SYSTEM_DATA_LIFECYCLE_MANAGE);
    const recheck = async () => {
      await this.snapshots.recheck(principal, Permission.SYSTEM_DATA_LIFECYCLE_MANAGE, snapshot);
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
    await recheck();
    const policy = dataset ? await this.repository.policyTarget(principal, dataset) : undefined;
    const configs = dataset ? [] : await this.repository.scheduleTargets(principal);
    if (
      (dataset && (!policy || policy.dataset !== dataset || policy.status !== 1)) ||
      configs.some((c) => c.status !== 1)
    )
      throw iamAccountDenied();
    await recheck();
    await this.snapshots.recheck(principal, Permission.SYSTEM_DATA_LIFECYCLE_MANAGE, snapshot);
    if (!hydrate) return undefined;
    return {
      action,
      dataset,
      policy: policy ?? undefined,
      configs,
      group: snapshot.group,
      users: { principal, targetUserId: principal.subjectUserId, users: snapshot.users, recheck },
    };
  }
  updatePolicy(guard: LifecycleControlGuard, input: { enabled: boolean; hotRetentionDays: number }) {
    return this.repository.updatePolicy(guard, input);
  }
  updateSchedule(guard: LifecycleControlGuard, input: { enabled: boolean; time: string }) {
    return this.repository.updateSchedule(guard, input);
  }
  policyTarget(guard: LifecycleControlGuard) {
    return this.repository.policyTarget(guard.users.principal, guard.dataset!);
  }
}
