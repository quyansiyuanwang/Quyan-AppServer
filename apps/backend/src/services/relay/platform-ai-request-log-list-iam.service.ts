import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { requestConditionContext } from "@/iam/request/condition-context";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isAiRequestLogResourceId, platformAiRequestLogArn } from "@/iam/resources/platform-ai-request-log-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { AIRequestLogRepository } from "@/store/system/ai-request-log.repository";
import type { AIRequestLogQuery } from "@/store/system/ai-request-log.store";
import type {
  PlatformAiRequestLogCollectionStore,
  PlatformAiLogCollectionTarget,
  PlatformAiLogCollectionCursor,
} from "@/store/system/platform-ai-request-log-read.store";
import { AIRequestLogService } from "./ai-request-log.service";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { aiRequestLogListQuerySchema } from "@/api/schema/relay/ai-request-log.schema";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:ai_request_log:ListLogs",
  batchSize = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
export class PlatformAiRequestLogListIamService {
  private static instance: PlatformAiRequestLogListIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformAiRequestLogCollectionStore = AIRequestLogRepository.getInstance(),
    private readonly logs = AIRequestLogService.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformAiRequestLogListIamService());
  }
  private query(input: AIRequestLogQuery): AIRequestLogQuery {
    const { startDate, endDate, ...rest } = input;
    if ([startDate, endDate].some((d) => d !== undefined && (!(d instanceof Date) || !Number.isFinite(d.getTime()))))
      throw new BadRequestError("Invalid AI log query", undefined, { messageKey: "errors.badRequest" });
    const parsed = aiRequestLogListQuerySchema.safeParse({
      ...rest,
      startDate: startDate?.toISOString(),
      endDate: endDate?.toISOString(),
    });
    if (!parsed.success || Object.keys(rest).some((k) => !Object.prototype.hasOwnProperty.call(parsed.data, k)))
      throw new BadRequestError("Invalid AI log query", undefined, { messageKey: "errors.badRequest" });
    return { ...parsed.data, startDate, endDate, page: parsed.data.page ?? 1, pageSize: parsed.data.pageSize ?? 20 };
  }
  private valid(row: PlatformAiLogCollectionTarget) {
    return (
      isAiRequestLogResourceId(row.id) &&
      row.status === 1 &&
      row.createTime instanceof Date &&
      Number.isFinite(row.createTime.getTime()) &&
      row.updateTime instanceof Date &&
      Number.isFinite(row.updateTime.getTime())
    );
  }
  private async allowed(
    principal: IamPrincipal,
    request: TypedRequest,
    rows: readonly PlatformAiLogCollectionTarget[],
  ) {
    if (!rows.length) return new Set<string>();
    const start = performance.now(),
      resources = rows.map((row) => platformAiRequestLogArn(row.id));
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
    const policies = await this.iam.loadPolicies(principal);
    const entries = policies
      .map((policy) =>
        JSON.stringify({
          policyId: policy.policyId,
          versionId: policy.versionId,
          authorizationId: policy.authorizationId,
          documentHash: parseIamPolicy(policy.document).documentHash,
          scope:
            policy.scope?.type === "resource-group"
              ? { ...policy.scope, resources: [...policy.scope.resources].sort() }
              : policy.scope,
        }),
      )
      .sort();
    return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  }
  private async collect(
    query: AIRequestLogQuery,
    principal: IamPrincipal,
    request: TypedRequest,
    recheck: () => Promise<void>,
    fixedBoundary?: PlatformAiLogCollectionCursor,
  ) {
    let after: PlatformAiLogCollectionCursor | undefined,
      boundary = fixedBoundary,
      total = 0;
    const page: PlatformAiLogCollectionTarget[] = [],
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
            (index && row.createTime.getTime() > rows[index - 1].createTime.getTime()) ||
            (after && (row.id === after.id || row.createTime.getTime() > after.createTime.getTime())) ||
            (boundary && row.createTime.getTime() > boundary.createTime.getTime()),
        )
      )
        throw iamAccountDenied();
      if (!rows.length) break;
      boundary ??= { id: rows[0].id, createTime: rows[0].createTime };
      const allowed = await this.allowed(principal, request, rows);
      for (const row of rows)
        if (allowed.has(row.id)) {
          hash.update(JSON.stringify([row.id, row.createTime.toISOString(), row.updateTime.toISOString()]) + "\n");
          if (total >= offset && page.length < query.pageSize) page.push(row);
          total++;
        }
      after = { id: rows[rows.length - 1].id, createTime: rows[rows.length - 1].createTime };
      if (rows.length < batchSize) break;
    }
    await recheck();
    return { page, total, boundary, hash: hash.digest("hex") };
  }
  async list(input: AIRequestLogQuery, request: TypedRequest) {
    const query = this.query(input),
      identity = getIamPrincipal(request);
    if (!identity || request.oauthAccessToken || identity.subjectUserId !== identity.principalUserId)
      throw iamAccountDenied();
    const principal = { ...identity };
    const native = async (hydrate: boolean) => {
      const policies = await this.policyFingerprint(principal);
      const snapshot = await this.snapshots.snapshot(principal, Permission.RELAY_AI_REQUEST_LOG_READ);
      const recheck = async () => {
        await this.snapshots.recheck(principal, Permission.RELAY_AI_REQUEST_LOG_READ, snapshot);
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
                target.createTime.getTime() === row.createTime.getTime() &&
                target.updateTime.getTime() === row.updateTime.getTime(),
            ),
        )
      )
        throw iamAccountDenied();
      const final = await this.collect(query, principal, request, recheck, initial.boundary);
      if (initial.total !== final.total || initial.hash !== final.hash) throw iamAccountDenied();
      const byId = new Map(rows.map((row) => [row.id, row]));
      return { items: this.logs.listItems(initial.page.map((target) => byId.get(target.id)!)), total: initial.total };
    };
    if (env.security.iamAuthorizationMode !== "enforce") {
      if (
        !["legacy", "shadow"].includes(env.security.iamAuthorizationMode) ||
        !(
          await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.RELAY_AI_REQUEST_LOG_READ], {
            assumedRoleSessionId: principal.roleSessionId,
          })
        ).hasPermission
      )
        throw iamAccountDenied();
      if (env.security.iamAuthorizationMode === "shadow") {
        try {
          await native(false);
        } catch {
          getLogger("AiRequestLogListIam", LogCategory.SECURITY).warn(
            "AI request log list IAM shadow evaluation failed",
            { reason: "iam-evaluation-denied-or-unavailable" },
          );
        }
      }
      return this.logs.query(query);
    }
    const result = await native(true);
    if (!result) throw iamAccountDenied();
    return result;
  }
}
