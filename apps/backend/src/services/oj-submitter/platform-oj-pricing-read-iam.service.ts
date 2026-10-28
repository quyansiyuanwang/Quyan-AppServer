import { performance } from "node:perf_hooks";
import { Permission, type IamPrincipal } from "@quyan/shared";
import type { OJModelPricing } from "@prisma/client";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { platformOjPricingArn, isOjPricingRecordId } from "@/iam/resources/platform-oj-pricing-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformOjPricingReadRepository } from "@/store/oj-submitter/platform-oj-pricing-read.repository";
import type {
  PlatformOjPricingReadStore,
  OjPricingReadTarget,
} from "@/store/oj-submitter/platform-oj-pricing-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { ojPricingModelParamsSchema } from "@/api/schema/oj-submitter/oj-submitter.schema";
import { BadRequestError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
export class PlatformOjPricingReadIamService {
  private static instance: PlatformOjPricingReadIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformOjPricingReadStore = PlatformOjPricingReadRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformOjPricingReadIamService());
  }
  private principal(request: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (!principal || request.oauthAccessToken || principal.subjectUserId !== principal.principalUserId)
      throw iamAccountDenied();
    return { ...principal };
  }
  private valid(t: OjPricingReadTarget) {
    return (
      isOjPricingRecordId(t.id) &&
      t.status === 1 &&
      typeof t.model === "string" &&
      t.model.length > 0 &&
      t.model.length <= 200 &&
      [t.createTime, t.updateTime].every((d) => d instanceof Date && Number.isFinite(d.getTime()))
    );
  }
  private same(current: readonly OjPricingReadTarget[], expected: readonly OjPricingReadTarget[]) {
    if (
      current.length !== expected.length ||
      new Set(current.map((t) => t.id)).size !== expected.length ||
      current.some(
        (t) =>
          !this.valid(t) ||
          !expected.some(
            (e) => e.id === t.id && e.model === t.model && e.updateTime.getTime() === t.updateTime.getTime(),
          ),
      )
    )
      throw iamAccountDenied();
  }
  private async allowed(
    principal: IamPrincipal,
    request: TypedRequest,
    action: string,
    targets: readonly OjPricingReadTarget[],
  ) {
    if (!targets.length) return new Set<string>();
    if (targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest || targets.some((t) => !this.valid(t)))
      throw iamAccountDenied();
    const resources = targets.map((t) => platformOjPricingArn(t.id)),
      start = performance.now();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (!Array.isArray(results) || results.length !== targets.length || results.some((r) => !r))
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
  async list<T>(request: TypedRequest, project: (rows: OJModelPricing[]) => T, hydrate = true): Promise<T | undefined> {
    const principal = this.principal(request),
      snapshot = await this.identities.snapshot(principal, Permission.OJ_PRICING_READ),
      targets: OjPricingReadTarget[] = [];
    await this.iam.loadPolicies(principal);
    const action = "quyan:oj:ListPricing";
    let after: string | undefined;
    for (;;) {
      const batch = await this.repository.scan(principal, after);
      if (
        batch.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        batch.some((t, i) => !this.valid(t) || (i ? t.id <= batch[i - 1].id : after !== undefined && t.id <= after))
      )
        throw iamAccountDenied();
      const allowed = await this.allowed(principal, request, action, batch);
      targets.push(...batch.filter((t) => allowed.has(t.id)));
      if (batch.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
      after = batch[batch.length - 1].id;
    }
    if (!hydrate) {
      await this.identities.recheck(principal, Permission.OJ_PRICING_READ, snapshot);
      return undefined;
    }
    const rows: OJModelPricing[] = [];
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      if ((await this.allowed(principal, request, action, batch)).size !== batch.length) throw iamAccountDenied();
      const display = await this.repository.hydrate(principal, batch);
      this.same(display, batch);
      rows.push(...display);
    }
    rows.sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
    const result = project(rows);
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      if ((await this.allowed(principal, request, action, batch)).size !== batch.length) throw iamAccountDenied();
      this.same(await this.repository.recheck(principal, batch), batch);
    }
    await this.identities.recheck(principal, Permission.OJ_PRICING_READ, snapshot);
    return result;
  }
  async detail<T>(
    model: string,
    request: TypedRequest,
    project: (row: OJModelPricing) => T,
    hydrate = true,
  ): Promise<T | undefined> {
    const parsed = ojPricingModelParamsSchema.safeParse({ model });
    if (!parsed.success)
      throw new BadRequestError("Invalid OJ pricing model", undefined, { messageKey: "errors.badRequest" });
    const principal = this.principal(request),
      snapshot = await this.identities.snapshot(principal, Permission.OJ_PRICING_READ);
    const target = await this.repository.target(principal, parsed.data.model),
      action = "quyan:oj:GetPricing";
    if (!target || !this.valid(target) || !(await this.allowed(principal, request, action, [target])).has(target.id))
      throw iamAccountDenied();
    if (!hydrate) {
      await this.identities.recheck(principal, Permission.OJ_PRICING_READ, snapshot);
      return undefined;
    }
    const rows = await this.repository.hydrate(principal, [target]);
    this.same(rows, [target]);
    const result = project(rows[0]);
    if (!(await this.allowed(principal, request, action, [target])).has(target.id)) throw iamAccountDenied();
    const current = await this.repository.target(principal, parsed.data.model);
    if (!current) throw iamAccountDenied();
    this.same([current], [target]);
    await this.identities.recheck(principal, Permission.OJ_PRICING_READ, snapshot);
    return result;
  }
}
