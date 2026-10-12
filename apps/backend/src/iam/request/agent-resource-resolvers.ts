import { AgentRepository } from "@/store/agent/agent.repository";
import {
  agentMachineArn,
  agentWorkspaceArn,
  agentTaskArn,
  agentApprovalArn,
  isCanonicalAgentId,
} from "../resources/agent-resources";
import type { ResourceResolver } from "./resource-resolvers";

/** Only trusted account and owner metadata enters a machine ARN; never the registration token. */
export const agentMachineResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.machineId;
  if (!isCanonicalAgentId(id)) return undefined;
  const target = await AgentRepository.getInstance().findMachineTarget(
    id,
    principal.subjectUserId,
    principal.accountOwnerId,
  );
  if (!target || target.id !== id || target.userId !== principal.subjectUserId) return undefined;
  return agentMachineArn(principal.accountOwnerId, target.userId, target.id);
};

export const agentWorkspaceResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.workspaceId;
  if (!isCanonicalAgentId(id)) return undefined;
  const target = await AgentRepository.getInstance().findWorkspaceTarget(
    id,
    principal.subjectUserId,
    principal.accountOwnerId,
  );
  if (!target || target.id !== id || target.userId !== principal.subjectUserId) return undefined;
  return agentWorkspaceArn(principal.accountOwnerId, target.userId, target.id);
};

export const agentTaskResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.taskId;
  if (!isCanonicalAgentId(id)) return undefined;
  const target = await AgentRepository.getInstance().findTaskTarget(
    id,
    principal.subjectUserId,
    principal.accountOwnerId,
  );
  if (!target || target.id !== id || target.userId !== principal.subjectUserId) return undefined;
  return agentTaskArn(principal.accountOwnerId, target.userId, target.id);
};

export const agentApprovalResourcesResolver: import("./resource-resolvers").BatchResourceResolver = async ({
  request,
  principal,
}) => {
  const taskId = request.params.taskId,
    approvalId = request.params.approvalId;
  if (!isCanonicalAgentId(taskId) || !isCanonicalAgentId(approvalId)) return undefined;
  const repository = AgentRepository.getInstance();
  const target = await repository.findTaskTarget(taskId, principal.subjectUserId, principal.accountOwnerId);
  if (!target || target.id !== taskId || target.userId !== principal.subjectUserId) return undefined;
  const approval = await repository.findApprovalTarget(approvalId, target, principal.accountOwnerId);
  if (!approval || approval.id !== approvalId || approval.taskId !== taskId) return undefined;
  return [
    agentTaskArn(principal.accountOwnerId, target.userId, taskId),
    agentApprovalArn(principal.accountOwnerId, target.userId, taskId, approvalId),
  ];
};
