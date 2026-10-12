import { type IamPrincipal, toCanonicalCredential } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { performance } from "node:perf_hooks";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { ojApiKeyArn, isCanonicalOjApiKeyId } from "@/iam/resources/oj-apikey-resources";
import { OjApiKeyManagementRepository, ojApiKeyDenied } from "@/store/oj-submitter/oj-apikey-management.repository";
import type {
  OjApiKeyManagementStore,
  OjApiKeyTarget,
  OjApiKeyView,
} from "@/store/oj-submitter/oj-apikey-management.store";
import type { TypedRequest } from "@/types/express";
export class OjApiKeyIamService {
  private static instance: OjApiKeyIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: OjApiKeyManagementStore = OjApiKeyManagementRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new OjApiKeyIamService());
  }
  private async identity(userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId ||
      !isCanonicalOjApiKeyId(userId)
    )
      throw ojApiKeyDenied();
    await this.iam.loadPolicies(principal);
    await this.repository.assertActor(principal);
    return { request, principal };
  }
  private async allowed(
    request: TypedRequest,
    principal: IamPrincipal,
    action: string,
    targets: readonly { id: string; userId: string }[],
  ) {
    if (!targets.length) return new Set<string>();
    const resources = targets.map((t) => ojApiKeyArn(principal.accountOwnerId, t.userId, t.id));
    const start = performance.now();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (!Array.isArray(results) || results.length !== targets.length || targets.some((_, i) => !results[i]))
      throw ojApiKeyDenied();
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
  private validTarget(target: OjApiKeyTarget, userId: string) {
    return (
      isCanonicalOjApiKeyId(target.id) &&
      target.userId === userId &&
      target.status === 1 &&
      target.createTime instanceof Date &&
      Number.isFinite(target.createTime.getTime()) &&
      target.updateTime instanceof Date &&
      Number.isFinite(target.updateTime.getTime())
    );
  }
  private async views(
    identity: { request: TypedRequest; principal: IamPrincipal },
    action: string,
    targets: OjApiKeyTarget[],
    credentials: boolean,
  ) {
    const { request, principal } = identity;
    if (targets.some((t) => !this.validTarget(t, principal.subjectUserId))) throw ojApiKeyDenied();
    const allowed = await this.allowed(request, principal, action, targets),
      selected = targets.filter((t) => allowed.has(t.id));
    const reveal = credentials
      ? await this.allowed(request, principal, "quyan:oj:RevealApiKey", selected)
      : new Set<string>();
    const rows = await this.repository.hydrate(principal, selected, [...reveal]);
    if (rows.some((row) => !selected.some((t) => t.id === row.id && t.userId === row.userId))) throw ojApiKeyDenied();
    return rows.map((row) => {
      const { key, ...metadata } = row;
      return {
        ...metadata,
        ...(reveal.has(row.id) && typeof key === "string"
          ? { key: toCanonicalCredential(key, "ojApiKey") ?? key }
          : {}),
      };
    });
  }
  private async finalViews(
    identity: { request: TypedRequest; principal: IamPrincipal },
    action: string,
    rows: OjApiKeyView[],
    credentials: boolean,
  ) {
    const visible = await this.allowed(identity.request, identity.principal, action, rows);
    const selected = rows.filter((row) => visible.has(row.id));
    const reveal = credentials
      ? await this.allowed(identity.request, identity.principal, "quyan:oj:RevealApiKey", selected)
      : new Set<string>();
    return selected.map((row) => {
      const { key, ...metadata } = row;
      return { ...metadata, ...(reveal.has(row.id) && key ? { key } : {}) };
    });
  }
  private async collection(userId: string, action: string, credentials: boolean, request?: TypedRequest) {
    const identity = await this.identity(userId, request);
    let after: OjApiKeyTarget | undefined;
    const seen = new Set<string>(),
      rows: OjApiKeyView[] = [];
    while (true) {
      const targets = await this.repository.scan(identity.principal, after);
      if (!targets.length) break;
      if (
        targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        targets.some((t, i) => {
          const previous = i ? targets[i - 1] : after;
          return (
            !this.validTarget(t, userId) ||
            seen.has(t.id) ||
            (previous &&
              (t.createTime > previous.createTime ||
                (t.createTime.getTime() === previous.createTime.getTime() && t.id >= previous.id)))
          );
        })
      )
        throw ojApiKeyDenied();
      targets.forEach((t) => seen.add(t.id));
      rows.push(...(await this.views(identity, action, targets, credentials)));
      after = targets[targets.length - 1];
      if (targets.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    const final: OjApiKeyView[] = [];
    for (let i = 0; i < rows.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
      final.push(
        ...(await this.finalViews(
          identity,
          action,
          rows.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
          credentials,
        )),
      );
    return final;
  }
  async list(userId: string, request?: TypedRequest) {
    return this.collection(userId, "quyan:oj:ListApiKeys", true, request);
  }
  async get(userId: string, id: string, request?: TypedRequest) {
    const identity = await this.identity(userId, request);
    if (!isCanonicalOjApiKeyId(id)) throw ojApiKeyDenied();
    const target = await this.repository.target(identity.principal, id);
    if (!target || target.id !== id) throw ojApiKeyDenied();
    const rows = await this.views(identity, "quyan:oj:GetApiKey", [target], true);
    const final = await this.finalViews(identity, "quyan:oj:GetApiKey", rows, true);
    if (final.length !== 1) throw ojApiKeyDenied();
    return final[0];
  }
  async stats(userId: string, request?: TypedRequest) {
    const rows = await this.collection(userId, "quyan:oj:GetApiKeyStats", false, request),
      now = Date.now();
    return {
      totalKeys: rows.length,
      activeKeys: rows.filter((row) => !row.expiresAt || row.expiresAt.getTime() > now).length,
      totalRequests: rows.reduce((sum, row) => sum + row.requestCount, 0),
      totalTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
    };
  }
  async authorizeDeletion(userId: string, id: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId ||
      !isCanonicalOjApiKeyId(userId) ||
      !isCanonicalOjApiKeyId(id)
    )
      throw ojApiKeyDenied();
    await this.iam.loadPolicies(principal);
    const target = await this.repository.target(principal, id);
    if (!target || target.id !== id || target.userId !== userId || target.status !== 1) throw ojApiKeyDenied();
    const action = "quyan:oj:DeleteApiKey",
      resource = ojApiKeyArn(principal.accountOwnerId, userId, target.id);
    for (let check = 0; check < 2; check++) {
      const start = performance.now(),
        result = await this.iam.authorize({
          principal,
          action,
          resource,
          context: requestConditionContext(request, principal),
        });
      if (!result) throw ojApiKeyDenied();
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
      if (result.decision !== "Allow") throw ojApiKeyDenied();
    }
    return { principal, target };
  }
  async revoke(userId: string, id: string, request?: TypedRequest) {
    const { principal, target } = await this.authorizeDeletion(userId, id, request);
    return this.repository.revoke(principal, target);
  }
}
