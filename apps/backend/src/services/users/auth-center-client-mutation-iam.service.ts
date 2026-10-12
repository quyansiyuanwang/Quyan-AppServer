import { performance } from "node:perf_hooks";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { requestConditionContext } from "@/iam/request/condition-context";
import { isCanonicalOAuthClientId, authCenterClientArn } from "@/iam/resources/auth-center-client-resources";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { AuthCenterClientManagementRepository } from "@/store/users/auth-center-client-management.repository";
import type { AuthCenterClientManagementStore } from "@/store/users/auth-center-client-management.store";
import { AuthCenterClientMutationRepository } from "@/store/users/auth-center-client-mutation.repository";
import type {
  AuthCenterClientMutationAction,
  AuthCenterClientMutationGuard,
  AuthCenterClientMutationStore,
} from "@/store/users/auth-center-client-mutation.store";
import type { AuthCenterClientUpdateInput } from "@/store/users/auth-center-client.store";
import { AuthCenterClientIamService } from "./auth-center-client-iam.service";
import type { TypedRequest } from "@/types/express";
export class AuthCenterClientMutationIamService {
  private static instance: AuthCenterClientMutationIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly reads = AuthCenterClientIamService.getInstance(),
    private readonly repository: AuthCenterClientManagementStore = AuthCenterClientManagementRepository.getInstance(),
    private readonly users: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
    private readonly mutations: AuthCenterClientMutationStore = AuthCenterClientMutationRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new AuthCenterClientMutationIamService());
  }
  async prepare(
    action: AuthCenterClientMutationAction,
    userId: string,
    id: string,
    request?: TypedRequest,
    hydrate = true,
  ) {
    const actor = await this.reads.identity(userId, request),
      { principal } = actor.identity;
    if (!isCanonicalOAuthClientId(id)) throw iamAccountDenied();
    const target = await this.repository.target(actor.identity, id);
    if (
      !target ||
      target.id !== id ||
      target.userId !== userId ||
      target.status !== 1 ||
      !(target.updateTime instanceof Date) ||
      !Number.isFinite(target.updateTime.getTime())
    )
      throw iamAccountDenied();
    const resource = authCenterClientArn(principal.accountOwnerId, userId, id);
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
      rows[0].updateTime.getTime() !== target.updateTime.getTime()
    )
      throw iamAccountDenied();
    const guard: AuthCenterClientMutationGuard = {
      action,
      identity: actor.identity,
      target,
      users: { principal, targetUserId: userId, users, recheck },
    };
    return { existing: rows[0], guard };
  }
  revoke(guard: AuthCenterClientMutationGuard) {
    return this.mutations.revoke(guard);
  }
  update(data: AuthCenterClientUpdateInput, guard: AuthCenterClientMutationGuard) {
    return this.mutations.update(data, guard);
  }
}
