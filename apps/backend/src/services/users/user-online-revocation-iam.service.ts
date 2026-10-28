import { performance } from "node:perf_hooks";
import type { IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  onlineSessionArn,
  onlineUserArn,
  isCanonicalOnlineId,
  canRevokeOnlineUser,
} from "@/iam/resources/online-session-resources";
import { RedisService } from "@/services/infrastructure/redis.service";
import { UserOnlineRevocationRepository } from "@/store/users/user-online-revocation.repository";
import type { UserOnlineRevocationStore } from "@/store/users/user-online-revocation.store";
import { iamAccountDenied as denied } from "@/store/users/iam-account-principal";
import {
  buildForceOfflineUserKey,
  buildForceOfflineAuthSessionKey,
  getForceOfflineAuthSessionTtlSeconds,
  extractAuthSessionId,
} from "@/util/auth-session";
import type { TypedRequest } from "@/types/express";
import { InternalServerError } from "@/util/errors";
export class UserOnlineRevocationIamService {
  private static instance: UserOnlineRevocationIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: UserOnlineRevocationStore = UserOnlineRevocationRepository.getInstance(),
    private readonly redis: Pick<RedisService, "setWithResult"> = RedisService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new UserOnlineRevocationIamService());
  }
  private async identity(id: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (!request || !principal || principal.subjectUserId !== principal.principalUserId || !isCanonicalOnlineId(id))
      throw denied();
    await this.iam.loadPolicies(principal);
    return { principal, request };
  }
  private async allow(principal: IamPrincipal, request: TypedRequest, action: string, resource: string) {
    const start = performance.now(),
      result = await this.iam.authorize({
        principal,
        action,
        resource,
        context: requestConditionContext(request, principal),
      });
    if (!result) throw denied();
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
    if (result.decision !== "Allow") throw denied();
  }
  async authorizeSession(id: string, request?: TypedRequest) {
    const identity = await this.identity(id, request),
      target = await this.repository.sessionTarget(identity.principal, id);
    if (!target || target.id !== id || target.status !== 1 || !isCanonicalOnlineId(target.userId)) throw denied();
    if (!canRevokeOnlineUser(identity.principal, target.userId)) throw denied();
    const resource = onlineSessionArn(identity.principal.accountOwnerId, target.userId, target.id);
    await this.allow(identity.principal, identity.request, "quyan:user:ForceOfflineSession", resource);
    return { ...identity, target, resource };
  }
  async authorizeUser(id: string, request?: TypedRequest) {
    const identity = await this.identity(id, request);
    if (!canRevokeOnlineUser(identity.principal, id)) throw denied();
    const target = await this.repository.userTarget(identity.principal, id);
    if (!target || target.id !== id) throw denied();
    const resource = onlineUserArn(identity.principal.accountOwnerId, target.id);
    await this.allow(identity.principal, identity.request, "quyan:user:ForceOfflineUser", resource);
    return { ...identity, target, resource };
  }
  private async marker(key: string, endedAt: Date) {
    const result = await this.redis.setWithResult(key, endedAt.toISOString(), getForceOfflineAuthSessionTtlSeconds());
    if (result !== true)
      throw new InternalServerError("Online revocation marker unavailable", undefined, {
        messageKey: "errors.internalServerError",
      });
  }
  async session(id: string, request?: TypedRequest) {
    const state = await this.authorizeSession(id, request);
    await this.allow(state.principal, state.request, "quyan:user:ForceOfflineSession", state.resource);
    const result = await this.repository.closeSession(state.principal, state.target, (authSessionId, endedAt) =>
      this.marker(buildForceOfflineAuthSessionKey(authSessionId), endedAt),
    );
    return {
      closed: result.closed,
      sessionId: state.target.id,
      currentSessionAffected: Boolean(
        result.closed && result.authSessionId && result.authSessionId === extractAuthSessionId(state.request),
      ),
    };
  }
  async user(id: string, request?: TypedRequest) {
    const state = await this.authorizeUser(id, request);
    await this.allow(state.principal, state.request, "quyan:user:ForceOfflineUser", state.resource);
    const closedCount = await this.repository.closeUser(state.principal, state.target, (userId, endedAt) =>
      this.marker(buildForceOfflineUserKey(userId), endedAt),
    );
    return { closedCount, userId: state.target.id };
  }
}
