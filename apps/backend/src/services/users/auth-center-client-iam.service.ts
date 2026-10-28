import { performance } from "node:perf_hooks";
import { getOAuthScopeAliases } from "@quyan/shared";
import { env } from "@/config/env";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { isCanonicalOAuthClientId, authCenterClientArn } from "@/iam/resources/auth-center-client-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { AuthCenterClientManagementRepository } from "@/store/users/auth-center-client-management.repository";
import type {
  OAuthClientIdentity,
  AuthCenterClientManagementStore,
  AuthCenterClientTarget,
} from "@/store/users/auth-center-client-management.store";
import type { TypedRequest } from "@/types/express";
type ReadAction = "quyan:auth_center:ListClients" | "quyan:auth_center:GetClient";
export class AuthCenterClientIamService {
  private static instance: AuthCenterClientIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: AuthCenterClientManagementStore = AuthCenterClientManagementRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new AuthCenterClientIamService());
  }
  async identity(userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request),
      oauth = request?.oauthAccessToken;
    if (
      !request ||
      !principal ||
      !isCanonicalOAuthClientId(userId) ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId ||
      (oauth &&
        (oauth.userId !== userId ||
          !getOAuthScopeAliases("auth_center_client").some((s) => oauth.scopes.includes(s)) ||
          !Number.isFinite(Date.parse(oauth.expiresAt)) ||
          Date.parse(oauth.expiresAt) <= Date.now()))
    )
      throw iamAccountDenied();
    const identity: OAuthClientIdentity = {
      principal: { ...principal },
      ...(oauth ? { oauth: { id: oauth.id, clientId: oauth.oauthClientId } } : {}),
    };
    await this.iam.loadPolicies(identity.principal);
    await this.repository.assertActor(identity);
    return { identity, request };
  }
  private validTarget(target: AuthCenterClientTarget, userId: string) {
    return (
      isCanonicalOAuthClientId(target.id) &&
      target.userId === userId &&
      target.status === 1 &&
      target.createTime instanceof Date &&
      Number.isFinite(target.createTime.getTime()) &&
      target.updateTime instanceof Date &&
      Number.isFinite(target.updateTime.getTime())
    );
  }
  private async allowed(
    actor: { identity: OAuthClientIdentity; request: TypedRequest },
    action: ReadAction,
    targets: readonly AuthCenterClientTarget[],
  ) {
    if (targets.some((t) => !this.validTarget(t, actor.identity.principal.subjectUserId))) throw iamAccountDenied();
    if (!targets.length) return new Set<string>();
    const { identity, request } = actor,
      resources = targets.map((t) => authCenterClientArn(identity.principal.accountOwnerId, t.userId, t.id));
    const start = performance.now(),
      results = await this.iam.authorizeMany({
        principal: identity.principal,
        action,
        resources,
        context: requestConditionContext(request, identity.principal),
      });
    if (!Array.isArray(results) || results.length !== targets.length || targets.some((_, i) => !results[i]))
      throw iamAccountDenied();
    results.forEach((result, i) => {
      (request.iamDecisions ??= []).push({ ...result, action, resource: resources[i] });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal: identity.principal,
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
  private async collection(userId: string, request: TypedRequest | undefined, hydrate: boolean) {
    const actor = await this.identity(userId, request),
      action = "quyan:auth_center:ListClients",
      targets: AuthCenterClientTarget[] = [];
    let after: AuthCenterClientTarget | undefined;
    for (;;) {
      const batch = await this.repository.scan(actor.identity, after);
      if (
        batch.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        batch.some(
          (t, i) =>
            !this.validTarget(t, userId) ||
            ((i ? batch[i - 1] : after) && !this.follows(t, (i ? batch[i - 1] : after)!)),
        )
      )
        throw iamAccountDenied();
      const allowed = await this.allowed(actor, action, batch);
      targets.push(...batch.filter((t) => allowed.has(t.id)));
      if (batch.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
      after = batch[batch.length - 1];
    }
    if (!hydrate) return [];
    const rows = [];
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const selected = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      const hydrated = await this.repository.hydrate(actor.identity, selected);
      if (
        hydrated.length !== selected.length ||
        new Set(hydrated.map((r) => r.id)).size !== selected.length ||
        hydrated.some(
          (r) =>
            !this.validTarget(r, userId) ||
            !selected.some((t) => t.id === r.id && t.updateTime.getTime() === r.updateTime.getTime()),
        )
      )
        throw iamAccountDenied();
      rows.push(...hydrated);
    }
    const valid = new Set<string>();
    for (let i = 0; i < targets.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
        allowed = await this.allowed(actor, action, batch);
      const selected = batch.filter((t) => allowed.has(t.id)),
        current = await this.repository.recheck(actor.identity, selected);
      if (
        current.some(
          (r) =>
            !this.validTarget(r, userId) ||
            !selected.some((t) => t.id === r.id && t.updateTime.getTime() === r.updateTime.getTime()),
        )
      )
        throw iamAccountDenied();
      current.forEach((r) => valid.add(r.id));
    }
    await this.repository.assertActor(actor.identity);
    return rows.filter((r) => valid.has(r.id));
  }
  private follows(current: AuthCenterClientTarget, previous: AuthCenterClientTarget) {
    return (
      current.createTime < previous.createTime ||
      (current.createTime.getTime() === previous.createTime.getTime() && current.id < previous.id)
    );
  }
  list(userId: string, request?: TypedRequest) {
    return this.collection(userId, request, true);
  }
  diagnoseList(userId: string, request?: TypedRequest) {
    return this.collection(userId, request, false);
  }
  async get(userId: string, id: string, request?: TypedRequest, hydrate = true) {
    const actor = await this.identity(userId, request);
    if (!isCanonicalOAuthClientId(id)) throw iamAccountDenied();
    const target = await this.repository.target(actor.identity, id);
    if (!target || target.id !== id || !(await this.allowed(actor, "quyan:auth_center:GetClient", [target])).has(id))
      throw iamAccountDenied();
    if (!hydrate) return undefined;
    const rows = await this.repository.hydrate(actor.identity, [target]);
    if (
      rows.length !== 1 ||
      rows[0].id !== id ||
      !this.validTarget(rows[0], userId) ||
      rows[0].updateTime.getTime() !== target.updateTime.getTime() ||
      !(await this.allowed(actor, "quyan:auth_center:GetClient", [target])).has(id)
    )
      throw iamAccountDenied();
    const current = await this.repository.target(actor.identity, id);
    if (!current || !this.validTarget(current, userId) || current.updateTime.getTime() !== target.updateTime.getTime())
      throw iamAccountDenied();
    await this.repository.assertActor(actor.identity);
    return rows[0];
  }
}
