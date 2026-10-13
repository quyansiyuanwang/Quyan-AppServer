import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { iamLegacyPermissionsForAction, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import type {
  PlatformLogCollectionStore,
  PlatformLogTarget,
  PlatformLogCursor,
} from "@/store/system/platform-log-collection.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
const batchSize = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
/** Shared native read protocol: qualify, authorize metadata, consume allowed rows, then verify the full contribution snapshot. */
export class PlatformLogCollectionIamService<Filters, Where> {
  constructor(
    private readonly iam: Pick<IamAuthorizationService, "loadPolicies" | "authorizeMany">,
    private readonly snapshots: PlatformManagementReadStore,
    private readonly repository: PlatformLogCollectionStore<Filters, Where>,
    private readonly resource: (id: string) => string,
  ) {}
  static valid(row: PlatformLogTarget) {
    return (
      isPlatformLogResourceId(row.id) &&
      row.status === 1 &&
      row.createTime instanceof Date &&
      Number.isFinite(row.createTime.getTime()) &&
      row.updateTime instanceof Date &&
      Number.isFinite(row.updateTime.getTime())
    );
  }
  private async allowed(
    action: string,
    principal: IamPrincipal,
    rows: readonly PlatformLogTarget[],
    request: TypedRequest,
  ) {
    const resources = rows.map((row) => this.resource(row.id)),
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
    where: Where | null | undefined,
    action: string,
    principal: IamPrincipal,
    request: TypedRequest,
    recheck: () => Promise<void>,
    fixedBoundary?: PlatformLogCursor,
    visit?: (targets: readonly PlatformLogTarget[]) => Promise<void>,
  ) {
    let after: PlatformLogCursor | undefined,
      boundary = fixedBoundary,
      total = 0;
    const hash = createHash("sha256");
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
              !PlatformLogCollectionIamService.valid(row) ||
              (index && row.createTime.getTime() > rows[index - 1]!.createTime.getTime()) ||
              (after && (row.id === after.id || row.createTime.getTime() > after.createTime.getTime())) ||
              (boundary && row.createTime.getTime() > boundary.createTime.getTime()),
          )
        )
          throw iamAccountDenied();
        if (!rows.length) break;
        boundary ??= { id: rows[0]!.id, createTime: rows[0]!.createTime };
        const allowed = await this.allowed(action, principal, rows, request);
        for (const row of rows)
          if (allowed.has(row.id)) {
            hash.update(JSON.stringify([row.id, row.createTime.toISOString(), row.updateTime.toISOString()]) + "\n");
            total++;
          }
        if (visit) {
          await recheck();
          await visit(rows.filter((row) => allowed.has(row.id)));
          await recheck();
        }
        after = { id: rows[rows.length - 1]!.id, createTime: rows[rows.length - 1]!.createTime };
        if (rows.length < batchSize) break;
      }
    await recheck();
    return { total, boundary, hash: hash.digest("hex") };
  }
  async read<Result>(
    action: string,
    principal: IamPrincipal,
    request: TypedRequest,
    filters: Filters,
    consumer?: {
      visit?: (targets: readonly PlatformLogTarget[]) => Promise<void>;
      finish: (total: number) => Promise<Result>;
    },
  ): Promise<Result | undefined> {
    const required = iamLegacyPermissionsForAction(action);
    if (!required.length) throw iamAccountDenied();
    const policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal)),
      snapshot = await this.snapshots.snapshot(principal, required);
    const recheck = async () => {
      await this.snapshots.recheck(principal, required, snapshot);
      if (fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies) throw iamAccountDenied();
    };
    const where = await this.repository.where(filters),
      initial = await this.collect(where, action, principal, request, recheck, undefined, consumer?.visit);
    if (!consumer) return undefined;
    const result = await consumer.finish(initial.total);
    const final = await this.collect(where, action, principal, request, recheck, initial.boundary);
    if (initial.total !== final.total || initial.hash !== final.hash) throw iamAccountDenied();
    return result;
  }
}
