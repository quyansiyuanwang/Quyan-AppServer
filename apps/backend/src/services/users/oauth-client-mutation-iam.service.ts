import { performance } from "node:perf_hooks";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { requestConditionContext } from "@/iam/request/condition-context";
import { isCanonicalOAuthClientId, oauthClientArn } from "@/iam/resources/oauth-client-resources";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { OAuthClientManagementRepository } from "@/store/users/oauth-client-management.repository";
import type { OAuthClientManagementStore } from "@/store/users/oauth-client-management.store";
import { OAuthClientMutationRepository } from "@/store/users/oauth-client-mutation.repository";
import type {
  OAuthClientMutationAction,
  OAuthClientMutationGuard,
  OAuthClientMutationStore,
} from "@/store/users/oauth-client-mutation.store";
import type { OAuthClientUpdateInput } from "@/store/users/oauth-client.store";
import { OAuthClientIamService } from "./oauth-client-iam.service";
import type { TypedRequest } from "@/types/express";
export class OAuthClientMutationIamService {
  private static instance: OAuthClientMutationIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly reads = OAuthClientIamService.getInstance(),
    private readonly repository: OAuthClientManagementStore = OAuthClientManagementRepository.getInstance(),
    private readonly users: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
    private readonly mutations: OAuthClientMutationStore = OAuthClientMutationRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new OAuthClientMutationIamService());
  }
  async prepare(action: OAuthClientMutationAction, userId: string, id: string, request?: TypedRequest, hydrate = true) {
    const actor = await this.reads.identity(userId, request),
      { principal } = actor.identity;
    if (!isCanonicalOAuthClientId(id)) throw iamAccountDenied();
    const target = await this.repository.target(actor.identity, id);
    if (
      !target ||
      target.id !== id ||
      target.userId !== userId ||
      target.status !== 1 ||
      target.isSystemClient !== false ||
      !(target.updateTime instanceof Date) ||
      !Number.isFinite(target.updateTime.getTime())
    )
      throw iamAccountDenied();
    const resource = oauthClientArn(principal.accountOwnerId, userId, id);
    const recheck = async () => {
      const start = performance.now(),
        result = await this.iam.authorize({
          principal,
          action,
          resource,
          context: requestConditionContext(actor.request, principal),
        });
      if (!result) throw iamAccountDenied();
      (actor.request.iamDecisions ??= []).push({ ...result, action, resource });
      auditIamDecision({
        requestId: actor.request.res?.locals.requestId,
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
    const rows = await this.repository.hydrate(actor.identity, [target]);
    if (
      rows.length !== 1 ||
      rows[0].id !== id ||
      rows[0].userId !== userId ||
      rows[0].status !== 1 ||
      rows[0].isSystemClient !== false ||
      rows[0].updateTime.getTime() !== target.updateTime.getTime()
    )
      throw iamAccountDenied();
    const guard: OAuthClientMutationGuard = {
      identity: actor.identity,
      target,
      users: { principal, targetUserId: userId, users, recheck },
    };
    return { existing: rows[0], guard };
  }
  revoke(guard: OAuthClientMutationGuard) {
    return this.mutations.revoke(guard);
  }
  update(data: OAuthClientUpdateInput, guard: OAuthClientMutationGuard) {
    return this.mutations.update(data, guard);
  }
}
