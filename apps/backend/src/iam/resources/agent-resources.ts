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
