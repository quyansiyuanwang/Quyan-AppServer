import { performance } from "node:perf_hooks";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { platformOAuthReviewClientArn } from "@/iam/resources/platform-oauth-resources";
import { isCanonicalOAuthClientId } from "@/iam/resources/oauth-client-resources";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformOAuthReviewMutationRepository } from "@/store/users/platform-oauth-review-mutation.repository";
import type {
  PlatformOAuthReviewDecision,
  PlatformOAuthReviewMutationAction,
  PlatformOAuthReviewMutationGuard,
  PlatformOAuthReviewMutationStore,
} from "@/store/users/platform-oauth-review-mutation.store";
import type { TypedRequest } from "@/types/express";
export class PlatformOAuthReviewMutationIamService {
  private static instance: PlatformOAuthReviewMutationIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformOAuthReviewMutationStore = PlatformOAuthReviewMutationRepository.getInstance(),
    private readonly users = IamAccountUserRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformOAuthReviewMutationIamService());
  }
  async prepare(
    action: PlatformOAuthReviewMutationAction,
    userId: string,
    id: string,
    request?: TypedRequest,
    hydrate = true,
  ) {
    const identity = request && getIamPrincipal(request);
    if (
      !request ||
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== userId ||
      identity.principalUserId !== userId ||
      !isCanonicalOAuthClientId(id) ||
      !["quyan:oauth:ReviewClient", "quyan:oauth:DeleteReviewedClient"].includes(action)
    )
      throw iamAccountDenied();
    const principal = { ...identity };
    await this.iam.loadPolicies(principal);
    const group = await this.repository.groupSnapshot(principal),
      target = await this.repository.target(principal, id);
    if (
      !target ||
      target.id !== id ||
      !isCanonicalOAuthClientId(target.userId) ||
      target.status !== 1 ||
      target.isSystemClient !== false ||
      !(target.updateTime instanceof Date) ||
      !Number.isFinite(target.updateTime.getTime())
    )
      throw iamAccountDenied();
    const resource = platformOAuthReviewClientArn(id);
    const recheck = async () => {
      const start = performance.now(),
        result = await this.iam.authorize({
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
    };
    await recheck();
    if (!hydrate) return undefined;
    const ids = [...new Set([userId, principal.accountOwnerId])],
      users = await this.users.targets(principal, ids);
    if (
      users.length !== ids.length ||
      ids.some(
        (id) =>
          !users.some((u) => u.id === id && u.updateTime instanceof Date && Number.isFinite(u.updateTime.getTime())),
      )
    )
      throw iamAccountDenied();
    const existing = await this.repository.hydrate(principal, target);
    if (
      !existing ||
      existing.id !== target.id ||
      existing.userId !== target.userId ||
      existing.isSystemClient !== false ||
      existing.reviewStatus !== target.reviewStatus ||
      existing.updateTime.getTime() !== target.updateTime.getTime()
    )
      throw iamAccountDenied();
    const guard: PlatformOAuthReviewMutationGuard = {
      action,
      target,
      group,
      users: { principal, targetUserId: userId, users, recheck },
    };
    return { existing, guard };
  }
  mutate(guard: PlatformOAuthReviewMutationGuard, decision?: PlatformOAuthReviewDecision) {
    return this.repository.mutate(guard, decision);
  }
}
