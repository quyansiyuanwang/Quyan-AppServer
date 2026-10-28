import { performance } from "node:perf_hooks";
import { buildAcsResource, getIamActionDefinition } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { IamAccountUserRepository, iamAccountDenied as denied } from "@/store/users/iam-account-principal";
import type { IamAccountUserMutationGuard } from "@/store/users/iam-account-user-mutation";
import type { TypedRequest } from "@/types/express";

/** Write boundary is separate from read authorization; fixed server Actions must be registered. */
export class IamAccountUserMutationService {
  private static instance: IamAccountUserMutationService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new IamAccountUserMutationService());
  }
  async prepare(action: string, userId: string, request?: TypedRequest): Promise<IamAccountUserMutationGuard> {
    const identity = request && getIamPrincipal(request),
      definition = getIamActionDefinition(action);
    if (
      !request ||
      !identity ||
      identity.subjectUserId !== identity.principalUserId ||
      !definition?.resourceTypes.includes("quyan/user") ||
      definition.accessLevel !== "Write" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(userId)
    )
      throw denied();
    const principal = { ...identity };
    await this.iam.loadPolicies(principal);
    const required = [...new Set([principal.subjectUserId, principal.accountOwnerId, userId])],
      rows = await this.repository.targets(principal, required);
    if (
      rows.length !== required.length ||
      required.some(
        (id) =>
          !rows.some(
            (row) => row.id === id && row.updateTime instanceof Date && Number.isFinite(row.updateTime.getTime()),
          ),
      )
    )
      throw denied();
    const users = rows.map((row) => ({ id: row.id, updateTime: new Date(row.updateTime) }));
    const resource = buildAcsResource({
      service: "quyan",
      region: "*",
      accountId: principal.accountOwnerId,
      path: "user/" + userId,
    });
    const recheck = async () => {
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
    };
    await recheck();
    return { principal, targetUserId: userId, users, recheck };
  }
}
