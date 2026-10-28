import { performance } from "node:perf_hooks";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { platformIpWhitelistArn, isIpWhitelistRecordId } from "@/iam/resources/platform-ip-whitelist-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformIpWhitelistReadRepository } from "@/store/security/platform-ip-whitelist-read.repository";
import type {
  PlatformIpWhitelistReadStore,
  IpWhitelistReadTarget,
} from "@/store/security/platform-ip-whitelist-read.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { ipWhitelistListQuerySchema, ipWhitelistIpParamsSchema } from "@/api/schema/system/ipwhitelist.schema";
import { BadRequestError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
export class PlatformIpWhitelistReadIamService {
  private static instance: PlatformIpWhitelistReadIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformIpWhitelistReadStore = PlatformIpWhitelistReadRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformIpWhitelistReadIamService());
  }
  private principal(request: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (!principal || request.oauthAccessToken || principal.subjectUserId !== principal.principalUserId)
      throw iamAccountDenied();
    return { ...principal };
  }
  private valid(t: IpWhitelistReadTarget) {
    return (
      isIpWhitelistRecordId(t.id) &&
      t.status === 1 &&
      [t.createTime, t.updateTime].every((d) => d instanceof Date && Number.isFinite(d.getTime())) &&
      (t.expiresAt === null || (t.expiresAt instanceof Date && Number.isFinite(t.expiresAt.getTime())))
    );
  }
  private same(current: readonly IpWhitelistReadTarget[], expected: readonly IpWhitelistReadTarget[]) {
    if (
      current.length !== expected.length ||
      current.some(
        (t) =>
          !this.valid(t) ||
          !expected.some(
            (e) =>
              e.id === t.id &&
              e.updateTime.getTime() === t.updateTime.getTime() &&
              e.expiresAt?.getTime() === t.expiresAt?.getTime(),
          ),
      )
    )
      throw iamAccountDenied();
  }
  private async allowed(
    principal: IamPrincipal,
    request: TypedRequest,
    action: string,
    targets: readonly IpWhitelistReadTarget[],
  ) {
    if (!targets.length) return new Set<string>();
    if (targets.some((t) => !this.valid(t))) throw iamAccountDenied();
    const resources = targets.map((t) => platformIpWhitelistArn(t.id)),
      start = performance.now();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (!Array.isArray(results) || results.length !== targets.length || results.some((r) => !r))
      throw iamAccountDenied();
    results.forEach((result, index) => {
      (request.iamDecisions ??= []).push({ ...result, action, resource: resources[index] });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource: resources[index],
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
        ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
      });
    });
    return new Set(targets.filter((_, i) => results[i].decision === "Allow").map((t) => t.id));
  }
  async list(limit: number | undefined, offset: number | undefined, request: TypedRequest, hydrate = true) {
    const parsed = ipWhitelistListQuerySchema.strict().safeParse({ limit, offset });
    if (!parsed.success)
      throw new BadRequestError("Invalid IP whitelist pagination", undefined, { messageKey: "errors.badRequest" });
    const principal = this.principal(request),
      snapshot = await this.identities.snapshot(principal, Permission.IP_WHITELIST_READ);
    await this.iam.loadPolicies(principal);
    const action = "quyan:ip_whitelist:ListEntries",
      targets: IpWhitelistReadTarget[] = [];
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
      await this.identities.recheck(principal, Permission.IP_WHITELIST_READ, snapshot);
      return { whitelists: [], total: targets.length };
    }
    targets.sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
    const page = targets.slice(
      parsed.data.offset ?? 0,
      (parsed.data.offset ?? 0) + (parsed.data.limit ?? IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
    );
    const rows: Awaited<ReturnType<PlatformIpWhitelistReadStore["hydrate"]>> = [];
    for (let i = 0; i < page.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = page.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      if ((await this.allowed(principal, request, action, batch)).size !== batch.length) throw iamAccountDenied();
      const hydrated = await this.repository.hydrate(principal, batch);
      this.same(hydrated, batch);
      rows.push(...hydrated);
    }
    // Recheck every record contributing to total, including authorized rows outside this page.
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      if ((await this.allowed(principal, request, action, batch)).size !== batch.length) throw iamAccountDenied();
      this.same(await this.repository.recheck(principal, batch), batch);
    }
    await this.identities.recheck(principal, Permission.IP_WHITELIST_READ, snapshot);
    return { whitelists: page.map((t) => rows.find((r) => r.id === t.id)!), total: targets.length };
  }
  async status(ip: string, request: TypedRequest) {
    const parsed = ipWhitelistIpParamsSchema.safeParse({ ip });
    if (!parsed.success)
      throw new BadRequestError("Invalid IP whitelist address", undefined, { messageKey: "errors.badRequest" });
    const principal = this.principal(request),
      snapshot = await this.identities.snapshot(principal, Permission.IP_WHITELIST_READ);
    const target = await this.repository.target(principal, parsed.data.ip);
    if (!target || !this.valid(target)) throw iamAccountDenied();
    const action = "quyan:ip_whitelist:GetStatus";
    if (!(await this.allowed(principal, request, action, [target])).has(target.id)) throw iamAccountDenied();
    await this.identities.recheck(principal, Permission.IP_WHITELIST_READ, snapshot);
    this.same(await this.repository.recheck(principal, [target]), [target]);
    if (!(await this.allowed(principal, request, action, [target])).has(target.id)) throw iamAccountDenied();
    const current = await this.repository.target(principal, parsed.data.ip);
    if (!current) throw iamAccountDenied();
    this.same([current], [target]);
    await this.identities.recheck(principal, Permission.IP_WHITELIST_READ, snapshot);
    return current.expiresAt === null || current.expiresAt.getTime() > Date.now();
  }
}
