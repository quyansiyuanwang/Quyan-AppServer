import { performance } from "node:perf_hooks";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  platformIpWhitelistArn,
  platformIpWhitelistCollectionArn,
} from "@/iam/resources/platform-ip-whitelist-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformIpWhitelistWriteRepository } from "@/store/security/platform-ip-whitelist-write.repository";
import type {
  PlatformIpWhitelistWriteStore,
  PlatformIpWhitelistWriteGuard,
} from "@/store/security/platform-ip-whitelist-write.store";
import { createIPWhitelistBodySchema, ipWhitelistIpParamsSchema } from "@/api/schema/system/ipwhitelist.schema";
import { BadRequestError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
export class PlatformIpWhitelistWriteIamService {
  private static instance: PlatformIpWhitelistWriteIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformIpWhitelistWriteStore = PlatformIpWhitelistWriteRepository.getInstance(),
    private readonly identities: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformIpWhitelistWriteIamService());
  }
  private principal(userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      principal.subjectUserId !== userId
    )
      throw iamAccountDenied();
    return { principal: { ...principal }, request };
  }
  private async evaluate(principal: IamPrincipal, request: TypedRequest, action: string, resource: string) {
    const start = performance.now();
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
  private async guard(
    userId: string,
    request: TypedRequest | undefined,
    permission: Permission,
    action: string,
    resource: string,
  ) {
    const identity = this.principal(userId, request),
      { principal } = identity;
    const snapshot = await this.identities.snapshot(principal, permission);
    await this.evaluate(principal, identity.request, action, resource);
    const recheck = async () => {
      await this.identities.recheck(principal, permission, snapshot);
      await this.evaluate(principal, identity.request, action, resource);
      await this.identities.recheck(principal, permission, snapshot);
    };
    const guard: PlatformIpWhitelistWriteGuard = {
      permission,
      group: snapshot.group,
      users: { principal, targetUserId: userId, users: snapshot.users, recheck },
      recheckEntry: async (id) => this.evaluate(principal, identity.request, action, platformIpWhitelistArn(id)),
    };
    return guard;
  }
  async create(
    ip: string,
    reason: string,
    userId: string,
    expiresAt: Date | undefined,
    request?: TypedRequest,
    persist = true,
  ) {
    const parsed = createIPWhitelistBodySchema.strict().safeParse({
      ipAddress: ip,
      reason,
      expiresAt:
        expiresAt instanceof Date && Number.isFinite(expiresAt.getTime()) ? expiresAt.toISOString() : expiresAt,
    });
    if (!parsed.success)
      throw new BadRequestError("Invalid IP whitelist entry", undefined, { messageKey: "errors.badRequest" });
    const guard = await this.guard(
      userId,
      request,
      Permission.IP_WHITELIST_CREATE,
      "quyan:ip_whitelist:CreateEntry",
      platformIpWhitelistCollectionArn(),
    );
    if (!persist) {
      await guard.users.recheck();
      return undefined;
    }
    return this.repository.create(
      {
        ipAddress: parsed.data.ipAddress,
        reason: parsed.data.reason ?? "",
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
      },
      guard,
    );
  }
  async remove(ip: string, userId: string, request?: TypedRequest, persist = true) {
    const parsed = ipWhitelistIpParamsSchema.safeParse({ ip });
    if (!parsed.success)
      throw new BadRequestError("Invalid IP whitelist address", undefined, { messageKey: "errors.badRequest" });
    const { principal } = this.principal(userId, request);
    const target = await this.repository.target(principal, parsed.data.ip);
    if (!target || target.status !== 1) throw iamAccountDenied();
    const guard = await this.guard(
      userId,
      request,
      Permission.IP_WHITELIST_DELETE,
      "quyan:ip_whitelist:DeleteEntry",
      platformIpWhitelistArn(target.id),
    );
    if (!persist) {
      await guard.users.recheck();
      return false;
    }
    return this.repository.remove(target, guard);
  }
}
