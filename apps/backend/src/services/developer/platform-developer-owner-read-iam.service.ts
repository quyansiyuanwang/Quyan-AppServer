import { performance } from "node:perf_hooks";
import { Permission, isDeveloperProductCode, type DeveloperProductCode, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  platformDeveloperAccountArn,
  platformDeveloperAccountScopeArn,
  isDeveloperAccountRecordId,
} from "@/iam/resources/platform-developer-account-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformDeveloperOwnerReadRepository } from "@/store/developer/platform-developer-owner-read.repository";
import type {
  PlatformDeveloperOwnerReadStore,
  DeveloperOwnerReadTarget,
  DeveloperOwnerReadRow,
  DeveloperOwnerCursor,
} from "@/store/developer/platform-developer-owner-read.store";
import { managedProductAccountsQuerySchema } from "@/api/schema/developer/product-platform.schema";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { BadRequestError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
export class PlatformDeveloperOwnerReadIamService {
  private static instance: PlatformDeveloperOwnerReadIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformDeveloperOwnerReadStore = PlatformDeveloperOwnerReadRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperOwnerReadIamService());
  }
  private valid(t: DeveloperOwnerReadTarget, product: DeveloperProductCode) {
    return (
      isDeveloperAccountRecordId(t.id) &&
      t.status === 1 &&
      t.userType === "root" &&
      (t.accountOwnerId === null || t.accountOwnerId === t.id) &&
      [t.createTime, t.updateTime].every((d) => d instanceof Date && Number.isFinite(d.getTime())) &&
      (!t.account ||
        (isDeveloperAccountRecordId(t.account.id) &&
          t.account.status === 1 &&
          t.account.accountOwnerId === t.id &&
          t.account.productCode === product &&
          t.account.updateTime instanceof Date &&
          Number.isFinite(t.account.updateTime.getTime())))
    );
  }
  private before(a: DeveloperOwnerCursor, b: DeveloperOwnerCursor) {
    return (
      a.createTime.getTime() < b.createTime.getTime() ||
      (a.createTime.getTime() === b.createTime.getTime() && a.id < b.id)
    );
  }
  private same(
    rows: readonly DeveloperOwnerReadTarget[],
    targets: readonly DeveloperOwnerReadTarget[],
    product: DeveloperProductCode,
  ) {
    if (
      rows.length !== targets.length ||
      new Set(rows.map((t) => t.id)).size !== targets.length ||
      rows.some(
        (t) =>
          !this.valid(t, product) ||
          !targets.some(
            (e) =>
              e.id === t.id &&
              e.accountOwnerId === t.accountOwnerId &&
              e.createTime.getTime() === t.createTime.getTime() &&
              e.updateTime.getTime() === t.updateTime.getTime() &&
              (e.account
                ? t.account &&
                  e.account.id === t.account.id &&
                  e.account.updateTime.getTime() === t.account.updateTime.getTime()
                : !t.account),
          ),
      )
    )
      throw iamAccountDenied();
  }
  private async allowed(
    principal: IamPrincipal,
    request: TypedRequest,
    targets: readonly DeveloperOwnerReadTarget[],
    product: DeveloperProductCode,
  ) {
    const action = "quyan:developer:ListProductAccountOwners";
    const requests = targets.flatMap((t) => [
      { ownerId: t.id, resource: platformDeveloperAccountScopeArn(t.id, product) },
      ...(t.account ? [{ ownerId: t.id, resource: platformDeveloperAccountArn(t.account.id) }] : []),
    ]);
    const denied = new Set<string>();
    for (let i = 0; i < requests.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = requests.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
        start = performance.now();
      const results = await this.iam.authorizeMany({
        principal,
        action,
        resources: batch.map((r) => r.resource),
        context: requestConditionContext(request, principal),
      });
      if (!Array.isArray(results) || results.length !== batch.length || results.some((r) => !r))
        throw iamAccountDenied();
      results.forEach((result, j) => {
        const resource = batch[j].resource;
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
        if (result.decision !== "Allow") denied.add(batch[j].ownerId);
      });
    }
    return new Set(targets.filter((t) => !denied.has(t.id)).map((t) => t.id));
  }
  async list<T>(
    request: TypedRequest,
    product: DeveloperProductCode,
    input: { page?: number; pageSize?: number; keyword?: string },
    project: (rows: DeveloperOwnerReadRow[], total: number, page: number, pageSize: number) => T,
    hydrate = true,
  ) {
    const query = managedProductAccountsQuerySchema.strict().safeParse(input);
    if (!query.success || !isDeveloperProductCode(product))
      throw new BadRequestError("Invalid product account directory query", undefined, {
        messageKey: "errors.badRequest",
      });
    const identity = request && getIamPrincipal(request);
    if (!identity || request.oauthAccessToken || identity.subjectUserId !== identity.principalUserId)
      throw iamAccountDenied();
    const principal = { ...identity },
      permission = Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE,
      snapshot = await this.identities.snapshot(principal, permission);
    await this.iam.loadPolicies(principal);
    const targets: DeveloperOwnerReadTarget[] = [];
    let after: DeveloperOwnerCursor | undefined;
    for (;;) {
      const batch = await this.repository.scan(principal, product, query.data.keyword, after);
      if (
        batch.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        batch.some(
          (t, i) =>
            !this.valid(t, product) ||
            (i ? !this.before(t, batch[i - 1]) : after !== undefined && !this.before(t, after)),
        )
      )
        throw iamAccountDenied();
      const allowed = await this.allowed(principal, request, batch, product);
      targets.push(...batch.filter((t) => allowed.has(t.id)));
      if (batch.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
      after = batch[batch.length - 1];
    }
    if (!hydrate) {
      await this.identities.recheck(principal, permission, snapshot);
      return undefined;
    }
    const page = query.data.page ?? 1,
      pageSize = query.data.pageSize ?? 20,
      selection = targets.slice((page - 1) * pageSize, page * pageSize);
    if ((await this.allowed(principal, request, selection, product)).size !== selection.length)
      throw iamAccountDenied();
    const rows = await this.repository.hydrate(principal, product, selection);
    this.same(rows, selection, product);
    rows.sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
    const result = project(rows, targets.length, page, pageSize);
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      this.same(await this.repository.recheck(principal, product, batch), batch, product);
      if ((await this.allowed(principal, request, batch, product)).size !== batch.length) throw iamAccountDenied();
    }
    await this.identities.recheck(principal, permission, snapshot);
    return result;
  }
}
