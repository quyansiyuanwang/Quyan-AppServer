import { performance } from "node:perf_hooks";
import { Permission, type IamPrincipal } from "@quyan/shared";
import type { DeveloperQuotaOverride } from "@prisma/client";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  platformDeveloperQuotaArn,
  isDeveloperQuotaRecordId,
} from "@/iam/resources/platform-developer-quota-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformDeveloperQuotaReadRepository } from "@/store/developer/platform-developer-quota-read.repository";
import type {
  PlatformDeveloperQuotaReadStore,
  DeveloperQuotaReadTarget,
} from "@/store/developer/platform-developer-quota-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
export class PlatformDeveloperQuotaReadIamService {
  private static instance: PlatformDeveloperQuotaReadIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformDeveloperQuotaReadStore = PlatformDeveloperQuotaReadRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperQuotaReadIamService());
  }
  private principal(request: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (!principal || request.oauthAccessToken || principal.subjectUserId !== principal.principalUserId)
      throw iamAccountDenied();
    return { ...principal };
  }
  private valid(t: DeveloperQuotaReadTarget) {
    return (
      isDeveloperQuotaRecordId(t.id) &&
      t.status === 1 &&
      ["user", "project"].includes(t.subjectType) &&
      isDeveloperQuotaRecordId(t.subjectId) &&
      ["*", "verification", "ip", "push"].includes(t.service) &&
      [t.createTime, t.updateTime].every((d) => d instanceof Date && Number.isFinite(d.getTime()))
    );
  }
  private same(current: readonly DeveloperQuotaReadTarget[], expected: readonly DeveloperQuotaReadTarget[]) {
    if (
      current.length !== expected.length ||
      new Set(current.map((t) => t.id)).size !== expected.length ||
      current.some(
        (t) =>
          !this.valid(t) ||
          !expected.some(
            (e) =>
              e.id === t.id &&
              e.subjectType === t.subjectType &&
              e.subjectId === t.subjectId &&
              e.service === t.service &&
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
    targets: readonly DeveloperQuotaReadTarget[],
  ) {
    if (!targets.length) return new Set<string>();
    if (targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest || targets.some((t) => !this.valid(t)))
      throw iamAccountDenied();
    const resources = targets.map((t) => platformDeveloperQuotaArn(t.id)),
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
    project: (rows: DeveloperQuotaOverride[]) => T,
    hydrate = true,
  ): Promise<T | undefined> {
    const principal = this.principal(request),
      snapshot = await this.identities.snapshot(principal, Permission.DEVELOPER_QUOTA_MANAGE),
      targets: DeveloperQuotaReadTarget[] = [];
    await this.iam.loadPolicies(principal);
    const action = "quyan:developer:ListQuotaOverrides";
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
      await this.identities.recheck(principal, Permission.DEVELOPER_QUOTA_MANAGE, snapshot);
      return undefined;
    }
    const rows: DeveloperQuotaOverride[] = [];
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      if ((await this.allowed(principal, request, action, batch)).size !== batch.length) throw iamAccountDenied();
      const display = await this.repository.hydrate(principal, batch);
      this.same(display, batch);
      rows.push(...display);
    }
    rows.sort((a, b) => b.updateTime.getTime() - a.updateTime.getTime() || b.id.localeCompare(a.id));
    const result = project(rows);
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      if ((await this.allowed(principal, request, action, batch)).size !== batch.length) throw iamAccountDenied();
      this.same(await this.repository.recheck(principal, batch), batch);
    }
    await this.identities.recheck(principal, Permission.DEVELOPER_QUOTA_MANAGE, snapshot);
    return result;
  }
}
