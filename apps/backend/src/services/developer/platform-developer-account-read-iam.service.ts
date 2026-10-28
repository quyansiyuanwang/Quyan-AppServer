import { performance } from "node:perf_hooks";
import { Permission, isDeveloperProductCode, type IamPrincipal } from "@quyan/shared";
import type { DeveloperAccountReadRow } from "@/store/developer/platform-developer-account-read.store";
import type { DeveloperProductCode } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  platformDeveloperAccountArn,
  isDeveloperAccountRecordId,
} from "@/iam/resources/platform-developer-account-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformDeveloperAccountReadRepository } from "@/store/developer/platform-developer-account-read.repository";
import type {
  PlatformDeveloperAccountReadStore,
  DeveloperAccountReadTarget,
} from "@/store/developer/platform-developer-account-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
export class PlatformDeveloperAccountReadIamService {
  private static instance: PlatformDeveloperAccountReadIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformDeveloperAccountReadStore = PlatformDeveloperAccountReadRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperAccountReadIamService());
  }
  private principal(request: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (!principal || request.oauthAccessToken || principal.subjectUserId !== principal.principalUserId)
      throw iamAccountDenied();
    return { ...principal };
  }
  private valid(t: DeveloperAccountReadTarget) {
    return (
      isDeveloperAccountRecordId(t.id) &&
      t.status === 1 &&
      isDeveloperProductCode(t.productCode) &&
      isDeveloperAccountRecordId(t.accountOwnerId) &&
      t.accountOwner?.id === t.accountOwnerId &&
      t.accountOwner.status === 1 &&
      t.accountOwner.userType === "root" &&
      (t.accountOwner.accountOwnerId === null || t.accountOwner.accountOwnerId === t.accountOwnerId) &&
      t.accountOwner.updateTime instanceof Date &&
      Number.isFinite(t.accountOwner.updateTime.getTime()) &&
      [t.createTime, t.updateTime].every((d) => d instanceof Date && Number.isFinite(d.getTime()))
    );
  }
  private same(current: readonly DeveloperAccountReadTarget[], expected: readonly DeveloperAccountReadTarget[]) {
    if (
      current.length !== expected.length ||
      new Set(current.map((t) => t.id)).size !== expected.length ||
      current.some(
        (t) =>
          !this.valid(t) ||
          !expected.some(
            (e) =>
              e.id === t.id &&
              e.productCode === t.productCode &&
              e.accountOwnerId === t.accountOwnerId &&
              e.accountOwner.updateTime.getTime() === t.accountOwner.updateTime.getTime() &&
              e.accountOwner.accountOwnerId === t.accountOwner.accountOwnerId &&
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
    targets: readonly DeveloperAccountReadTarget[],
  ) {
    if (!targets.length) return new Set<string>();
    if (targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest || targets.some((t) => !this.valid(t)))
      throw iamAccountDenied();
    const resources = targets.map((t) => platformDeveloperAccountArn(t.id)),
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
    project: (rows: DeveloperAccountReadRow[]) => T,
    hydrate = true,
    product?: DeveloperProductCode,
  ): Promise<T | undefined> {
    if (product !== undefined && !isDeveloperProductCode(product)) throw iamAccountDenied();
    const principal = this.principal(request),
      snapshot = await this.identities.snapshot(principal, Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE),
      targets: DeveloperAccountReadTarget[] = [];
    await this.iam.loadPolicies(principal);
    const action = "quyan:developer:ListProductAccounts";
    let after: string | undefined;
    for (;;) {
      const batch = await this.repository.scan(principal, after, product);
      if (
        batch.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        batch.some(
          (t, i) =>
            !this.valid(t) ||
            (product !== undefined && t.productCode !== product) ||
            (i ? t.id <= batch[i - 1].id : after !== undefined && t.id <= after),
        )
      )
        throw iamAccountDenied();
      const allowed = await this.allowed(principal, request, action, batch);
      targets.push(...batch.filter((t) => allowed.has(t.id)));
      if (batch.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
      after = batch[batch.length - 1].id;
    }
    if (!hydrate) {
      await this.identities.recheck(principal, Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE, snapshot);
      return undefined;
    }
    const rows: DeveloperAccountReadRow[] = [];
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      if ((await this.allowed(principal, request, action, batch)).size !== batch.length) throw iamAccountDenied();
      const display = await this.repository.hydrate(principal, batch);
      this.same(display, batch);
      rows.push(...display);
    }
    rows.sort((a, b) => b.updateTime.getTime() - a.updateTime.getTime() || a.id.localeCompare(b.id));
    const result = project(rows);
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      if ((await this.allowed(principal, request, action, batch)).size !== batch.length) throw iamAccountDenied();
      this.same(await this.repository.recheck(principal, batch), batch);
    }
    await this.identities.recheck(principal, Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE, snapshot);
    return result;
  }
}
