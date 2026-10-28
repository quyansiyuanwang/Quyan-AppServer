import { performance } from "node:perf_hooks";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { supportConfigArn } from "@/iam/resources/support-config-resource";
import { IamAccountUserRepository, iamAccountDenied } from "@/store/users/iam-account-principal";
import { SupportConfigRepository } from "@/store/support/support-config.repository";
import type { SupportConfigAction, SupportConfigGuard, SupportConfigStore } from "@/store/support/support-config.store";
import type { TypedRequest } from "@/types/express";
export class SupportConfigIamService {
  private static instance: SupportConfigIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: SupportConfigStore = SupportConfigRepository.getInstance(),
    private readonly users = IamAccountUserRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new SupportConfigIamService());
  }
  async prepare(action: SupportConfigAction, userId: string, request?: TypedRequest) {
    const identity = request && getIamPrincipal(request);
    if (
      !request ||
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== userId ||
      identity.principalUserId !== userId ||
      !["quyan:support:GetConfig", "quyan:support:UpdateConfig"].includes(action)
    )
      throw iamAccountDenied();
    const principal = { ...identity };
    await this.iam.loadPolicies(principal);
    const group = await this.repository.groupSnapshot(principal),
      resource = supportConfigArn();
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
    const configs = await this.repository.snapshot(principal);
    const guard: SupportConfigGuard = {
      action,
      group,
      users: { principal, targetUserId: userId, users, recheck },
      configs,
    };
    return guard;
  }
  recheck(guard: SupportConfigGuard) {
    return this.repository.recheck(guard);
  }
  update(updates: Readonly<Record<string, string>>, guard: SupportConfigGuard) {
    return this.repository.update(updates, guard);
  }
}
