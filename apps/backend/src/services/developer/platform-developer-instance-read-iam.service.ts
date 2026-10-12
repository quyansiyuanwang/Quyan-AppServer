import { performance } from "node:perf_hooks";
import { Permission, isDeveloperProductCode, type DeveloperProductCode, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  platformDeveloperInstanceArn,
  isDeveloperInstanceRecordId,
} from "@/iam/resources/platform-developer-instance-resources";
import { isDeveloperAccountRecordId } from "@/iam/resources/platform-developer-account-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformDeveloperInstanceReadRepository } from "@/store/developer/platform-developer-instance-read.repository";
import type {
  PlatformDeveloperInstanceReadStore,
  DeveloperInstanceReadTarget,
  DeveloperInstanceReadRow,
  DeveloperInstanceCursor,
} from "@/store/developer/platform-developer-instance-read.store";
import type { DeveloperUsageLocator } from "@/store/developer/platform-developer-usage-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
import type { DeveloperProductInstanceDto } from "@/api/dto/developer/product-platform.dto";
export class PlatformDeveloperInstanceReadIamService {
  private static instance: PlatformDeveloperInstanceReadIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformDeveloperInstanceReadStore = PlatformDeveloperInstanceReadRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperInstanceReadIamService());
  }
  private valid(t: DeveloperInstanceReadTarget, accountId: string, ownerId: string) {
    return (
      isDeveloperInstanceRecordId(t.id) &&
      t.status === 1 &&
      t.entitlementId === accountId &&
      isDeveloperInstanceRecordId(t.backingProjectId) &&
      t.backingProject?.id === t.backingProjectId &&
      t.backingProject.status === 1 &&
      t.backingProject.userId === ownerId &&
      t.backingProject.updateTime instanceof Date &&
      Number.isFinite(t.backingProject.updateTime.getTime()) &&
      [t.createTime, t.updateTime].every((d) => d instanceof Date && Number.isFinite(d.getTime()))
    );
  }
  private before(a: DeveloperInstanceCursor, b: DeveloperInstanceCursor) {
    return (
      a.createTime.getTime() < b.createTime.getTime() ||
      (a.createTime.getTime() === b.createTime.getTime() && a.id < b.id)
    );
  }
  private same(
    rows: readonly DeveloperInstanceReadTarget[],
    targets: readonly DeveloperInstanceReadTarget[],
    accountId: string,
    ownerId: string,
  ) {
    if (
      rows.length !== targets.length ||
      new Set(rows.map((t) => t.id)).size !== targets.length ||
      rows.some(
        (t) =>
          !this.valid(t, accountId, ownerId) ||
          !targets.some(
            (e) =>
              e.id === t.id &&
              e.backingProjectId === t.backingProjectId &&
              e.backingProject.updateTime.getTime() === t.backingProject.updateTime.getTime() &&
              e.createTime.getTime() === t.createTime.getTime() &&
              e.updateTime.getTime() === t.updateTime.getTime(),
          ),
      )
    )
      throw iamAccountDenied();
  }
  private dto(row: DeveloperInstanceReadRow, product: DeveloperProductCode): DeveloperProductInstanceDto {
    if (
      typeof row.name !== "string" ||
      !row.name.trim().length ||
      row.name.length > 100 ||
      typeof row.slug !== "string" ||
      !/^[a-z0-9-]{3,100}$/.test(row.slug) ||
      typeof row.enabled !== "boolean"
    )
      throw iamAccountDenied();
    return {
      id: row.id,
      productCode: product,
      accountProductId: row.entitlementId,
      name: row.name,
      slug: row.slug,
      enabled: row.enabled,
      createTime: row.createTime.toISOString(),
      updateTime: row.updateTime.toISOString(),
    };
  }
  private async allowed(principal: IamPrincipal, request: TypedRequest, rows: readonly DeveloperInstanceReadTarget[]) {
    if (!rows.length) return new Set<string>();
    const action = "quyan:developer:ListProductAccountInstances",
      resources = rows.map((row) => platformDeveloperInstanceArn(row.id)),
      start = performance.now();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (!Array.isArray(results) || results.length !== rows.length || results.some((r) => !r)) throw iamAccountDenied();
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
    return new Set(rows.filter((_, i) => results[i].decision === "Allow").map((row) => row.id));
  }
  async list(request: TypedRequest, product: DeveloperProductCode, locator: DeveloperUsageLocator, hydrate = true) {
    const identity = request && getIamPrincipal(request);
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !isDeveloperProductCode(product) ||
      !!locator.accountId === !!locator.userId ||
      !isDeveloperAccountRecordId(locator.accountId ?? locator.userId)
    )
      throw iamAccountDenied();
    const principal = { ...identity },
      permission = Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE;
    const snapshot = await this.identities.snapshot(principal, permission),
      account = await this.repository.target(principal, product, locator);
    if (
      !account ||
      account.status !== 1 ||
      !isDeveloperAccountRecordId(account.id) ||
      account.productCode !== product ||
      account.accountOwner?.id !== account.accountOwnerId ||
      account.accountOwner.status !== 1 ||
      account.accountOwner.userType !== "root" ||
      (account.accountOwner.accountOwnerId !== null &&
        account.accountOwner.accountOwnerId !== account.accountOwnerId) ||
      (locator.accountId && account.id !== locator.accountId) ||
      (locator.userId && account.accountOwnerId !== locator.userId) ||
      [account.updateTime, account.accountOwner.updateTime].some(
        (d) => !(d instanceof Date) || !Number.isFinite(d.getTime()),
      )
    )
      throw iamAccountDenied();
    await this.iam.loadPolicies(principal);
    const targets: DeveloperInstanceReadTarget[] = [];
    let after: DeveloperInstanceCursor | undefined;
    for (;;) {
      const batch = await this.repository.scan(principal, account, after);
      if (
        batch.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        batch.some(
          (t, i) =>
            !this.valid(t, account.id, account.accountOwnerId) ||
            (i ? !this.before(t, batch[i - 1]) : after !== undefined && !this.before(t, after)),
        )
      )
        throw iamAccountDenied();
      const allowed = await this.allowed(principal, request, batch);
      targets.push(...batch.filter((t) => allowed.has(t.id)));
      if (batch.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
      after = batch[batch.length - 1];
    }
    if (!hydrate) {
      await this.repository.recheckAccount(principal, account);
      await this.identities.recheck(principal, permission, snapshot);
      return undefined;
    }
    const rows: DeveloperInstanceReadRow[] = [];
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      if ((await this.allowed(principal, request, batch)).size !== batch.length) throw iamAccountDenied();
      const display = await this.repository.hydrate(principal, account, batch);
      this.same(display, batch, account.id, account.accountOwnerId);
      rows.push(...display);
    }
    rows.sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
    const result = rows.map((row) => this.dto(row, product));
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      this.same(await this.repository.recheck(principal, account, batch), batch, account.id, account.accountOwnerId);
      if ((await this.allowed(principal, request, batch)).size !== batch.length) throw iamAccountDenied();
    }
    await this.repository.recheckAccount(principal, account);
    await this.identities.recheck(principal, permission, snapshot);
    return result;
  }
}
