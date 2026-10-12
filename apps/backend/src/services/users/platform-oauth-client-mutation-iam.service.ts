import { performance } from "node:perf_hooks";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { platformOAuthClientArn } from "@/iam/resources/platform-oauth-resources";
import { isCanonicalOAuthClientId } from "@/iam/resources/oauth-client-resources";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { PlatformOAuthClientRepository } from "@/store/users/platform-oauth-client.repository";
import type { PlatformOAuthClientStore } from "@/store/users/platform-oauth-client.store";
import { PlatformOAuthClientMutationRepository } from "@/store/users/platform-oauth-client-mutation.repository";
import type {
  PlatformOAuthClientMutationGuard,
  PlatformOAuthClientMutationStore,
} from "@/store/users/platform-oauth-client-mutation.store";
import type { OAuthClientUpdateInput } from "@/store/users/oauth-client.store";
import type { TypedRequest } from "@/types/express";
export class PlatformOAuthClientMutationIamService {
  private static instance: PlatformOAuthClientMutationIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: PlatformOAuthClientStore = PlatformOAuthClientRepository.getInstance(),
    private readonly users: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
    private readonly mutations: PlatformOAuthClientMutationStore = PlatformOAuthClientMutationRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformOAuthClientMutationIamService());
  }
  async prepareUpdate(userId: string, id: string, request?: TypedRequest, hydrate = true) {
    const identity = request && getIamPrincipal(request);
    if (
      !request ||
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== userId ||
      identity.principalUserId !== userId ||
      !isCanonicalOAuthClientId(id)
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
      target.isSystemClient !== true ||
      !(target.updateTime instanceof Date) ||
      !Number.isFinite(target.updateTime.getTime())
    )
      throw iamAccountDenied();
    const action = "quyan:oauth:UpdateSystemClient",
      resource = platformOAuthClientArn(id);
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
    const rows = await this.repository.hydrate(principal, [target]);
    if (
      rows.length !== 1 ||
      rows[0].id !== id ||
      rows[0].userId !== target.userId ||
      rows[0].isSystemClient !== true ||
      rows[0].updateTime.getTime() !== target.updateTime.getTime()
    )
      throw iamAccountDenied();
    const guard: PlatformOAuthClientMutationGuard = {
      target,
      group,
      users: { principal, targetUserId: userId, users, recheck },
    };
    return { existing: rows[0], guard };
  }
  update(data: OAuthClientUpdateInput, guard: PlatformOAuthClientMutationGuard) {
    return this.mutations.update(data, guard);
  }
}
