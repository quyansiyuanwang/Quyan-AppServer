import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { AgentRepository } from "@/store/agent/agent.repository";
import { agentTaskArn, isCanonicalAgentId } from "@/iam/resources/agent-resources";
import type { TypedRequest } from "@/types/express";
import { agentIamDenied as denied, trustedAgentIdentity, filterAgentResources } from "./agent-iam-authorization";
import { AGENT_TASK_LIMITS } from "./agent-task.policy";
import { BadRequestError } from "@/util/errors";
export class AgentTaskIamService {
  private static instance: AgentTaskIamService;
  private constructor(
    private readonly repository: Pick<
      AgentRepository,
      "findTaskTarget" | "listTaskEvents" | "cancelTaskTarget"
    > = AgentRepository.getInstance(),
    private readonly iam = IamAuthorizationService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new AgentTaskIamService());
  }
  async authorize(
    id: string,
    userId: string,
    action:
      | "quyan:agent:GetTaskEvents"
      | "quyan:agent:CancelTask"
      | "quyan:agent:ListTaskApprovals"
      | "quyan:agent:DecideApproval",
    request?: TypedRequest,
  ) {
    const identity = trustedAgentIdentity(userId, request);
    if (!isCanonicalAgentId(id)) throw denied();
    const target = await this.repository.findTaskTarget(id, userId, identity.principal.accountOwnerId);
    if (!target || target.id !== id || target.userId !== userId || !isCanonicalAgentId(target.workspaceId))
      throw denied();
    if (
      (
        await filterAgentResources(this.iam, identity.request, identity.principal, action, [
          agentTaskArn(identity.principal.accountOwnerId, userId, id),
        ])
      ).length !== 1
    )
      throw denied();
    return { target, principal: identity.principal };
  }
  async listEvents(userId: string, id: string, after: number, request?: TypedRequest) {
    if (!Number.isSafeInteger(after) || after < 0)
      throw new BadRequestError("Invalid Agent event cursor", undefined, { messageKey: "agent.invalidEventCursor" });
    if (request?.iamDecisions)
      request.iamDecisions = request.iamDecisions.filter((decision) => decision.action !== "quyan:agent:GetTaskEvents");
    const identity = await this.authorize(id, userId, "quyan:agent:GetTaskEvents", request);
    const rows = await this.repository.listTaskEvents(identity.target, identity.principal.accountOwnerId, after);
    if (
      rows.length > AGENT_TASK_LIMITS.eventsPerPage ||
      rows.some(
        (row, index) =>
          row.taskId !== id ||
          !Number.isSafeInteger(row.sequence) ||
          row.sequence <= (index ? rows[index - 1].sequence : after),
      )
    )
      throw denied();
    const latest = await this.authorize(id, userId, "quyan:agent:GetTaskEvents", request);
    if (
      latest.principal.accountOwnerId !== identity.principal.accountOwnerId ||
      latest.target.workspaceId !== identity.target.workspaceId
    )
      throw denied();
    return rows;
  }
  async cancel(userId: string, id: string, request?: TypedRequest) {
    const initial = await this.authorize(id, userId, "quyan:agent:CancelTask", request);
    const final = await this.authorize(id, userId, "quyan:agent:CancelTask", request);
    if (
      initial.principal.accountOwnerId !== final.principal.accountOwnerId ||
      initial.target.workspaceId !== final.target.workspaceId ||
      initial.target.updateTime.getTime() !== final.target.updateTime.getTime()
    )
      throw denied();
    await this.repository.cancelTaskTarget(final.target, final.principal.accountOwnerId);
  }
}
