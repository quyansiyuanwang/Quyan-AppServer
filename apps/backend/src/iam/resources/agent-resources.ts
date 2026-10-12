import { buildAcsResource } from "@quyan/shared";

export function isCanonicalAgentId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
export function agentMachineArn(accountOwnerId: string, userId: string, machineId: string): string {
  if (!isCanonicalAgentId(userId) || !isCanonicalAgentId(machineId))
    throw new Error("Invalid Agent machine identifier");
  return buildAcsResource({
    service: "agent",
    region: "*",
    accountId: accountOwnerId,
    path: "machine/" + userId + "/" + machineId,
  });
}

export function agentWorkspaceArn(accountOwnerId: string, userId: string, workspaceId: string): string {
  if (!isCanonicalAgentId(userId) || !isCanonicalAgentId(workspaceId))
    throw new Error("Invalid Agent workspace identifier");
  return buildAcsResource({
    service: "agent",
    region: "*",
    accountId: accountOwnerId,
    path: "workspace/" + userId + "/" + workspaceId,
  });
}

export function agentTaskArn(accountOwnerId: string, userId: string, taskId: string): string {
  if (!isCanonicalAgentId(userId) || !isCanonicalAgentId(taskId)) throw new Error("Invalid Agent task identifier");
  return buildAcsResource({
    service: "agent",
    region: "*",
    accountId: accountOwnerId,
    path: "task/" + userId + "/" + taskId,
  });
}

export function agentApprovalArn(accountOwnerId: string, userId: string, taskId: string, approvalId: string): string {
  if (![userId, taskId, approvalId].every(isCanonicalAgentId)) throw new Error("Invalid Agent approval identifier");
  return buildAcsResource({
    service: "agent",
    region: "*",
    accountId: accountOwnerId,
    path: "approval/" + userId + "/" + taskId + "/" + approvalId,
  });
}

export function agentRelayTokenArn(accountOwnerId: string, userId: string, tokenId: string): string {
  if (!isCanonicalAgentId(userId) || !isCanonicalAgentId(tokenId)) throw new Error("Invalid Relay token identifier");
  return buildAcsResource({
    service: "relay",
    region: "*",
    accountId: accountOwnerId,
    path: "token/" + userId + "/" + tokenId,
  });
}
