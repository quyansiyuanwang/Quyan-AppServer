import { performance } from "node:perf_hooks";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { platformAuthCenterReviewClientArn } from "@/iam/resources/platform-auth-center-resources";
import { isCanonicalOAuthClientId } from "@/iam/resources/oauth-client-resources";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformAuthCenterReviewMutationRepository } from "@/store/users/platform-auth-center-review-mutation.repository";
import type {
  PlatformAuthCenterReviewDecision,
  PlatformAuthCenterReviewMutationAction,
  PlatformAuthCenterReviewMutationGuard,
  PlatformAuthCenterReviewMutationStore,
} from "@/store/users/platform-auth-center-review-mutation.store";
import type { TypedRequest } from "@/types/express";
export class PlatformAuthCenterReviewMutationIamService {
  private static instance: PlatformAuthCenterReviewMutationIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformAuthCenterReviewMutationStore = PlatformAuthCenterReviewMutationRepository.getInstance(),
    private readonly users = IamAccountUserRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformAuthCenterReviewMutationIamService());
  }
  async prepare(
    action: PlatformAuthCenterReviewMutationAction,
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
      !["quyan:auth_center:ReviewClient", "quyan:auth_center:DeleteReviewedClient"].includes(action)
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
      !(target.updateTime instanceof Date) ||
      !Number.isFinite(target.updateTime.getTime())
    )
      throw iamAccountDenied();
    const resource = platformAuthCenterReviewClientArn(id);
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
      existing.reviewStatus !== target.reviewStatus ||
      existing.updateTime.getTime() !== target.updateTime.getTime()
    )
      throw iamAccountDenied();
    const guard: PlatformAuthCenterReviewMutationGuard = {
      action,
      target,
      group,
      users: { principal, targetUserId: userId, users, recheck },
    };
    return { existing, guard };
  }
  mutate(guard: PlatformAuthCenterReviewMutationGuard, decision?: PlatformAuthCenterReviewDecision) {
    return this.repository.mutate(guard, decision);
  }
}
