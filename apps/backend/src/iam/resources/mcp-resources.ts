import { buildAcsResource } from "@quyan/shared";

export function isCanonicalMcpId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
export function mcpServerArn(accountOwnerId: string, userId: string, serverId: string): string {
  if (!isCanonicalMcpId(userId) || !isCanonicalMcpId(serverId)) throw new Error("Invalid MCP server identifier");
  return buildAcsResource({
    service: "mcp",
    region: "*",
    accountId: accountOwnerId,
    path: "server/" + userId + "/" + serverId,
  });
}
