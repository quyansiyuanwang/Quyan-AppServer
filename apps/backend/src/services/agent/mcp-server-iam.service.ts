import { performance } from "node:perf_hooks";
import type { IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import { mcpServerArn, isCanonicalMcpId } from "@/iam/resources/mcp-resources";
import { AgentRepository, type McpServerTarget, type PublicMcpServer } from "@/store/agent/agent.repository";
import type { TypedRequest } from "@/types/express";
import { ForbiddenError } from "@/util/errors";
const denied = () =>
  new ForbiddenError("MCP server authorization unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });

export class McpServerIamService {
  private static instance: McpServerIamService;
  private constructor(
    private readonly repository: Pick<
      AgentRepository,
      "scanMcpTargets" | "readMcpTargets"
    > = AgentRepository.getInstance(),
    private readonly iam = IamAuthorizationService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new McpServerIamService());
  }
  private identity(userId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (!request || !principal || principal.subjectUserId !== userId || !isCanonicalMcpId(userId)) throw denied();
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
      (await this.filter(identity.request, identity.principal, "quyan:mcp:CreateServer", [resource])).length !== 1
    )
      throw denied();
    return identity.principal;
  }
  async list(userId: string, request?: TypedRequest): Promise<PublicMcpServer[]> {
    const { request: trusted, principal } = this.identity(userId, request);
    await this.iam.loadPolicies(principal);
    let after: McpServerTarget | undefined;
    const seen = new Set<string>(),
      rows: PublicMcpServer[] = [];
    while (true) {
      const targets = await this.repository.scanMcpTargets(userId, principal.accountOwnerId, after);
      if (!targets.length) break;
      // Name ordering follows database collation, not JavaScript lexical comparison.
      if (
        targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        targets.some((target) => {
          if (target.userId !== userId || !isCanonicalMcpId(target.id) || seen.has(target.id)) return true;
          seen.add(target.id);
          return false;
        })
      )
        throw denied();
      const resources = targets.map((target) => mcpServerArn(principal.accountOwnerId, userId, target.id));
      const allowed = new Set(await this.filter(trusted, principal, "quyan:mcp:ListServers", resources));
      const selected = targets.filter((_, index) => allowed.has(resources[index]));
      const selectedResources = selected.map((target) => mcpServerArn(principal.accountOwnerId, userId, target.id));
      if (
        (await this.filter(trusted, principal, "quyan:mcp:ListServers", selectedResources)).length !== selected.length
      )
        throw denied();
      const records = await this.repository.readMcpTargets(userId, principal.accountOwnerId, selected);
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
            row.name !== target.name ||
            row.updateTime.getTime() !== target.updateTime.getTime() ||
            (row.credential && Object.keys(row.credential).some((key) => key !== "id"))
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
        .map((row) => mcpServerArn(principal.accountOwnerId, userId, row.id));
      if ((await this.filter(trusted, principal, "quyan:mcp:ListServers", resources)).length !== resources.length)
        throw denied();
    }
    await this.iam.loadPolicies(principal);
    return rows;
  }
}
