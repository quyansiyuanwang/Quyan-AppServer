import { performance } from "node:perf_hooks";
import { buildAcsResource, getIamActionDefinition, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { IamAccountUserRepository, iamAccountDenied as denied } from "@/store/users/iam-account-principal";
import { IamAccountUserAuthorizationService } from "./iam-account-user-authorization.service";
import type { TypedRequest } from "@/types/express";
/** Aggregates consume only authorized, persisted account users. No implicit account-wide grant is required. */
export class IamAccountUserCollectionService {
  private static instance: IamAccountUserCollectionService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: Pick<
      IamAccountUserRepository,
      "scanTargets" | "assertActor"
    > = IamAccountUserRepository.getInstance(),
    private readonly userIam = IamAccountUserAuthorizationService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new IamAccountUserCollectionService());
  }
  async authorizeCollection(action: string, request?: TypedRequest, userId?: string) {
    const identity = request && getIamPrincipal(request),
      definition = getIamActionDefinition(action);
    if (
      !request ||
      !identity ||
      identity.subjectUserId !== identity.principalUserId ||
      definition?.accessLevel !== "Read" ||
      !definition.resourceTypes.includes("quyan/user")
    )
      throw denied();
    const principal = { ...identity };
    await this.iam.loadPolicies(principal);
    await this.repository.assertActor(principal);
    if (userId !== undefined) {
      const { target } = await this.userIam.authorize(action, userId, request);
      return { principal, targets: [target] };
    }
    const targets: { id: string; updateTime: Date }[] = [],
      seen = new Set<string>();
    let after: string | undefined;
    while (true) {
      const page = await this.repository.scanTargets(principal, after);
      if (!page.length) break;
      if (
        page.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        page.some((row, i) => {
          const previous = i ? page[i - 1].id : after;
          return (
            !/^[A-Za-z0-9_-]{1,128}$/.test(row.id) ||
            seen.has(row.id) ||
            (previous && row.id <= previous) ||
            !(row.updateTime instanceof Date) ||
            !Number.isFinite(row.updateTime.getTime())
          );
        })
      )
        throw denied();
      const resources = page.map((row) =>
          buildAcsResource({
            service: "quyan",
            region: "*",
            accountId: principal.accountOwnerId,
            path: "user/" + row.id,
          }),
        ),
        start = performance.now(),
        results = await this.iam.authorizeMany({
          principal,
          action,
          resources,
          context: requestConditionContext(request, principal),
        });
      if (!Array.isArray(results) || results.length !== page.length || page.some((_, i) => !results[i])) throw denied();
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
      page.forEach((row, i) => {
        seen.add(row.id);
        if (results[i].decision === "Allow") targets.push({ id: row.id, updateTime: new Date(row.updateTime) });
      });
      after = page[page.length - 1].id;
      if (page.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    return { principal, targets };
  }
  async read<T>(
    action: string,
    request: TypedRequest | undefined,
    read: (ids: string[], principal: IamPrincipal) => Promise<T>,
    userId?: string,
  ): Promise<T> {
    const initial = await this.authorizeCollection(action, request, userId),
      result = await read(
        initial.targets.map((row) => row.id),
        { ...initial.principal },
      );
    for (let offset = 0; offset < initial.targets.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const chunk = initial.targets.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
        current = await this.userIam.authorizeMany(
          action,
          chunk.map((row) => row.id),
          request,
        );
      if (
        !current ||
        !Array.isArray(current.targets) ||
        current.principal.accountOwnerId !== initial.principal.accountOwnerId ||
        current.targets.length !== chunk.length ||
        Array.from(current.targets).some((row) => !row) ||
        current.targets.some(
          (row, i) => row.id !== chunk[i].id || row.updateTime.getTime() !== chunk[i].updateTime.getTime(),
        )
      )
        throw denied();
    }
    await this.iam.loadPolicies(initial.principal);
    await this.repository.assertActor(initial.principal);
    return result;
  }
}
