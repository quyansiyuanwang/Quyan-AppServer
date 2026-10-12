import { performance } from "node:perf_hooks";
import { Permission, LEGAL_POLICY_TYPES, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { platformLegalPolicyArn, isLegalPolicyVersionId } from "@/iam/resources/platform-legal-policy-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformLegalPolicyReadRepository } from "@/store/content/platform-legal-policy-read.repository";
import type {
  PlatformLegalPolicyReadStore,
  LegalPolicyReadTarget,
  LegalPolicyListReadRow,
} from "@/store/content/platform-legal-policy-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
import type { LegalPolicyVersion } from "@prisma/client";
export class PlatformLegalPolicyReadIamService {
  private static instance: PlatformLegalPolicyReadIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformLegalPolicyReadStore = PlatformLegalPolicyReadRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformLegalPolicyReadIamService());
  }
  private principal(request: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (!principal || request.oauthAccessToken || principal.subjectUserId !== principal.principalUserId)
      throw iamAccountDenied();
    return { ...principal };
  }
  private valid(t: LegalPolicyReadTarget) {
    return (
      isLegalPolicyVersionId(t.id) &&
      t.status === 1 &&
      LEGAL_POLICY_TYPES.some((type) => type === t.policyType) &&
      Number.isSafeInteger(t.version) &&
      t.version > 0 &&
      [t.createTime, t.updateTime].every((d) => d instanceof Date && Number.isFinite(d.getTime()))
    );
  }
  private same(current: readonly LegalPolicyReadTarget[], expected: readonly LegalPolicyReadTarget[]) {
    if (
      current.length !== expected.length ||
      new Set(current.map((t) => t.id)).size !== expected.length ||
      current.some(
        (t) =>
          !this.valid(t) ||
          !expected.some(
            (e) =>
              e.id === t.id &&
              e.policyType === t.policyType &&
              e.version === t.version &&
              e.updateTime.getTime() === t.updateTime.getTime(),
          ),
      )
    )
      throw iamAccountDenied();
  }
  private async allowed(
    principal: IamPrincipal,
    request: TypedRequest,
    action: string,
    targets: readonly LegalPolicyReadTarget[],
  ) {
    if (!targets.length) return new Set<string>();
    if (targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest || targets.some((t) => !this.valid(t)))
      throw iamAccountDenied();
    const resources = targets.map((t) => platformLegalPolicyArn(t.id)),
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
  async list<T>(
    request: TypedRequest,
    project: (rows: LegalPolicyListReadRow[]) => Promise<T>,
    hydrate = true,
  ): Promise<T | undefined> {
    const principal = this.principal(request),
      snapshot = await this.identities.snapshot(principal, Permission.LEGAL_POLICY_READ),
      targets: LegalPolicyReadTarget[] = [];
    await this.iam.loadPolicies(principal);
    const action = "quyan:legal_policy:ListVersions";
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
      await this.identities.recheck(principal, Permission.LEGAL_POLICY_READ, snapshot);
      return undefined;
    }
    const rows: LegalPolicyListReadRow[] = [];
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      if ((await this.allowed(principal, request, action, batch)).size !== batch.length) throw iamAccountDenied();
      const display = await this.repository.summaries(principal, batch);
      this.same(display, batch);
      rows.push(...display);
    }
    rows.sort(
      (a, b) =>
        a.policyType.localeCompare(b.policyType) ||
        b.version - a.version ||
        b.createTime.getTime() - a.createTime.getTime(),
    );
    const result = await project(rows);
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      if ((await this.allowed(principal, request, action, batch)).size !== batch.length) throw iamAccountDenied();
      this.same(await this.repository.recheck(principal, batch), batch);
    }
    await this.identities.recheck(principal, Permission.LEGAL_POLICY_READ, snapshot);
    return result;
  }
  async detail<T>(
    id: string,
    request: TypedRequest,
    project: (row: LegalPolicyVersion) => Promise<T>,
    hydrate = true,
  ): Promise<T | undefined> {
    const principal = this.principal(request),
      snapshot = await this.identities.snapshot(principal, Permission.LEGAL_POLICY_READ);
    const target = await this.repository.target(principal, id),
      action = "quyan:legal_policy:GetVersion";
    if (!target || !this.valid(target) || !(await this.allowed(principal, request, action, [target])).has(target.id))
      throw iamAccountDenied();
    if (!hydrate) {
      await this.identities.recheck(principal, Permission.LEGAL_POLICY_READ, snapshot);
      return undefined;
    }
    const row = await this.repository.detail(principal, target);
    if (!row) throw iamAccountDenied();
    this.same([row], [target]);
    const result = await project(row);
    if (!(await this.allowed(principal, request, action, [target])).has(target.id)) throw iamAccountDenied();
    this.same(await this.repository.recheck(principal, [target]), [target]);
    await this.identities.recheck(principal, Permission.LEGAL_POLICY_READ, snapshot);
    return result;
  }
}
