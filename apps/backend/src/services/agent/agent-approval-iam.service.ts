import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { AgentRepository, type AgentApprovalTarget } from "@/store/agent/agent.repository";
import { agentApprovalArn, isCanonicalAgentId } from "@/iam/resources/agent-resources";
import type { TypedRequest } from "@/types/express";
import { agentIamDenied as denied, trustedAgentIdentity, filterAgentResources } from "./agent-iam-authorization";
import { AgentTaskIamService } from "./agent-task-iam.service";
export class AgentApprovalIamService {
  private static instance: AgentApprovalIamService;
  private constructor(
    private readonly repository: Pick<
      AgentRepository,
      "scanApprovalTargets" | "readApprovalTargets" | "findApprovalTarget" | "decideApprovalTarget"
    > = AgentRepository.getInstance(),
    private readonly taskIam: Pick<AgentTaskIamService, "authorize"> = AgentTaskIamService.getInstance(),
    private readonly iam = IamAuthorizationService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new AgentApprovalIamService());
  }
  async list(userId: string, taskId: string, request?: TypedRequest) {
    const identity = trustedAgentIdentity(userId, request);
    const initial = await this.taskIam.authorize(taskId, userId, "quyan:agent:ListTaskApprovals", request);
    if (initial.principal.accountOwnerId !== identity.principal.accountOwnerId) throw denied();
    const filter = (action: string, resources: readonly string[]) =>
      filterAgentResources(this.iam, identity.request, identity.principal, action, resources);
    let after: AgentApprovalTarget | undefined;
    const seen = new Set<string>(),
      rows: Awaited<ReturnType<AgentRepository["readApprovalTargets"]>> = [];
    while (true) {
      const targets = await this.repository.scanApprovalTargets(
        initial.target,
        initial.principal.accountOwnerId,
        after,
      );
      if (!targets.length) break;
      if (
        targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        targets.some((target, index) => {
          const previous = index ? targets[index - 1] : after;
          if (
            target.taskId !== taskId ||
            !isCanonicalAgentId(target.id) ||
            !isCanonicalAgentId(target.stepId) ||
            seen.has(target.id) ||
            (previous &&
              (target.createTime < previous.createTime ||
                (target.createTime.getTime() === previous.createTime.getTime() && target.id <= previous.id)))
          )
            return true;
          seen.add(target.id);
          return false;
        })
      )
        throw denied();
      const resources = targets.map((target) =>
        agentApprovalArn(initial.principal.accountOwnerId, userId, taskId, target.id),
      );
      const allowed = new Set(await filter("quyan:agent:GetApproval", resources));
      const selected = targets.filter((_, index) => allowed.has(resources[index]));
      const records = await this.repository.readApprovalTargets(
        initial.target,
        initial.principal.accountOwnerId,
        selected,
      );
      const byId = new Map(records.map((row) => [row.id, row]));
      if (
        records.length !== selected.length ||
        byId.size !== selected.length ||
        selected.some((target) => {
          const row = byId.get(target.id);
          return (
            !row ||
            row.taskId !== taskId ||
            row.status !== "pending" ||
            row.expiresAt.getTime() !== target.expiresAt.getTime()
          );
        })
      )
        throw denied();
      rows.push(...selected.map((target) => byId.get(target.id)!));
      after = targets[targets.length - 1];
      if (targets.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    const final = await this.taskIam.authorize(taskId, userId, "quyan:agent:ListTaskApprovals", request);
    if (
      final.principal.accountOwnerId !== initial.principal.accountOwnerId ||
      final.target.workspaceId !== initial.target.workspaceId ||
      final.target.taskStatus !== initial.target.taskStatus
    )
      throw denied();
    for (let offset = 0; offset < rows.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const resources = rows
        .slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
        .map((row) => agentApprovalArn(initial.principal.accountOwnerId, userId, taskId, row.id));
      if ((await filter("quyan:agent:GetApproval", resources)).length !== resources.length) throw denied();
    }
    if (rows.some((row) => row.expiresAt.getTime() <= Date.now())) throw denied();
    return rows;
  }
  async decide(
    userId: string,
    taskId: string,
    approvalId: string,
    decision: "approved" | "rejected",
    request?: TypedRequest,
  ) {
    const identity = trustedAgentIdentity(userId, request);
    if (!isCanonicalAgentId(approvalId) || !["approved", "rejected"].includes(decision)) throw denied();
    const initial = await this.taskIam.authorize(taskId, userId, "quyan:agent:DecideApproval", request);
    if (initial.principal.accountOwnerId !== identity.principal.accountOwnerId) throw denied();
    const target = await this.repository.findApprovalTarget(
      approvalId,
      initial.target,
      initial.principal.accountOwnerId,
    );
    if (!target || target.id !== approvalId || target.taskId !== taskId) throw denied();
    const resource = agentApprovalArn(initial.principal.accountOwnerId, userId, taskId, approvalId);
    if (
      (
        await filterAgentResources(this.iam, identity.request, identity.principal, "quyan:agent:DecideApproval", [
          resource,
        ])
      ).length !== 1
    )
      throw denied();
    const final = await this.taskIam.authorize(taskId, userId, "quyan:agent:DecideApproval", request);
    if (
      final.principal.accountOwnerId !== initial.principal.accountOwnerId ||
      final.target.workspaceId !== initial.target.workspaceId ||
      final.target.updateTime.getTime() !== initial.target.updateTime.getTime()
    )
      throw denied();
    if (
      (
        await filterAgentResources(this.iam, identity.request, identity.principal, "quyan:agent:DecideApproval", [
          resource,
        ])
      ).length !== 1
    )
      throw denied();
    await this.repository.decideApprovalTarget(final.target, final.principal.accountOwnerId, target, decision);
  }
}
