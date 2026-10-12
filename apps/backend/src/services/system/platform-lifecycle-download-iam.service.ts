import { performance } from "node:perf_hooks";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  isCanonicalLifecycleId,
  isLifecycleDataset,
  platformLifecycleArtifactArn,
} from "@/iam/resources/platform-lifecycle-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformLifecycleHistoryRepository } from "@/store/system/platform-lifecycle-history.repository";
import type {
  PlatformLifecycleDownloadStore,
  LifecycleArtifactView,
  LifecycleRunTarget,
} from "@/store/system/platform-lifecycle-history.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
export type LifecycleDownloadGuard = { artifact: LifecycleArtifactView; recheck: () => Promise<void> };
export class PlatformLifecycleDownloadIamService {
  private static instance: PlatformLifecycleDownloadIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformLifecycleDownloadStore = PlatformLifecycleHistoryRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformLifecycleDownloadIamService());
  }
  private valid(target: LifecycleRunTarget) {
    return (
      isCanonicalLifecycleId(target.id) &&
      target.status === 1 &&
      isLifecycleDataset(target.dataset) &&
      target.createTime instanceof Date &&
      Number.isFinite(target.createTime.getTime()) &&
      target.updateTime instanceof Date &&
      Number.isFinite(target.updateTime.getTime())
    );
  }
  private unchanged(expected: LifecycleRunTarget, actual: LifecycleRunTarget) {
    return (
      this.valid(actual) &&
      actual.id === expected.id &&
      actual.dataset === expected.dataset &&
      actual.createTime.getTime() === expected.createTime.getTime() &&
      actual.updateTime.getTime() === expected.updateTime.getTime()
    );
  }
  async prepare(id: string, request?: TypedRequest, hydrate = true): Promise<LifecycleDownloadGuard | undefined> {
    const identity = request && getIamPrincipal(request);
    if (
      !request ||
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !isCanonicalLifecycleId(id)
    )
      throw iamAccountDenied();
    const principal = { ...identity },
      action = "quyan:system:data_lifecycle:DownloadArtifact";
    await this.iam.loadPolicies(principal);
    const snapshot = await this.snapshots.snapshot(principal, Permission.SYSTEM_DATA_LIFECYCLE_MANAGE);
    const target = await this.repository.targetDownload(principal, id);
    if (
      !target ||
      target.id !== id ||
      !this.valid(target) ||
      !this.valid(target.lifecycleRun) ||
      target.lifecycleRunId !== target.lifecycleRun.id ||
      target.dataset !== target.lifecycleRun.dataset
    )
      throw iamAccountDenied();
    const resource = platformLifecycleArtifactArn(target.lifecycleRunId, target.id),
      run = target.lifecycleRun;
    const evaluate = async () => {
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
    const recheck = async () => {
      await this.iam.loadPolicies(principal);
      await this.snapshots.recheck(principal, Permission.SYSTEM_DATA_LIFECYCLE_MANAGE, snapshot);
      await evaluate();
      const current = await this.repository.targetDownload(principal, id);
      if (
        !current ||
        !this.unchanged(target, current) ||
        current.lifecycleRunId !== run.id ||
        !this.unchanged(run, current.lifecycleRun)
      )
        throw iamAccountDenied();
      await this.snapshots.recheck(principal, Permission.SYSTEM_DATA_LIFECYCLE_MANAGE, snapshot);
    };
    await recheck();
    if (!hydrate) return undefined;
    const rows = await this.repository.hydrateArtifacts(principal, run, [target]);
    if (
      rows.length !== 1 ||
      !this.unchanged(target, rows[0]) ||
      rows[0].lifecycleRunId !== run.id ||
      rows[0].deletedAt !== null ||
      typeof rows[0].objectKey !== "string" ||
      !rows[0].objectKey ||
      rows[0].objectKey.length > 512 ||
      Array.from(rows[0].objectKey).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      (rows[0].expiresAt !== null &&
        (!(rows[0].expiresAt instanceof Date) ||
          !Number.isFinite(rows[0].expiresAt.getTime()) ||
          rows[0].expiresAt.getTime() <= Date.now()))
    )
      throw iamAccountDenied();
    const artifact = Object.freeze({ ...rows[0] });
    await recheck();
    return { artifact, recheck };
  }
}
