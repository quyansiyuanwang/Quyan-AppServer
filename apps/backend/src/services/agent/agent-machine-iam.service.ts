import { performance } from "node:perf_hooks";
import type { IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import { agentMachineArn, isCanonicalAgentId } from "@/iam/resources/agent-resources";
import { AgentRepository, type AgentMachineTarget, type PublicAgentMachine } from "@/store/agent/agent.repository";
import type { TypedRequest } from "@/types/express";
import { ForbiddenError } from "@/util/errors";
const denied = () =>
  new ForbiddenError("Agent machine authorization unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });

export class AgentMachineIamService {
  private static instance: AgentMachineIamService;
  private constructor(
    private readonly repository: Pick<
      AgentRepository,
      "scanMachineTargets" | "readMachineTargets" | "findMachineTarget"
    > = AgentRepository.getInstance(),
    private readonly iam = IamAuthorizationService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new AgentMachineIamService());
  }
  private identity(userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (!request || !principal || principal.subjectUserId !== userId || !isCanonicalAgentId(userId)) throw denied();
    return { request, principal };
  }
  private async filter(request: TypedRequest, principal: IamPrincipal, action: string, resources: readonly string[]) {
    if (!resources.length) return [];
    const start = performance.now(),
      results = await this.iam.authorizeMany({
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
  async authorizeCreate(userId: string, request?: TypedRequest) {
    const identity = this.identity(userId, request),
      resource = await iamAuthenticatedUserResourceResolver(identity);
    if (
      typeof resource !== "string" ||
      (await this.filter(identity.request, identity.principal, "quyan:agent:CreateMachine", [resource])).length !== 1
    )
      throw denied();
    return identity.principal;
  }
  async authorizeTarget(id: string, userId: string, request?: TypedRequest) {
    const identity = this.identity(userId, request);
    if (!isCanonicalAgentId(id)) throw denied();
    const target = await this.repository.findMachineTarget(id, userId, identity.principal.accountOwnerId);
    if (!target || target.id !== id || target.userId !== userId) throw denied();
    const resource = agentMachineArn(identity.principal.accountOwnerId, userId, id);
    if ((await this.filter(identity.request, identity.principal, "quyan:agent:DeleteMachine", [resource])).length !== 1)
      throw denied();
    return { target, principal: identity.principal };
  }
  async list(userId: string, request?: TypedRequest): Promise<PublicAgentMachine[]> {
    const { request: trusted, principal } = this.identity(userId, request);
    await this.iam.loadPolicies(principal);
    let after: AgentMachineTarget | undefined;
    const seen = new Set<string>(),
      rows: PublicAgentMachine[] = [];
    while (true) {
      const targets = await this.repository.scanMachineTargets(userId, principal.accountOwnerId, after);
      if (!targets.length) break;
      if (
        targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        targets.some((target, index) => {
          const previous = index ? targets[index - 1] : after;
          if (
            target.userId !== userId ||
            !isCanonicalAgentId(target.id) ||
            seen.has(target.id) ||
            (previous &&
              (target.createTime > previous.createTime ||
                (target.createTime.getTime() === previous.createTime.getTime() && target.id >= previous.id)))
          )
            return true;
          seen.add(target.id);
          return false;
        })
      )
        throw denied();
      const resources = targets.map((target) => agentMachineArn(principal.accountOwnerId, userId, target.id));
      const allowed = new Set(await this.filter(trusted, principal, "quyan:agent:ListMachines", resources));
      const selected = targets.filter((_, index) => allowed.has(resources[index]));
      const selectedResources = selected.map((target) => agentMachineArn(principal.accountOwnerId, userId, target.id));
      if (
        (await this.filter(trusted, principal, "quyan:agent:ListMachines", selectedResources)).length !==
        selected.length
      )
        throw denied();
      const records = await this.repository.readMachineTargets(userId, principal.accountOwnerId, selected);
      const byId = new Map(records.map((row) => [row.id, row]));
      if (
        records.length !== selected.length ||
        byId.size !== selected.length ||
        selected.some((target) => {
          const row = byId.get(target.id);
          return (
            !row ||
            row.userId !== userId ||
            row.status !== 1 ||
            row.updateTime.getTime() !== target.updateTime.getTime() ||
            "registrationHash" in row ||
            "registrationToken" in row
          );
        })
      )
        throw denied();
      rows.push(...selected.map((target) => byId.get(target.id)!));
      after = targets[targets.length - 1];
      if (targets.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    for (let offset = 0; offset < rows.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const resources = rows
        .slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
        .map((row) => agentMachineArn(principal.accountOwnerId, userId, row.id));
      if ((await this.filter(trusted, principal, "quyan:agent:ListMachines", resources)).length !== resources.length)
        throw denied();
    }
    await this.iam.loadPolicies(principal);
    return rows;
  }
}
