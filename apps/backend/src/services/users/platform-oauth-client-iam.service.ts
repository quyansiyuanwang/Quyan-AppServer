import { performance } from "node:perf_hooks";
import { env } from "@/config/env";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { requestConditionContext } from "@/iam/request/condition-context";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformOAuthClientArn } from "@/iam/resources/platform-oauth-resources";
import { isCanonicalOAuthClientId } from "@/iam/resources/oauth-client-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { PlatformOAuthClientRepository } from "@/store/users/platform-oauth-client.repository";
import type { PlatformOAuthClientStore } from "@/store/users/platform-oauth-client.store";
import type { OAuthClientTarget } from "@/store/users/oauth-client-management.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "./permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
export class PlatformOAuthClientIamService {
  private static instance: PlatformOAuthClientIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformOAuthClientStore = PlatformOAuthClientRepository.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformOAuthClientIamService());
  }
  private valid(row: OAuthClientTarget) {
    return (
      isCanonicalOAuthClientId(row.id) &&
      isCanonicalOAuthClientId(row.userId) &&
      row.status === 1 &&
      row.isSystemClient === true &&
      row.createTime instanceof Date &&
      Number.isFinite(row.createTime.getTime()) &&
      row.updateTime instanceof Date &&
      Number.isFinite(row.updateTime.getTime())
    );
  }
  private async allowed(principal: IamPrincipal, request: TypedRequest, targets: readonly OAuthClientTarget[]) {
    if (targets.some((t) => !this.valid(t))) throw iamAccountDenied();
    if (!targets.length) return new Set<string>();
    const action = "quyan:oauth:ListSystemClients",
      resources = targets.map((t) => platformOAuthClientArn(t.id)),
      start = performance.now();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (!Array.isArray(results) || results.length !== targets.length || targets.some((_, i) => !results[i]))
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
  async list(request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (!request || !principal || request.oauthAccessToken) throw iamAccountDenied();
    if (
      env.security.iamAuthorizationMode !== "enforce" &&
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.OAUTH_CLIENT_SYSTEM_MANAGE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    return this.read(principal, request, true);
  }
  async diagnose(request: TypedRequest) {
    if (env.security.iamAuthorizationMode !== "shadow") return;
    const principal = getIamPrincipal(request);
    if (!principal) throw iamAccountDenied();
    try {
      await this.read(principal, request, false);
    } catch {
      getLogger("PlatformOAuthIamBridge", LogCategory.SECURITY).warn("Platform OAuth IAM shadow evaluation failed", {
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
  }
  private async read(principal: IamPrincipal, request: TypedRequest, hydrate: boolean) {
    await this.iam.loadPolicies(principal);
    await this.repository.assertActor(principal);
    const targets: OAuthClientTarget[] = [];
    let after: string | undefined;
    for (;;) {
      const batch = await this.repository.scan(principal, after);
      if (
        batch.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        batch.some((t, i) => !this.valid(t) || (i ? t.id <= batch[i - 1].id : after !== undefined && t.id <= after))
      )
        throw iamAccountDenied();
      const allow = await this.allowed(principal, request, batch);
      targets.push(...batch.filter((t) => allow.has(t.id)));
      if (batch.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
      after = batch[batch.length - 1].id;
    }
    if (!hydrate) return [];
    const rows = [];
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
        selected = await this.repository.hydrate(principal, batch);
      if (
        selected.some(
          (t) =>
            !this.valid(t) ||
            !batch.some(
              (b) => b.id === t.id && b.userId === t.userId && b.updateTime.getTime() === t.updateTime.getTime(),
            ),
        )
      )
        throw iamAccountDenied();
      rows.push(...selected);
    }
    const currentIds = new Set<string>();
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
        allow = await this.allowed(principal, request, batch),
        selected = batch.filter((t) => allow.has(t.id));
      const current = await this.repository.recheck(principal, selected);
      if (
        current.some(
          (t) =>
            !this.valid(t) ||
            !selected.some(
              (b) => b.id === t.id && b.userId === t.userId && b.updateTime.getTime() === t.updateTime.getTime(),
            ),
        )
      )
        throw iamAccountDenied();
      current.forEach((t) => currentIds.add(t.id));
    }
    await this.repository.assertActor(principal);
    return rows
      .filter((r) => currentIds.has(r.id))
      .sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
  }
}
