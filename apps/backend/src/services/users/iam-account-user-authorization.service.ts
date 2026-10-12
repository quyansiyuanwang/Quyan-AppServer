import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
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
    private readonly repository: Pick<
      IamAccountUserRepository,
      "target" | "targets"
    > = IamAccountUserRepository.getInstance(),
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
  async authorizeMany(action: string, userIds: readonly string[], request?: TypedRequest) {
    const principal = request && getIamPrincipal(request),
      definition = getIamActionDefinition(action);
    if (
      !request ||
      !principal ||
      principal.subjectUserId !== principal.principalUserId ||
      !definition?.resourceTypes.includes("quyan/user") ||
      definition.accessLevel !== "Read" ||
      !Array.isArray(userIds) ||
      !userIds.length ||
      userIds.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      Array.from(userIds).some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
    )
      throw denied();
    await this.iam.loadPolicies(principal);
    const ids = [...new Set(userIds)],
      targets = await this.repository.targets(principal, ids);
    if (
      targets.length !== ids.length ||
      new Set(targets.map((t) => t.id)).size !== ids.length ||
      targets.some((t) => !ids.includes(t.id))
    )
      throw denied();
    const byId = new Map(targets.map((t) => [t.id, t])),
      ordered = ids.map((id) => byId.get(id)!);
    const resources = ordered.map((t) =>
      buildAcsResource({ service: "quyan", region: "*", accountId: principal.accountOwnerId, path: "user/" + t.id }),
    );
    const start = performance.now(),
      results = await this.iam.authorizeMany({
        principal,
        action,
        resources,
        context: requestConditionContext(request, principal),
      });
    if (!Array.isArray(results) || results.length !== resources.length || resources.some((_, i) => !results[i]))
      throw denied();
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
    if (results.some((result) => result.decision !== "Allow")) throw denied();
    return { principal, targets: ordered };
  }
  async readMany<T>(
    action: string,
    userIds: readonly string[],
    request: TypedRequest | undefined,
    read: (trustedUserIds: string[]) => Promise<T>,
  ) {
    const initial = await this.authorizeMany(action, userIds, request),
      ids = initial.targets.map((t) => t.id),
      result = await read([...ids]),
      current = await this.authorizeMany(action, ids, request);
    if (
      current.principal.accountOwnerId !== initial.principal.accountOwnerId ||
      current.targets.some(
        (t, i) => t.id !== initial.targets[i].id || t.updateTime.getTime() !== initial.targets[i].updateTime.getTime(),
      )
    )
      throw denied();
    return result;
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
