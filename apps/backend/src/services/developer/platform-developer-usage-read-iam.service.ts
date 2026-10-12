import { performance } from "node:perf_hooks";
import { Permission, isDeveloperProductCode, type IamPrincipal, type DeveloperProductCode } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  platformDeveloperAccountArn,
  isDeveloperAccountRecordId,
} from "@/iam/resources/platform-developer-account-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformDeveloperUsageReadRepository } from "@/store/developer/platform-developer-usage-read.repository";
import type {
  PlatformDeveloperUsageReadStore,
  DeveloperUsageLocator,
  DeveloperUsageReadData,
} from "@/store/developer/platform-developer-usage-read.store";
import type { DeveloperAccountReadTarget } from "@/store/developer/platform-developer-account-read.store";
import {
  updateProductAccountBodySchema,
  updateProductConfigBodySchema,
} from "@/api/schema/developer/product-platform.schema";
import { toDatabaseDate, toLegacyDatabaseDate } from "@/util/database-date";
import type { TypedRequest } from "@/types/express";
import type { DeveloperProductUsageDto } from "@/api/dto/developer/product-platform.dto";
const configValues = updateProductConfigBodySchema.pick({ defaultDailyQuota: true, overagePrice: true });
export class PlatformDeveloperUsageReadIamService {
  private static instance: PlatformDeveloperUsageReadIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformDeveloperUsageReadStore = PlatformDeveloperUsageReadRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperUsageReadIamService());
  }
  private valid(target: DeveloperAccountReadTarget) {
    const owner = target.accountOwner;
    return (
      isDeveloperAccountRecordId(target.id) &&
      target.status === 1 &&
      isDeveloperProductCode(target.productCode) &&
      isDeveloperAccountRecordId(target.accountOwnerId) &&
      owner?.id === target.accountOwnerId &&
      owner.status === 1 &&
      owner.userType === "root" &&
      (owner.accountOwnerId === null || owner.accountOwnerId === owner.id) &&
      [target.createTime, target.updateTime, owner.updateTime].every(
        (d) => d instanceof Date && Number.isFinite(d.getTime()),
      )
    );
  }
  private same(current: DeveloperAccountReadTarget, expected: DeveloperAccountReadTarget) {
    if (
      !this.valid(current) ||
      current.id !== expected.id ||
      current.productCode !== expected.productCode ||
      current.accountOwnerId !== expected.accountOwnerId ||
      current.updateTime.getTime() !== expected.updateTime.getTime() ||
      current.accountOwner.updateTime.getTime() !== expected.accountOwner.updateTime.getTime() ||
      current.accountOwner.accountOwnerId !== expected.accountOwner.accountOwnerId
    )
      throw iamAccountDenied();
  }
  private async evaluate(principal: IamPrincipal, request: TypedRequest, id: string) {
    const action = "quyan:developer:GetProductAccountUsage",
      resource = platformDeveloperAccountArn(id),
      start = performance.now();
    const result = await this.iam.authorize({
      principal,
      action,
      resource,
      context: requestConditionContext(request, principal),
    });
    if (!result) throw iamAccountDenied();
    (request.iamDecisions ??= []).push({ ...result, action, resource });
    auditIamDecision({
      requestId: request.res?.locals.requestId,
      principal,
      action,
      resource,
      result,
      evaluationLatencyMs: performance.now() - start,
      authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
      ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
    });
    if (result.decision !== "Allow") throw iamAccountDenied();
  }
  private dto(
    data: DeveloperUsageReadData,
    target: DeveloperAccountReadTarget,
    dates: readonly Date[],
  ): DeveloperProductUsageDto {
    this.same(data.account, target);
    const parsed = updateProductAccountBodySchema
      .strict()
      .safeParse({
        dailyFreeQuota: data.account.dailyFreeQuota,
        overageEnabled: data.account.overageEnabled,
        instanceLimit: data.account.instanceLimit,
      });
    const config = configValues.safeParse({
      defaultDailyQuota: data.config?.defaultDailyQuota ?? 0,
      overagePrice: Number(data.config?.overagePrice ?? 0),
    });
    if (
      !parsed.success ||
      !config.success ||
      (data.config &&
        (data.config.status !== 1 ||
          data.config.productCode !== target.productCode ||
          !isDeveloperAccountRecordId(data.config.id) ||
          !(data.config.updateTime instanceof Date) ||
          !Number.isFinite(data.config.updateTime.getTime()))) ||
      data.usages.length > dates.length ||
      new Set(data.usages.map((row) => row.usageDate.getTime())).size !== data.usages.length ||
      data.usages.some(
        (row) =>
          row.entitlementId !== target.id ||
          row.status !== 1 ||
          !isDeveloperAccountRecordId(row.id) ||
          !Number.isSafeInteger(row.requestCount) ||
          row.requestCount < 0 ||
          !(row.updateTime instanceof Date) ||
          !Number.isFinite(row.updateTime.getTime()) ||
          !dates.some((d) => d.getTime() === row.usageDate.getTime()),
      )
    )
      throw iamAccountDenied();
    const usage = dates
      .map((date) => data.usages.find((row) => row.usageDate.getTime() === date.getTime()))
      .find(Boolean);
    const dailyFreeQuota = parsed.data.dailyFreeQuota ?? config.data.defaultDailyQuota,
      requestCount = usage?.requestCount ?? 0,
      unlimited = config.data.overagePrice <= 0;
    return {
      entitlementId: target.id,
      productCode: target.productCode as DeveloperProductCode,
      requestCount,
      dailyFreeQuota,
      remainingFree: unlimited ? 0 : Math.max(0, dailyFreeQuota - requestCount),
      unlimited,
      overageEnabled: parsed.data.overageEnabled,
    };
  }
  private stamp(data: DeveloperUsageReadData) {
    return JSON.stringify({
      config: data.config,
      usages: data.usages,
      quota: data.account.dailyFreeQuota,
      overageEnabled: data.account.overageEnabled,
      instanceLimit: data.account.instanceLimit,
    });
  }
  async get(request: TypedRequest, product: DeveloperProductCode, locator: DeveloperUsageLocator, hydrate = true) {
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
    const snapshot = await this.identities.snapshot(principal, permission);
    const target = await this.repository.target(principal, product, locator);
    if (
      !target ||
      !this.valid(target) ||
      target.productCode !== product ||
      (locator.accountId && target.id !== locator.accountId) ||
      (locator.userId && target.accountOwnerId !== locator.userId)
    )
      throw iamAccountDenied();
    await this.evaluate(principal, request, target.id);
    if (!hydrate) {
      await this.identities.recheck(principal, permission, snapshot);
      return undefined;
    }
    const now = new Date(),
      dates = [...new Map([toDatabaseDate(now), toLegacyDatabaseDate(now)].map((d) => [d.getTime(), d])).values()];
    const data = await this.repository.read(principal, target, dates),
      result = this.dto(data, target, dates);
    await this.evaluate(principal, request, target.id);
    const current = await this.repository.read(principal, target, dates);
    this.dto(current, target, dates);
    if (this.stamp(current) !== this.stamp(data)) throw iamAccountDenied();
    await this.identities.recheck(principal, permission, snapshot);
    await this.evaluate(principal, request, target.id);
    return result;
  }
}
