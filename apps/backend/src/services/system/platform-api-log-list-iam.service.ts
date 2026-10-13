import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { iamLegacyPermissionsForAction, type IamPrincipal } from "@quyan/shared";
import type { Prisma } from "@prisma/client";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isApiLogResourceId, platformApiLogArn } from "@/iam/resources/platform-api-log-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformApiLogReadRepository } from "@/store/system/platform-api-log-read.repository";
import type {
  PlatformApiLogCollectionStore,
  PlatformApiLogCollectionTarget,
  PlatformApiLogCollectionCursor,
} from "@/store/system/platform-api-log-read.store";
import type { ApiLogFilters } from "@/store/system/apilog.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { SystemService } from "./system.service";
import { systemLogsQuerySchema } from "@/api/schema/system/system.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { SystemLogDTO } from "@/api/dto/system/system.dto";
const action = "quyan:system:log:ListLogs",
  batchSize = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
export class PlatformApiLogListIamService {
  private static instance: PlatformApiLogListIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformApiLogCollectionStore = PlatformApiLogReadRepository.getInstance(),
    private readonly reports: Pick<SystemService, "getLogs" | "mapLogListRows"> = SystemService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformApiLogListIamService());
  }
  private query(page: number, pageSize: number, filters: ApiLogFilters) {
    const { startDate, endDate, ...rest } = filters;
    if (
      [startDate, endDate].some(
        (date) => date !== undefined && (!(date instanceof Date) || !Number.isFinite(date.getTime())),
      )
    )
      throw new BadRequestError("Invalid log query", undefined, { messageKey: "errors.badRequest" });
    const parsed = systemLogsQuerySchema.safeParse({
      ...rest,
      page,
      pageSize,
      startDate: startDate?.toISOString(),
      endDate: endDate?.toISOString(),
    });
    if (!parsed.success || Object.keys(rest).some((key) => !Object.prototype.hasOwnProperty.call(parsed.data, key)))
      throw new BadRequestError("Invalid log query", undefined, { messageKey: "errors.badRequest" });
    const { page: validatedPage, pageSize: validatedSize, startDate: _start, endDate: _end, ...query } = parsed.data;
    return { page: validatedPage!, pageSize: validatedSize!, filters: { ...query, startDate, endDate } };
  }
  private valid(row: PlatformApiLogCollectionTarget) {
    return (
      isApiLogResourceId(row.id) &&
      row.status === 1 &&
      row.createTime instanceof Date &&
      Number.isFinite(row.createTime.getTime()) &&
      row.updateTime instanceof Date &&
      Number.isFinite(row.updateTime.getTime())
    );
  }
  private async allowed(
    principal: IamPrincipal,
    rows: readonly PlatformApiLogCollectionTarget[],
    request: TypedRequest,
  ) {
    const resources = rows.map((row) => platformApiLogArn(row.id)),
      start = performance.now();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (!Array.isArray(results) || results.length !== rows.length || resources.some((_, index) => !results[index]))
      throw iamAccountDenied();
    const decisions = (request.iamDecisions ??= []);
    decisions.splice(0, Math.max(0, decisions.length + results.length - batchSize));
    results.forEach((result, index) => {
      decisions.push({ ...result, action, resource: resources[index]! });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource: resources[index]!,
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
        ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
      });
    });
    return new Set(rows.filter((_, index) => results[index]!.decision === "Allow").map((row) => row.id));
  }
  private async collect(
    where: Prisma.APILogWhereInput | undefined,
    query: { page: number; pageSize: number },
    principal: IamPrincipal,
    request: TypedRequest,
    recheck: () => Promise<void>,
    fixedBoundary?: PlatformApiLogCollectionCursor,
  ) {
    let after: PlatformApiLogCollectionCursor | undefined,
      boundary = fixedBoundary,
      total = 0;
    const page: PlatformApiLogCollectionTarget[] = [],
      hash = createHash("sha256"),
      offset = (query.page - 1) * query.pageSize;
    if (where)
      for (;;) {
        await recheck();
        const rows = await this.repository.scan(where, after, boundary);
        if (
          !Array.isArray(rows) ||
          rows.length > batchSize ||
          new Set(rows.map((row) => row.id)).size !== rows.length ||
          rows.some(
            (row, index) =>
              !this.valid(row) ||
              (index && row.createTime.getTime() > rows[index - 1]!.createTime.getTime()) ||
              (after && (row.id === after.id || row.createTime.getTime() > after.createTime.getTime())) ||
              (boundary && row.createTime.getTime() > boundary.createTime.getTime()),
          )
        )
          throw iamAccountDenied();
        if (!rows.length) break;
        boundary ??= { id: rows[0]!.id, createTime: rows[0]!.createTime };
        const allowed = await this.allowed(principal, rows, request);
        for (const row of rows)
          if (allowed.has(row.id)) {
            hash.update(JSON.stringify([row.id, row.createTime.toISOString(), row.updateTime.toISOString()]) + "\n");
            if (total >= offset && page.length < query.pageSize) page.push(row);
            total++;
          }
        after = { id: rows[rows.length - 1]!.id, createTime: rows[rows.length - 1]!.createTime };
        if (rows.length < batchSize) break;
      }
    await recheck();
    return { page, total, boundary, hash: hash.digest("hex") };
  }
  async list(page: number, pageSize: number, filters: ApiLogFilters, request: TypedRequest): Promise<SystemLogDTO> {
    const query = this.query(page, pageSize, filters),
      identity = getIamPrincipal(request),
      required = iamLegacyPermissionsForAction(action);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !required.length ||
      !["legacy", "shadow", "enforce"].includes(env.security.iamAuthorizationMode)
    )
      throw iamAccountDenied();
    const principal = { ...identity };
    const native = async (hydrate: boolean) => {
      const policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal)),
        snapshot = await this.snapshots.snapshot(principal, required);
      const recheck = async () => {
        await this.snapshots.recheck(principal, required, snapshot);
        if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
      };
      const where = await this.repository.where(query.filters),
        initial = await this.collect(where, query, principal, request, recheck);
      if (!hydrate) return undefined;
      const rows = initial.page.length ? await this.repository.hydrate(initial.page) : [];
      if (
        rows.length !== initial.page.length ||
        new Set(rows.map((row) => row.id)).size !== rows.length ||
        rows.some(
          (row) =>
            !this.valid(row) ||
            !initial.page.some(
              (target) =>
                target.id === row.id &&
                target.createTime.getTime() === row.createTime.getTime() &&
                target.updateTime.getTime() === row.updateTime.getTime(),
            ),
        )
      )
        throw iamAccountDenied();
      const byId = new Map(rows.map((row) => [row.id, row])),
        logs = await this.reports.mapLogListRows(initial.page.map((target) => byId.get(target.id)!));
      if (logs.length !== initial.page.length || logs.some((row, index) => row.id !== initial.page[index]!.id))
        throw iamAccountDenied();
      const final = await this.collect(where, query, principal, request, recheck, initial.boundary);
      if (initial.total !== final.total || initial.hash !== final.hash) throw iamAccountDenied();
      return { logs, total: initial.total };
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
          await native(false);
        } catch {
          getLogger("ApiLogListIam", LogCategory.SECURITY).warn("API log list IAM shadow evaluation failed", {
            action,
            reason: "iam-evaluation-denied-or-unavailable",
          });
        }
      }
      return this.reports.getLogs(query.page, query.pageSize, query.filters);
    }
    const result = await native(true);
    if (!result) throw iamAccountDenied();
    return result;
  }
}
