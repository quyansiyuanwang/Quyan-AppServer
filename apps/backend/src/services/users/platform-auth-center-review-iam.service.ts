import { performance } from "node:perf_hooks";
import { env } from "@/config/env";
import { type IamPrincipal } from "@quyan/shared";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { requestConditionContext } from "@/iam/request/condition-context";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformAuthCenterReviewClientArn } from "@/iam/resources/platform-auth-center-resources";
import { isCanonicalOAuthClientId } from "@/iam/resources/oauth-client-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { PlatformAuthCenterReviewRepository } from "@/store/users/platform-auth-center-review.repository";
import type { PlatformAuthCenterReviewStore } from "@/store/users/platform-auth-center-review.store";
import type { PlatformAuthCenterReviewTarget } from "@/store/users/platform-auth-center-review.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { AuthCenterClientReviewListQueryDto } from "@/api/dto/users/auth-center-client.dto";
import type { AuthCenterClientReviewListFilters } from "@/store/users/auth-center-client.store";
import { authCenterClientReviewListQuerySchema } from "@/api/schema/users/auth-center-client.schema";
import { BadRequestError } from "@/util/errors";
export class PlatformAuthCenterReviewIamService {
  private static instance: PlatformAuthCenterReviewIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformAuthCenterReviewStore = PlatformAuthCenterReviewRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformAuthCenterReviewIamService());
  }
  private valid(row: PlatformAuthCenterReviewTarget) {
    return (
      isCanonicalOAuthClientId(row.id) &&
      isCanonicalOAuthClientId(row.userId) &&
      row.status === 1 &&
      (row.submittedAt === null || (row.submittedAt instanceof Date && Number.isFinite(row.submittedAt.getTime()))) &&
      row.createTime instanceof Date &&
      Number.isFinite(row.createTime.getTime()) &&
      row.updateTime instanceof Date &&
      Number.isFinite(row.updateTime.getTime())
    );
  }
  private async allowed(
    principal: IamPrincipal,
    request: TypedRequest,
    targets: readonly PlatformAuthCenterReviewTarget[],
  ) {
    if (targets.some((t) => !this.valid(t))) throw iamAccountDenied();
    if (!targets.length) return new Set<string>();
    const action = "quyan:auth_center:ListClientReviews",
      resources = targets.map((t) => platformAuthCenterReviewClientArn(t.id)),
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
  async list(query: AuthCenterClientReviewListQueryDto, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (!request || !principal || request.oauthAccessToken) throw iamAccountDenied();
    const parsed = authCenterClientReviewListQuerySchema.strict().safeParse(query);
    if (!parsed.success)
      throw new BadRequestError("Invalid Auth Center review query", undefined, { messageKey: "errors.badRequest" });
    const filters: AuthCenterClientReviewListFilters = {
      ...parsed.data,
      page: parsed.data.page ?? 1,
      pageSize: parsed.data.pageSize ?? 10,
      keyword: parsed.data.keyword?.trim() || undefined,
    };
    return this.read(principal, request, filters, true);
  }
  async diagnose(query: AuthCenterClientReviewListQueryDto, request: TypedRequest) {
    if (env.security.iamAuthorizationMode !== "shadow") return;
    const principal = getIamPrincipal(request);
    if (!principal || request.oauthAccessToken) throw iamAccountDenied();
    try {
      await this.read(principal, request, { ...query, page: query.page ?? 1, pageSize: query.pageSize ?? 10 }, false);
    } catch {
      getLogger("PlatformAuthCenterReviewIamBridge", LogCategory.SECURITY).warn(
        "Auth Center review IAM shadow evaluation failed",
        { reason: "iam-evaluation-denied-or-unavailable" },
      );
    }
  }
  private async read(
    principal: IamPrincipal,
    request: TypedRequest,
    filters: AuthCenterClientReviewListFilters,
    hydrate: boolean,
  ) {
    await this.iam.loadPolicies(principal);
    await this.repository.assertActor(principal);
    const targets: PlatformAuthCenterReviewTarget[] = [];
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
    const current: PlatformAuthCenterReviewTarget[] = [];
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
            !this.valid(t) ||
            !selected.some(
              (b) => b.id === t.id && b.userId === t.userId && b.updateTime.getTime() === t.updateTime.getTime(),
            ),
        )
      )
        throw iamAccountDenied();
      current.push(...rechecked);
    }
    current.sort(
      (a, b) =>
        (a.submittedAt?.getTime() ?? Number.NEGATIVE_INFINITY) -
          (b.submittedAt?.getTime() ?? Number.NEGATIVE_INFINITY) ||
        b.createTime.getTime() - a.createTime.getTime() ||
        b.id.localeCompare(a.id),
    );
    const page = current.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize);
    const rows = await this.repository.hydrate(principal, page);
    if (
      rows.length !== page.length ||
      new Set(rows.map((t) => t.id)).size !== rows.length ||
      rows.some(
        (t) =>
          !this.valid(t) ||
          !page.some(
            (b) => b.id === t.id && b.userId === t.userId && b.updateTime.getTime() === t.updateTime.getTime(),
          ),
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
            !this.valid(t) ||
            !batch.some(
              (b) => b.id === t.id && b.userId === t.userId && b.updateTime.getTime() === t.updateTime.getTime(),
            ),
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
