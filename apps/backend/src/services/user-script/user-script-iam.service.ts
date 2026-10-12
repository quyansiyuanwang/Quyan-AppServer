import { env } from "@/config/env";
import { performance } from "node:perf_hooks";
import type { IamPrincipal } from "@quyan/shared";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import { isCanonicalScriptId, userScriptArn } from "@/iam/resources/script-resources";
import { UserScriptRepository, type UserScriptTarget } from "@/store/user-script.repository";
import type { TypedRequest } from "@/types/express";
import { ForbiddenError } from "@/util/errors";

const denied = () =>
  new ForbiddenError("Script resource authorization unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });

export class UserScriptIamService {
  private static instance: UserScriptIamService;
  private constructor(
    private readonly repository: Pick<
      UserScriptRepository,
      "scanTargets" | "readTargets" | "findTarget"
    > = UserScriptRepository.getInstance(),
    private readonly iam = IamAuthorizationService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new UserScriptIamService());
  }

  public identity(userId: string, request?: TypedRequest): { request: TypedRequest; principal: IamPrincipal } {
    const principal = request && getIamPrincipal(request);
    if (!request || !principal || principal.subjectUserId !== userId || !isCanonicalScriptId(userId)) throw denied();
    return { request, principal };
  }

  public async filter(request: TypedRequest, principal: IamPrincipal, action: string, resources: readonly string[]) {
    if (!resources.length) return [];
    const start = performance.now();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources: [...resources],
      context: requestConditionContext(request, principal),
    });
    if (results.length !== resources.length || resources.some((_, index) => !results[index])) throw denied();
    results.forEach((result, index) => {
      (request.iamDecisions ??= []).push({ ...result, action, resource: resources[index] });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource: resources[index],
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
        ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
        batchSize: resources.length,
        batchIndex: index,
      });
    });
    return resources.filter((_, index) => results[index].decision === "Allow");
  }

  public async authorizeCreate(userId: string, request?: TypedRequest) {
    const identity = this.identity(userId, request);
    const resource = await iamAuthenticatedUserResourceResolver(identity);
    if (
      typeof resource !== "string" ||
      (await this.filter(identity.request, identity.principal, "quyan:script:CreateScript", [resource])).length !== 1
    )
      throw denied();
    return identity.principal;
  }

  public async authorizeTarget(id: string, userId: string, action: string, request?: TypedRequest) {
    const { request: trusted, principal } = this.identity(userId, request);
    if (!isCanonicalScriptId(id)) throw denied();
    const target = await this.repository.findTarget(id, userId, principal.accountOwnerId);
    if (!target || target.id !== id || target.userId !== userId) throw denied();
    const resource = userScriptArn(principal.accountOwnerId, userId, id);
    if ((await this.filter(trusted, principal, action, [resource])).length !== 1) throw denied();
    return { target, principal };
  }

  public async list(userId: string, request?: TypedRequest) {
    const { request: trusted, principal } = this.identity(userId, request);
    await this.iam.loadPolicies(principal);
    let after: UserScriptTarget | undefined;
    const rows = [];
    while (true) {
      const targets = await this.repository.scanTargets(userId, principal.accountOwnerId, after);
      if (!targets.length) break;
      if (
        targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        targets.some((target, index) => {
          const previous = index ? targets[index - 1] : after;
          return (
            target.userId !== userId ||
            !isCanonicalScriptId(target.id) ||
            (previous &&
              (target.createTime > previous.createTime ||
                (target.createTime.getTime() === previous.createTime.getTime() && target.id >= previous.id)))
          );
        })
      )
        throw denied();
      const resources = targets.map((target) => userScriptArn(principal.accountOwnerId, userId, target.id));
      const allowed = new Set(await this.filter(trusted, principal, "quyan:script:ListScripts", resources));
      const selected = targets.filter((_, index) => allowed.has(resources[index]));
      if (
        (
          await this.filter(
            trusted,
            principal,
            "quyan:script:ListScripts",
            selected.map((target) => userScriptArn(principal.accountOwnerId, userId, target.id)),
          )
        ).length !== selected.length
      )
        throw denied();
      const hydrated = await this.repository.readTargets(userId, principal.accountOwnerId, selected);
      const snapshots = new Map(selected.map((target) => [target.id, target]));
      if (
        hydrated.length !== selected.length ||
        new Set(hydrated.map((row) => row.id)).size !== selected.length ||
        hydrated.some((row) => {
          const snapshot = snapshots.get(row.id);
          return (
            !snapshot ||
            row.userId !== userId ||
            row.status !== 1 ||
            row.updateTime.getTime() !== snapshot.updateTime.getTime()
          );
        })
      )
        throw denied();
      rows.push(...hydrated);
      after = targets[targets.length - 1];
      if (targets.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    // Recheck earlier chunks after the scan: revocation during later pages must not expose prior bodies.
    for (let offset = 0; offset < rows.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const resources = rows
        .slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
        .map((row) => userScriptArn(principal.accountOwnerId, userId, row.id));
      if ((await this.filter(trusted, principal, "quyan:script:ListScripts", resources)).length !== resources.length)
        throw denied();
    }
    await this.iam.loadPolicies(principal);
    return rows;
  }
}
