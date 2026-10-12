import { performance } from "node:perf_hooks";
import { buildAcsResource, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { jsonEndpointArn, isCanonicalJsonEndpointId } from "@/iam/resources/json-endpoint-resources";
import {
  JsonEndpointManagementRepository,
  jsonEndpointDenied,
} from "@/store/system/json-endpoint-management.repository";
import type { JsonEndpointManagementStore, JsonEndpointTarget } from "@/store/system/json-endpoint-management.store";
import type { TypedRequest } from "@/types/express";
import { jsonEndpointDto } from "./json-endpoint-view";
export class JsonEndpointIamService {
  private static instance: JsonEndpointIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly repository: JsonEndpointManagementStore = JsonEndpointManagementRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new JsonEndpointIamService());
  }
  private async actor(userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      principal.subjectUserId !== userId ||
      principal.principalUserId !== userId ||
      !isCanonicalJsonEndpointId(userId)
    )
      throw jsonEndpointDenied();
    await this.iam.loadPolicies(principal);
    await this.repository.assertActor(principal);
    return { request, principal };
  }
  private async allowed(request: TypedRequest, principal: IamPrincipal, action: string, resources: readonly string[]) {
    if (!resources.length) return [];
    const start = performance.now(),
      results = await this.iam.authorizeMany({
        principal,
        action,
        resources: [...resources],
        context: requestConditionContext(request, principal),
      });
    if (!Array.isArray(results) || results.length !== resources.length || resources.some((_, index) => !results[index]))
      throw jsonEndpointDenied();
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
      });
    });
    return resources.filter((_, index) => results[index].decision === "Allow");
  }
  private async collection<T extends JsonEndpointTarget, V extends { id: string }>(
    identity: { principal: IamPrincipal; request: TypedRequest },
    action: string,
    scan: (after?: T) => Promise<T[]>,
    hydrate: (targets: T[]) => Promise<V[]>,
    resource: (target: T | V) => string,
  ) {
    let after: T | undefined;
    const seen = new Set<string>(),
      rows: V[] = [];
    while (true) {
      const targets = await scan(after);
      if (!targets.length) break;
      if (
        targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        targets.some((t, index) => {
          const previous = index ? targets[index - 1] : after;
          return (
            !isCanonicalJsonEndpointId(t.id) ||
            !isCanonicalJsonEndpointId(t.userId) ||
            seen.has(t.id) ||
            (previous &&
              (t.createTime > previous.createTime ||
                (t.createTime.getTime() === previous.createTime.getTime() && t.id >= previous.id)))
          );
        })
      )
        throw jsonEndpointDenied();
      targets.forEach((t) => seen.add(t.id));
      const allowed = new Set(await this.allowed(identity.request, identity.principal, action, targets.map(resource)));
      const selected = targets.filter((t) => allowed.has(resource(t))),
        views = await hydrate(selected);
      if (views.some((v) => !selected.some((t) => t.id === v.id && resource(t) === resource(v))))
        throw jsonEndpointDenied();
      rows.push(...views);
      after = targets[targets.length - 1];
      if (targets.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    const final: V[] = [];
    for (let index = 0; index < rows.length; index += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const chunk = rows.slice(index, index + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      const allowed = new Set(await this.allowed(identity.request, identity.principal, action, chunk.map(resource)));
      final.push(...chunk.filter((v) => allowed.has(resource(v))));
    }
    return final;
  }
  async list(userId: string, ownerUserId?: string, request?: TypedRequest) {
    const identity = await this.actor(userId, request);
    if (ownerUserId !== undefined) {
      if (!isCanonicalJsonEndpointId(ownerUserId)) throw jsonEndpointDenied();
      await this.repository.assertOwner(identity.principal, ownerUserId);
    }
    const rows = await this.collection(
      identity,
      "quyan:json_endpoint:ListEndpoints",
      (after) => this.repository.scan(identity.principal, ownerUserId, after),
      (targets) => this.repository.hydrate(identity.principal, targets),
      (target) => jsonEndpointArn(identity.principal.accountOwnerId, target.userId, target.id),
    );
    return rows.map((row) => jsonEndpointDto(row, row.ownerUsername));
  }
  async owners(userId: string, request?: TypedRequest) {
    const identity = await this.actor(userId, request);
    return (
      await this.collection(
        identity,
        "quyan:json_endpoint:ListEndpointOwners",
        (after) => this.repository.scanOwners(identity.principal, after),
        (targets) => this.repository.hydrateOwners(identity.principal, targets),
        (target) =>
          buildAcsResource({
            service: "quyan",
            region: "*",
            accountId: identity.principal.accountOwnerId,
            path: "user/" + target.id,
          }),
      )
    ).sort((a, b) => a.username.localeCompare(b.username));
  }
  async get(userId: string, id: string, request?: TypedRequest) {
    const { request: trusted, principal } = await this.actor(userId, request);
    if (!isCanonicalJsonEndpointId(id)) throw jsonEndpointDenied();
    const target = await this.repository.target(principal, id);
    if (!target || target.id !== id || !isCanonicalJsonEndpointId(target.userId)) throw jsonEndpointDenied();
    const resource = jsonEndpointArn(principal.accountOwnerId, target.userId, target.id);
    if ((await this.allowed(trusted, principal, "quyan:json_endpoint:GetEndpoint", [resource])).length !== 1)
      throw jsonEndpointDenied();
    const rows = await this.repository.hydrate(principal, [target]);
    if (rows.length !== 1 || rows[0].id !== id || rows[0].userId !== target.userId) throw jsonEndpointDenied();
    if ((await this.allowed(trusted, principal, "quyan:json_endpoint:GetEndpoint", [resource])).length !== 1)
      throw jsonEndpointDenied();
    return jsonEndpointDto(rows[0], rows[0].ownerUsername);
  }
}
