import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { requestConditionContext } from "@/iam/request/condition-context";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isErrorGroupResourceId, platformErrorGroupArn } from "@/iam/resources/platform-error-group-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformErrorGroupReadRepository } from "@/store/system/platform-error-group-read.repository";
import type { ErrorGroupQuery } from "@/store/system/observability.repository";
import type {
  PlatformErrorGroupCollectionStore,
  PlatformErrorGroupCollectionTarget,
  PlatformErrorGroupCollectionCursor,
} from "@/store/system/platform-error-group-read.store";
import { ErrorReportService } from "./error-report.service";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { errorGroupsQuerySchema } from "@/api/schema/system/error-report.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:system:error_report:ListErrorGroups",
  batchSize = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
export class PlatformErrorGroupListIamService {
  private static instance: PlatformErrorGroupListIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformErrorGroupCollectionStore = PlatformErrorGroupReadRepository.getInstance(),
    private readonly reports = ErrorReportService.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformErrorGroupListIamService());
  }
  private query(input: ErrorGroupQuery): ErrorGroupQuery {
    const { startDate, endDate, ...rest } = input;
    if ([startDate, endDate].some((d) => d !== undefined && (!(d instanceof Date) || !Number.isFinite(d.getTime()))))
      throw new BadRequestError("Invalid error group query", undefined, { messageKey: "errors.badRequest" });
    const parsed = errorGroupsQuerySchema.safeParse({
      ...rest,
      startDate: startDate?.toISOString(),
      endDate: endDate?.toISOString(),
    });
    if (!parsed.success || Object.keys(rest).some((k) => !Object.prototype.hasOwnProperty.call(parsed.data, k)))
      throw new BadRequestError("Invalid error group query", undefined, { messageKey: "errors.badRequest" });
    return { ...parsed.data, startDate, endDate, page: parsed.data.page ?? 1, pageSize: parsed.data.pageSize ?? 20 };
  }
  private valid(row: PlatformErrorGroupCollectionTarget) {
    return (
      isErrorGroupResourceId(row.id) &&
      row.status === 1 &&
      row.lastSeenAt instanceof Date &&
      Number.isFinite(row.lastSeenAt.getTime()) &&
      row.updateTime instanceof Date &&
      Number.isFinite(row.updateTime.getTime())
    );
  }
  private async allowed(
    principal: IamPrincipal,
    request: TypedRequest,
    rows: readonly PlatformErrorGroupCollectionTarget[],
  ) {
    if (!rows.length) return new Set<string>();
    const start = performance.now(),
      resources = rows.map((row) => platformErrorGroupArn(row.id));
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (!Array.isArray(results) || results.length !== rows.length || results.some((result) => !result))
      throw iamAccountDenied();
    const decisions = (request.iamDecisions ??= []);
    // Keep request-local decision storage bounded; the structured audit still records every evaluation.
    decisions.splice(0, Math.max(0, decisions.length + results.length - batchSize));
    results.forEach((result, index) => {
      decisions.push({ ...result, action, resource: resources[index] });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource: resources[index],
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
        ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
      });
    });
    return new Set(rows.filter((_, index) => results[index].decision === "Allow").map((row) => row.id));
  }
  private async policyFingerprint(principal: IamPrincipal) {
    return fingerprintIamPolicies(await this.iam.loadPolicies(principal));
  }
  private async collect(
    query: ErrorGroupQuery,
    principal: IamPrincipal,
    request: TypedRequest,
    recheck: () => Promise<void>,
    fixedBoundary?: PlatformErrorGroupCollectionCursor,
  ) {
    let after: PlatformErrorGroupCollectionCursor | undefined,
      boundary = fixedBoundary,
      total = 0;
    const page: PlatformErrorGroupCollectionTarget[] = [],
      hash = createHash("sha256"),
      offset = (query.page - 1) * query.pageSize;
    for (;;) {
      await recheck();
      const rows = await this.repository.scan(query, after, boundary);
      if (
        !Array.isArray(rows) ||
        rows.length > batchSize ||
        new Set(rows.map((row) => row.id)).size !== rows.length ||
        rows.some(
          (row, index) =>
            !this.valid(row) ||
            (index && row.lastSeenAt.getTime() > rows[index - 1].lastSeenAt.getTime()) ||
            (after && (row.id === after.id || row.lastSeenAt.getTime() > after.lastSeenAt.getTime())) ||
            (boundary && row.lastSeenAt.getTime() > boundary.lastSeenAt.getTime()),
        )
      )
        throw iamAccountDenied();
      if (!rows.length) break;
      boundary ??= { id: rows[0].id, lastSeenAt: rows[0].lastSeenAt };
      const allowed = await this.allowed(principal, request, rows);
      for (const row of rows)
        if (allowed.has(row.id)) {
          hash.update(JSON.stringify([row.id, row.lastSeenAt.toISOString(), row.updateTime.toISOString()]) + "\n");
          if (total >= offset && page.length < query.pageSize) page.push(row);
          total++;
        }
      after = { id: rows[rows.length - 1].id, lastSeenAt: rows[rows.length - 1].lastSeenAt };
      if (rows.length < batchSize) break;
    }
    await recheck();
    return { page, total, boundary, hash: hash.digest("hex") };
  }
  async list(input: ErrorGroupQuery, request: TypedRequest) {
    const query = this.query(input),
      identity = getIamPrincipal(request);
    if (!identity || request.oauthAccessToken || identity.subjectUserId !== identity.principalUserId)
      throw iamAccountDenied();
    const principal = { ...identity };
    const native = async (hydrate: boolean) => {
      const policies = await this.policyFingerprint(principal);
      const snapshot = await this.snapshots.snapshot(principal, Permission.SYSTEM_ERROR_REPORT_READ);
      const recheck = async () => {
        await this.snapshots.recheck(principal, Permission.SYSTEM_ERROR_REPORT_READ, snapshot);
        if ((await this.policyFingerprint(principal)) !== policies) throw iamAccountDenied();
      };
      const initial = await this.collect(query, principal, request, recheck);
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
                target.lastSeenAt.getTime() === row.lastSeenAt.getTime() &&
                target.updateTime.getTime() === row.updateTime.getTime(),
            ),
        )
      )
        throw iamAccountDenied();
      const final = await this.collect(query, principal, request, recheck, initial.boundary);
      if (initial.total !== final.total || initial.hash !== final.hash) throw iamAccountDenied();
      const byId = new Map(rows.map((row) => [row.id, row]));
      return { items: initial.page.map((target) => byId.get(target.id)!), total: initial.total };
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
          await native(false);
        } catch {
          getLogger("ErrorGroupListIam", LogCategory.SECURITY).warn("Error group list IAM shadow evaluation failed", {
            reason: "iam-evaluation-denied-or-unavailable",
          });
        }
      }
      return this.reports.getGroups(query);
    }
    const result = await native(true);
    if (!result) throw iamAccountDenied();
    return result;
  }
}
