import { performance } from "node:perf_hooks";
import { buildAcsResource, getIamActionDefinition } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { IamAccountUserRepository, iamAccountDenied as denied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
/** Reusable read boundary for real users; callers supply a fixed registered endpoint Action. */
export class IamAccountUserAuthorizationService {
  private static instance: IamAccountUserAuthorizationService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: Pick<IamAccountUserRepository, "target"> = IamAccountUserRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new IamAccountUserAuthorizationService());
  }
  async authorize(action: string, userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request),
      definition = getIamActionDefinition(action);
    if (
      !request ||
      !principal ||
      principal.subjectUserId !== principal.principalUserId ||
      !definition?.resourceTypes.includes("quyan/user") ||
      definition.accessLevel !== "Read"
    )
      throw denied();
    await this.iam.loadPolicies(principal);
    const target = await this.repository.target(principal, userId);
    if (!target || target.id !== userId) throw denied();
    const resource = buildAcsResource({
      service: "quyan",
      region: "*",
      accountId: principal.accountOwnerId,
      path: "user/" + target.id,
    });
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
    return { principal, target };
  }
  async read<T>(
    action: string,
    userId: string,
    request: TypedRequest | undefined,
    read: (trustedUserId: string) => Promise<T>,
  ) {
    const initial = await this.authorize(action, userId, request),
      result = await read(initial.target.id),
      current = await this.authorize(action, initial.target.id, request);
    if (
      current.principal.accountOwnerId !== initial.principal.accountOwnerId ||
      current.target.id !== initial.target.id ||
      current.target.updateTime.getTime() !== initial.target.updateTime.getTime()
    )
      throw denied();
    return result;
  }
}
