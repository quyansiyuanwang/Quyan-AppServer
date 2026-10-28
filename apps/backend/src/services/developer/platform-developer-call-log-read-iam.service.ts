import { performance } from "node:perf_hooks";
import { Permission, isDeveloperProductCode, type DeveloperProductCode, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  platformDeveloperCallLogArn,
  isDeveloperCallLogRecordId,
} from "@/iam/resources/platform-developer-call-log-resources";
import { isDeveloperAccountRecordId } from "@/iam/resources/platform-developer-account-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { DEVELOPER_PRODUCT_CALL_LOG_LIMIT } from "@/constant/developer-product-read";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformDeveloperCallLogReadRepository } from "@/store/developer/platform-developer-call-log-read.repository";
import type {
  PlatformDeveloperCallLogReadStore,
  DeveloperCallLogReadTarget,
  DeveloperCallLogReadRow,
  DeveloperCallLogCursor,
} from "@/store/developer/platform-developer-call-log-read.store";
import type { DeveloperUsageLocator } from "@/store/developer/platform-developer-usage-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
import type { DeveloperProductCallLogDto } from "@/api/dto/developer/product-platform.dto";
export class PlatformDeveloperCallLogReadIamService {
  private static instance: PlatformDeveloperCallLogReadIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformDeveloperCallLogReadStore = PlatformDeveloperCallLogReadRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperCallLogReadIamService());
  }
  private valid(t: DeveloperCallLogReadTarget, accountId: string) {
    return (
      isDeveloperCallLogRecordId(t.id) &&
      t.status === 1 &&
      t.entitlementId === accountId &&
      [t.createTime, t.updateTime].every((d) => d instanceof Date && Number.isFinite(d.getTime()))
    );
  }
  private before(a: DeveloperCallLogCursor, b: DeveloperCallLogCursor) {
    return (
      a.createTime.getTime() < b.createTime.getTime() ||
      (a.createTime.getTime() === b.createTime.getTime() && a.id < b.id)
    );
  }
  private same(
    rows: readonly DeveloperCallLogReadTarget[],
    targets: readonly DeveloperCallLogReadTarget[],
    accountId: string,
  ) {
    if (
      rows.length !== targets.length ||
      new Set(rows.map((t) => t.id)).size !== targets.length ||
      rows.some(
        (t) =>
          !this.valid(t, accountId) ||
          !targets.some(
            (e) =>
              e.id === t.id &&
              e.createTime.getTime() === t.createTime.getTime() &&
              e.updateTime.getTime() === t.updateTime.getTime(),
          ),
      )
    )
      throw iamAccountDenied();
  }
  private dto(row: DeveloperCallLogReadRow): DeveloperProductCallLogDto {
    const chargeAmount = Number(row.chargeAmount);
    if (
      !Number.isFinite(chargeAmount) ||
      chargeAmount < 0 ||
      typeof row.action !== "string" ||
      !row.action.length ||
      typeof row.success !== "boolean" ||
      (row.errorCode !== null && !Number.isSafeInteger(row.errorCode)) ||
      [row.instanceId, row.keyId, row.subjectUserId].some((id) => id !== null && !isDeveloperAccountRecordId(id))
    )
      throw iamAccountDenied();
    return {
      id: row.id,
      entitlementId: row.entitlementId,
      instanceId: row.instanceId ?? undefined,
      keyId: row.keyId ?? undefined,
      subjectUserId: row.subjectUserId ?? undefined,
      action: row.action,
      success: row.success,
      errorCode: row.errorCode ?? undefined,
      chargeAmount,
      createTime: row.createTime.toISOString(),
    };
  }
  private async allowed(principal: IamPrincipal, request: TypedRequest, rows: readonly DeveloperCallLogReadTarget[]) {
    if (!rows.length) return new Set<string>();
    const action = "quyan:developer:ListProductAccountCalls",
      resources = rows.map((row) => platformDeveloperCallLogArn(row.id)),
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
    const targets: DeveloperCallLogReadTarget[] = [];
    let after: DeveloperCallLogCursor | undefined;
    for (;;) {
      const batch = await this.repository.scan(principal, account, after);
      if (
        batch.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        batch.some(
          (t, i) =>
            !this.valid(t, account.id) ||
            (i ? !this.before(t, batch[i - 1]) : after !== undefined && !this.before(t, after)),
        )
      )
        throw iamAccountDenied();
      const allowed = await this.allowed(principal, request, batch);
      targets.push(
        ...batch.filter((t) => allowed.has(t.id)).slice(0, DEVELOPER_PRODUCT_CALL_LOG_LIMIT - targets.length),
      );
      if (
        targets.length === DEVELOPER_PRODUCT_CALL_LOG_LIMIT ||
        batch.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest
      )
        break;
      after = batch[batch.length - 1];
    }
    if (!hydrate) {
      await this.repository.recheckAccount(principal, account);
      await this.identities.recheck(principal, permission, snapshot);
      return undefined;
    }
    if ((await this.allowed(principal, request, targets)).size !== targets.length) throw iamAccountDenied();
    const rows = await this.repository.hydrate(principal, account, targets);
    this.same(rows, targets, account.id);
    rows.sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
    const result = rows.map((row) => this.dto(row));
    this.same(await this.repository.recheck(principal, account, targets), targets, account.id);
    await this.repository.recheckAccount(principal, account);
    await this.identities.recheck(principal, permission, snapshot);
    if ((await this.allowed(principal, request, targets)).size !== targets.length) throw iamAccountDenied();
    return result;
  }
}
