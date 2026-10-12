import { performance } from "node:perf_hooks";
import { env } from "@/config/env";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { requestConditionContext } from "@/iam/request/condition-context";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import {
  isCanonicalLifecycleId,
  isLifecycleDataset,
  platformLifecycleRunArn,
  platformLifecycleArtifactArn,
} from "@/iam/resources/platform-lifecycle-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformLifecycleHistoryRepository } from "@/store/system/platform-lifecycle-history.repository";
import type {
  PlatformLifecycleHistoryStore,
  LifecycleRunTarget,
  LifecycleArtifactTarget,
  LifecycleRunView,
} from "@/store/system/platform-lifecycle-history.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { lifecycleRunsQuerySchema } from "@/api/schema/system/data-lifecycle.schema";
import { BadRequestError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
type HistoryAction = "quyan:system:data_lifecycle:ListRuns" | "quyan:system:data_lifecycle:ListArtifacts";
type HistoryGuard = { principal: IamPrincipal; request: TypedRequest; finish: () => Promise<void> };
const LIST_RUNS: HistoryAction = "quyan:system:data_lifecycle:ListRuns",
  LIST_ARTIFACTS: HistoryAction = "quyan:system:data_lifecycle:ListArtifacts";
const batchSize = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
export class PlatformLifecycleHistoryIamService {
  private static instance: PlatformLifecycleHistoryIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformLifecycleHistoryStore = PlatformLifecycleHistoryRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformLifecycleHistoryIamService());
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
  private stable<T extends LifecycleRunTarget>(expected: readonly T[], actual: readonly T[]) {
    if (
      actual.length !== expected.length ||
      new Set(actual.map((t) => t.id)).size !== actual.length ||
      actual.some(
        (t) =>
          !this.valid(t) ||
          !expected.some(
            (e) =>
              e.id === t.id &&
              e.dataset === t.dataset &&
              e.createTime.getTime() === t.createTime.getTime() &&
              e.updateTime.getTime() === t.updateTime.getTime() &&
              (!("lifecycleRunId" in e) || ("lifecycleRunId" in t && e.lifecycleRunId === t.lifecycleRunId)),
          ),
      )
    )
      throw iamAccountDenied();
  }
  private pagination(page: number, pageSize: number) {
    if (!lifecycleRunsQuerySchema.strict().safeParse({ page, pageSize }).success)
      throw new BadRequestError("Invalid lifecycle history pagination", undefined, { messageKey: "errors.badRequest" });
  }
  private async guard(request?: TypedRequest): Promise<HistoryGuard> {
    const identity = request && getIamPrincipal(request);
    if (!request || !identity || request.oauthAccessToken || identity.subjectUserId !== identity.principalUserId)
      throw iamAccountDenied();
    const principal = { ...identity };
    await this.iam.loadPolicies(principal);
    const snapshot = await this.snapshots.snapshot(principal, Permission.SYSTEM_DATA_LIFECYCLE_MANAGE);
    return {
      principal,
      request,
      finish: async () => {
        await this.iam.loadPolicies(principal);
        await this.snapshots.recheck(principal, Permission.SYSTEM_DATA_LIFECYCLE_MANAGE, snapshot);
      },
    };
  }
  private async allowed(guard: HistoryGuard, action: HistoryAction, resources: readonly string[]) {
    if (!resources.length) return new Set<string>();
    if (resources.length > batchSize) throw iamAccountDenied();
    const start = performance.now(),
      results = await this.iam.authorizeMany({
        principal: guard.principal,
        action,
        resources,
        context: requestConditionContext(guard.request, guard.principal),
      });
    if (!Array.isArray(results) || results.length !== resources.length || results.some((r) => !r))
      throw iamAccountDenied();
    results.forEach((result, i) => {
      (guard.request.iamDecisions ??= []).push({ ...result, action, resource: resources[i] });
      auditIamDecision({
        requestId: guard.request.res?.locals.requestId,
        principal: guard.principal,
        action,
        resource: resources[i],
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
        ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
      });
    });
    return new Set(resources.filter((_, i) => results[i].decision === "Allow"));
  }
  private async collect<T extends LifecycleRunTarget>(
    guard: HistoryGuard,
    action: HistoryAction,
    scan: (after?: string) => Promise<T[]>,
    resource: (target: T) => string,
    valid: (target: T) => boolean,
  ) {
    const targets: T[] = [];
    let after: string | undefined;
    for (;;) {
      const rows = await scan(after);
      if (
        rows.length > batchSize ||
        rows.some(
          (t, i) => !this.valid(t) || !valid(t) || (i ? t.id <= rows[i - 1].id : after !== undefined && t.id <= after),
        )
      )
        throw iamAccountDenied();
      const allowed = await this.allowed(guard, action, rows.map(resource));
      targets.push(...rows.filter((t) => allowed.has(resource(t))));
      if (rows.length < batchSize) break;
      after = rows[rows.length - 1].id;
    }
    return targets;
  }
  private sorted<T extends LifecycleRunTarget>(targets: readonly T[]) {
    return [...targets].sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
  }
  private async verifyRuns(guard: HistoryGuard, targets: readonly LifecycleRunTarget[], action?: HistoryAction) {
    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize);
      if (
        action &&
        (
          await this.allowed(
            guard,
            action,
            batch.map((t) => platformLifecycleRunArn(t.id)),
          )
        ).size !== batch.length
      )
        throw iamAccountDenied();
      this.stable(batch, await this.repository.checkRuns(guard.principal, batch));
    }
  }
  private async children(guard: HistoryGuard, run: LifecycleRunTarget, requireParent: boolean) {
    if (!(await this.allowed(guard, LIST_ARTIFACTS, [platformLifecycleRunArn(run.id)])).size) {
      if (requireParent) throw iamAccountDenied();
      return undefined;
    }
    return this.collect(
      guard,
      LIST_ARTIFACTS,
      (after) => this.repository.scanArtifacts(guard.principal, run, after),
      (t) => platformLifecycleArtifactArn(run.id, t.id),
      (t) => t.lifecycleRunId === run.id && t.dataset === run.dataset,
    );
  }
  private async verifyArtifacts(
    guard: HistoryGuard,
    run: LifecycleRunTarget,
    targets: readonly LifecycleArtifactTarget[],
  ) {
    await this.verifyRuns(guard, [run], LIST_ARTIFACTS);
    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize);
      if (
        (
          await this.allowed(
            guard,
            LIST_ARTIFACTS,
            batch.map((t) => platformLifecycleArtifactArn(run.id, t.id)),
          )
        ).size !== batch.length
      )
        throw iamAccountDenied();
      this.stable(batch, await this.repository.checkArtifacts(guard.principal, run, batch));
    }
  }
  async listRuns(page: number, pageSize: number, request?: TypedRequest, hydrate = true) {
    this.pagination(page, pageSize);
    const guard = await this.guard(request),
      targets = await this.collect(
        guard,
        LIST_RUNS,
        (after) => this.repository.scanRuns(guard.principal, after),
        (t) => platformLifecycleRunArn(t.id),
        () => true,
      );
    await guard.finish();
    await this.verifyRuns(guard, targets, LIST_RUNS);
    const selected = this.sorted(targets).slice((page - 1) * pageSize, page * pageSize);
    const rows = hydrate ? await this.repository.hydrateRuns(guard.principal, selected) : [];
    if (hydrate) this.stable(selected, rows);
    const children = new Map<string, LifecycleArtifactTarget[]>();
    if (hydrate)
      for (const run of selected) {
        const artifacts = await this.children(guard, run, false);
        if (artifacts) children.set(run.id, artifacts);
      }
    await guard.finish();
    await this.verifyRuns(guard, targets, LIST_RUNS);
    for (const run of selected) if (children.has(run.id)) await this.verifyArtifacts(guard, run, children.get(run.id)!);
    await guard.finish();
    const items: (LifecycleRunView & { _count: { artifacts: number } })[] = hydrate
      ? selected.map((t) => ({
          ...rows.find((r) => r.id === t.id)!,
          _count: { artifacts: children.get(t.id)?.length ?? 0 },
        }))
      : [];
    return { items, total: targets.length };
  }
  async listArtifacts(runId: string, page: number, pageSize: number, request?: TypedRequest, hydrate = true) {
    this.pagination(page, pageSize);
    if (!isCanonicalLifecycleId(runId)) throw iamAccountDenied();
    const guard = await this.guard(request),
      run = await this.repository.targetRun(guard.principal, runId);
    if (!run || run.id !== runId || !this.valid(run)) throw iamAccountDenied();
    const targets = (await this.children(guard, run, true))!;
    await guard.finish();
    await this.verifyArtifacts(guard, run, targets);
    const selected = this.sorted(targets).slice((page - 1) * pageSize, page * pageSize);
    const rows = hydrate ? await this.repository.hydrateArtifacts(guard.principal, run, selected) : [];
    if (hydrate) this.stable(selected, rows);
    await guard.finish();
    await this.verifyArtifacts(guard, run, targets);
    await guard.finish();
    return { items: hydrate ? selected.map((t) => rows.find((r) => r.id === t.id)!) : [], total: targets.length };
  }
}
