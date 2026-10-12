import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { agentMachineArn, agentWorkspaceArn, isCanonicalAgentId } from "@/iam/resources/agent-resources";
import { AgentRepository, type AgentWorkspaceTarget, type PublicAgentWorkspace } from "@/store/agent/agent.repository";
import type { TypedRequest } from "@/types/express";
import { agentIamDenied as denied, trustedAgentIdentity, filterAgentResources } from "./agent-iam-authorization";

export class AgentWorkspaceIamService {
  private static instance: AgentWorkspaceIamService;
  private constructor(
    private readonly repository: Pick<
      AgentRepository,
      "scanWorkspaceTargets" | "readWorkspaceTargets" | "readMachineSummaries" | "findMachineTarget"
    > = AgentRepository.getInstance(),
    private readonly iam = IamAuthorizationService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new AgentWorkspaceIamService());
  }

  async authorizeCreate(userId: string, machineId?: string, request?: TypedRequest) {
    const identity = trustedAgentIdentity(userId, request);
    const resource = await iamAuthenticatedUserResourceResolver(identity);
    if (
      typeof resource !== "string" ||
      (
        await filterAgentResources(this.iam, identity.request, identity.principal, "quyan:agent:CreateWorkspace", [
          resource,
        ])
      ).length !== 1
    )
      throw denied();
    if (!machineId) return { principal: identity.principal };
    if (!isCanonicalAgentId(machineId)) throw denied();
    const machineTarget = await this.repository.findMachineTarget(machineId, userId, identity.principal.accountOwnerId);
    if (!machineTarget || machineTarget.id !== machineId || machineTarget.userId !== userId) throw denied();
    const machineResource = agentMachineArn(identity.principal.accountOwnerId, userId, machineId);
    if (
      (
        await filterAgentResources(this.iam, identity.request, identity.principal, "quyan:agent:UseMachine", [
          machineResource,
        ])
      ).length !== 1
    )
      throw denied();
    return { principal: identity.principal, machineTarget };
  }

  async list(userId: string, request?: TypedRequest): Promise<PublicAgentWorkspace[]> {
    const { request: trusted, principal } = trustedAgentIdentity(userId, request);
    const filter = (action: string, resources: readonly string[]) =>
      filterAgentResources(this.iam, trusted, principal, action, resources);
    await this.iam.loadPolicies(principal);
    let after: AgentWorkspaceTarget | undefined;
    const seen = new Set<string>(),
      rows: PublicAgentWorkspace[] = [];
    while (true) {
      const targets = await this.repository.scanWorkspaceTargets(userId, principal.accountOwnerId, after);
      if (!targets.length) break;
      if (
        targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        targets.some((target, index) => {
          const previous = index ? targets[index - 1] : after;
          if (
            target.userId !== userId ||
            !isCanonicalAgentId(target.id) ||
            (target.machineId !== null && !isCanonicalAgentId(target.machineId)) ||
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
      const resources = targets.map((target) => agentWorkspaceArn(principal.accountOwnerId, userId, target.id));
      const allowed = new Set(await filter("quyan:agent:ListWorkspaces", resources));
      const selected = targets.filter((_, index) => allowed.has(resources[index]));
      const selectedResources = selected.map((target) =>
        agentWorkspaceArn(principal.accountOwnerId, userId, target.id),
      );
      if ((await filter("quyan:agent:ListWorkspaces", selectedResources)).length !== selected.length) throw denied();
      const records = await this.repository.readWorkspaceTargets(userId, principal.accountOwnerId, selected);
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
            row.machineId !== target.machineId ||
            row.updateTime.getTime() !== target.updateTime.getTime() ||
            "machine" in row ||
            "runtimeHandle" in row ||
            "registrationHash" in row
          );
        })
      )
        throw denied();
      rows.push(...selected.map((target) => byId.get(target.id)!));
      after = targets[targets.length - 1];
      if (targets.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    // Machine labels are a separate resource read. Denied labels are never hydrated.
    const machineIds = [...new Set(rows.flatMap((row) => (row.machineId ? [row.machineId] : [])))];
    const summaries = new Map<string, NonNullable<PublicAgentWorkspace["machine"]>>();
    const shownMachineResources: string[] = [];
    for (let offset = 0; offset < machineIds.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const ids = machineIds.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      const resources = ids.map((id) => agentMachineArn(principal.accountOwnerId, userId, id));
      const allowed = new Set(await filter("quyan:agent:ListMachines", resources));
      const selectedIds = ids.filter((_, index) => allowed.has(resources[index]));
      const selectedResources = selectedIds.map((id) => agentMachineArn(principal.accountOwnerId, userId, id));
      if ((await filter("quyan:agent:ListMachines", selectedResources)).length !== selectedIds.length) throw denied();
      const records = await this.repository.readMachineSummaries(userId, principal.accountOwnerId, selectedIds);
      for (const row of records) {
        if (
          !selectedIds.includes(row.id) ||
          row.userId !== userId ||
          summaries.has(row.id) ||
          "registrationHash" in row
        )
          throw denied();
        summaries.set(row.id, row);
        shownMachineResources.push(agentMachineArn(principal.accountOwnerId, userId, row.id));
      }
    }
    for (let offset = 0; offset < rows.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const resources = rows
        .slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
        .map((row) => agentWorkspaceArn(principal.accountOwnerId, userId, row.id));
      if ((await filter("quyan:agent:ListWorkspaces", resources)).length !== resources.length) throw denied();
    }
    for (
      let offset = 0;
      offset < shownMachineResources.length;
      offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest
    ) {
      const resources = shownMachineResources.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      if ((await filter("quyan:agent:ListMachines", resources)).length !== resources.length) throw denied();
    }
    await this.iam.loadPolicies(principal);
    return rows.map((row) => ({ ...row, machine: row.machineId ? (summaries.get(row.machineId) ?? null) : null }));
  }
}
