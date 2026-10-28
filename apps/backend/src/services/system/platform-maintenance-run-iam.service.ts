import { performance } from "node:perf_hooks";
import { env } from "@/config/env";
import { type IamPrincipal } from "@quyan/shared";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { requestConditionContext } from "@/iam/request/condition-context";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformMaintenanceRunArn } from "@/iam/resources/platform-maintenance-resources";
import { isCanonicalMaintenanceRunId } from "@/iam/resources/platform-maintenance-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { PlatformMaintenanceRunRepository } from "@/store/system/platform-maintenance-run.repository";
import type { PlatformMaintenanceRunStore } from "@/store/system/platform-maintenance-run.store";
import type { MaintenanceRunTarget } from "@/store/system/platform-maintenance-run.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
type MaintenanceRunQuery = { page?: number; pageSize?: number; operation?: string; runStatus?: string };
import type { MaintenanceRunFilters } from "@/store/system/platform-maintenance-run.store";
import { maintenanceRunsQuerySchema } from "@/api/schema/system/data-maintenance.schema";
import { BadRequestError } from "@/util/errors";
export class PlatformMaintenanceRunIamService {
  private static instance: PlatformMaintenanceRunIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformMaintenanceRunStore = PlatformMaintenanceRunRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformMaintenanceRunIamService());
  }
  private valid(row: MaintenanceRunTarget) {
    return (
      isCanonicalMaintenanceRunId(row.id) &&
      row.status === 1 &&
      row.createTime instanceof Date &&
      Number.isFinite(row.createTime.getTime()) &&
      row.updateTime instanceof Date &&
      Number.isFinite(row.updateTime.getTime())
    );
  }
  private async allowed(principal: IamPrincipal, request: TypedRequest, targets: readonly MaintenanceRunTarget[]) {
    if (targets.some((t) => !this.valid(t))) throw iamAccountDenied();
    if (!targets.length) return new Set<string>();
    const action = "quyan:system:data_maintenance:ListRuns",
      resources = targets.map((t) => platformMaintenanceRunArn(t.id)),
      start = performance.now();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (!Array.isArray(results) || results.length !== targets.length || targets.some((_, i) => !results[i]))
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
    return new Set(targets.filter((_, i) => results[i].decision === "Allow").map((t) => t.id));
  }
  async list(query: MaintenanceRunQuery, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (!request || !principal || request.oauthAccessToken) throw iamAccountDenied();
    const parsed = maintenanceRunsQuerySchema.strict().safeParse(query);
    if (!parsed.success)
      throw new BadRequestError("Invalid Maintenance run query", undefined, { messageKey: "errors.badRequest" });
    const filters: MaintenanceRunFilters = {
      ...parsed.data,
      page: parsed.data.page ?? 1,
      pageSize: parsed.data.pageSize ?? 20,
    };
    return this.read(principal, request, filters, true);
  }
  async get(id: string, request?: TypedRequest, hydrate = true) {
    const principal = request && getIamPrincipal(request);
    if (!request || !principal || request.oauthAccessToken || !isCanonicalMaintenanceRunId(id))
      throw iamAccountDenied();
    await this.iam.loadPolicies(principal);
    await this.repository.assertActor(principal);
    const target = await this.repository.target(principal, id);
    if (!target || target.id !== id || !this.valid(target)) throw iamAccountDenied();
    const action = "quyan:system:data_maintenance:GetRun",
      resource = platformMaintenanceRunArn(id);
    const recheck = async () => {
      const start = performance.now();
      const result = await this.iam.authorize({
        principal,
        action,
        resource,
        context: requestConditionContext(request, principal),
      });
      if (!result) throw iamAccountDenied();
      (request.iamDecisions ??= []).push({ ...result, action, resource });
      auditIamDecision({
        principal,
        action,
        resource,
        result,
        requestId: request.res?.locals.requestId,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
        ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
      });
      if (result.decision !== "Allow") throw iamAccountDenied();
    };
    await recheck();
    if (!hydrate) return undefined;
    const rows = await this.repository.hydrate(principal, [target]);
    if (
      rows.length !== 1 ||
      !this.valid(rows[0]) ||
      rows[0].id !== id ||
      rows[0].updateTime.getTime() !== target.updateTime.getTime()
    )
      throw iamAccountDenied();
    await recheck();
    const latest = await this.repository.recheck(principal, [target]);
    if (
      latest.length !== 1 ||
      !this.valid(latest[0]) ||
      latest[0].id !== id ||
      latest[0].updateTime.getTime() !== target.updateTime.getTime()
    )
      throw iamAccountDenied();
    await this.repository.assertActor(principal);
    return rows[0];
  }
  async diagnose(query: MaintenanceRunQuery, request: TypedRequest) {
    if (env.security.iamAuthorizationMode !== "shadow") return;
    const principal = getIamPrincipal(request);
    if (!principal || request.oauthAccessToken) throw iamAccountDenied();
    try {
      await this.read(principal, request, { ...query, page: query.page ?? 1, pageSize: query.pageSize ?? 20 }, false);
    } catch {
      getLogger("PlatformMaintenanceRunIamBridge", LogCategory.SECURITY).warn(
        "Maintenance run IAM shadow evaluation failed",
        { reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
  }
  private async read(principal: IamPrincipal, request: TypedRequest, filters: MaintenanceRunFilters, hydrate: boolean) {
    await this.iam.loadPolicies(principal);
    await this.repository.assertActor(principal);
    const targets: MaintenanceRunTarget[] = [];
    let after: string | undefined;
    for (;;) {
      const batch = await this.repository.scan(principal, filters, after);
      if (
        batch.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        batch.some((t, i) => !this.valid(t) || (i ? t.id <= batch[i - 1].id : after !== undefined && t.id <= after))
      )
        throw iamAccountDenied();
      const allow = await this.allowed(principal, request, batch);
      targets.push(...batch.filter((t) => allow.has(t.id)));
      if (batch.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
      after = batch[batch.length - 1].id;
    }
    if (!hydrate) return { items: [], total: targets.length, page: filters.page, pageSize: filters.pageSize };
    const current: MaintenanceRunTarget[] = [];
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      const allow = await this.allowed(principal, request, batch);
      const selected = batch.filter((t) => allow.has(t.id));
      const rechecked = await this.repository.recheck(principal, selected, filters);
      if (
        rechecked.length > selected.length ||
        new Set(rechecked.map((t) => t.id)).size !== rechecked.length ||
        rechecked.some(
          (t) =>
            !this.valid(t) || !selected.some((b) => b.id === t.id && b.updateTime.getTime() === t.updateTime.getTime()),
        )
      )
        throw iamAccountDenied();
      current.push(...rechecked);
    }
    current.sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
    const page = current.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize);
    const rows = await this.repository.hydrate(principal, page);
    if (
      rows.length !== page.length ||
      new Set(rows.map((t) => t.id)).size !== rows.length ||
      rows.some(
        (t) => !this.valid(t) || !page.some((b) => b.id === t.id && b.updateTime.getTime() === t.updateTime.getTime()),
      )
    )
      throw iamAccountDenied();
    // Recheck after loading display fields, including the resources contributing to the authorized total.
    for (let i = 0; i < current.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = current.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      const allow = await this.allowed(principal, request, batch);
      const latest = await this.repository.recheck(principal, batch, filters);
      if (
        allow.size !== batch.length ||
        latest.length !== batch.length ||
        new Set(latest.map((t) => t.id)).size !== latest.length ||
        latest.some(
          (t) =>
            !this.valid(t) || !batch.some((b) => b.id === t.id && b.updateTime.getTime() === t.updateTime.getTime()),
        )
      )
        throw iamAccountDenied();
    }
    await this.repository.assertActor(principal);
    return {
      items: page.map((t) => rows.find((r) => r.id === t.id)!),
      total: current.length,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }
}
