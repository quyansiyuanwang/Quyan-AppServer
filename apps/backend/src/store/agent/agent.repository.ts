import { prisma } from "@/config/database";
import type { McpServer, Prisma } from "@prisma/client";

import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { ForbiddenError } from "@/util/errors";
const mcpAccountScope = (userId: string, accountOwnerId: string): Prisma.McpServerWhereInput => ({
  userId,
  status: 1,
  user: { status: 1, OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }] },
});
export type McpServerTarget = Pick<McpServer, "id" | "userId" | "name" | "updateTime">;
/** An existence marker only; public configuration reads must never load credential ciphertext. */
const mcpPublicCredential = { credential: { select: { id: true } } } as const;
export type PublicMcpServer = McpServer & { credential: { id: string } | null };
const mcpScopeChanged = () =>
  new ForbiddenError("MCP server authorization snapshot changed", undefined, {
    messageKey: "permission.insufficientPermission",
  });

export class AgentRepository {
  private static instance: AgentRepository;

  static getInstance(): AgentRepository {
    return (this.instance ??= new AgentRepository());
  }

  findWorkspaces(userId: string) {
    return prisma.agentWorkspace.findMany({
      where: { userId, status: 1 },
      orderBy: { createTime: "desc" },
      include: { machine: true },
    });
  }

  findWorkspaceForUser(id: string, userId: string) {
    return prisma.agentWorkspace.findFirst({ where: { id, userId, status: 1 } });
  }

  findWorkspaceById(id: string) {
    return prisma.agentWorkspace.findUniqueOrThrow({ where: { id }, include: { machine: true } });
  }

  createWorkspace(data: {
    userId: string;
    name: string;
    policy: Prisma.InputJsonValue;
    limits: Prisma.InputJsonValue;
    machineId?: string;
  }) {
    return prisma.agentWorkspace.create({
      data: { ...data, runtimeStatus: "provisioning" },
    });
  }

  findMachineForUser(id: string, userId: string) {
    return prisma.agentRuntimeMachine.findFirst({ where: { id, userId, status: 1 } });
  }

  listMachines(userId: string) {
    return prisma.agentRuntimeMachine.findMany({ where: { userId, status: 1 }, orderBy: { createTime: "desc" } });
  }

  createMachine(data: { userId: string; name: string; registrationHash: string }) {
    return prisma.agentRuntimeMachine.create({ data });
  }

  updateMachine(id: string, data: Prisma.AgentRuntimeMachineUpdateInput) {
    return prisma.agentRuntimeMachine.update({ where: { id }, data });
  }

  findMachineByRegistrationHash(registrationHash: string) {
    return prisma.agentRuntimeMachine.findFirst({ where: { registrationHash, status: 1 } });
  }

  markMachineConnected(id: string, agentId: string, capabilities: Prisma.InputJsonValue) {
    return prisma.agentRuntimeMachine.update({
      where: { id },
      data: { agentId, capabilities, runtimeStatus: "online", lastHeartbeatAt: new Date(), lastError: null },
    });
  }

  markMachineHeartbeat(agentId: string, capabilities?: Prisma.InputJsonValue) {
    return prisma.agentRuntimeMachine.updateMany({
      where: { agentId, status: 1 },
      data: { runtimeStatus: "online", lastHeartbeatAt: new Date(), ...(capabilities ? { capabilities } : {}) },
    });
  }

  markMachineOffline(agentId: string) {
    return prisma.agentRuntimeMachine.updateMany({ where: { agentId, status: 1 }, data: { runtimeStatus: "offline" } });
  }

  updateWorkspace(id: string, data: Prisma.AgentWorkspaceUpdateInput) {
    return prisma.agentWorkspace.update({ where: { id }, data });
  }

  findConversationForUser(id: string, userId: string) {
    return prisma.conversation.findFirst({ where: { id, userId } });
  }

  findRelayTokenForUser(id: string | undefined, userId: string) {
    if (!id) return Promise.resolve(null);
    return prisma.relayToken.findFirst({ where: { id, userId, status: 1 } });
  }

  createTask(data: {
    userId: string;
    workspaceId: string;
    conversationId: string;
    relayTokenId: string;
    model: string;
    prompt: string;
    maxSteps: number;
    budget: number | undefined;
  }) {
    return prisma.agentTask.create({ data });
  }

  findTaskForUser(id: string, userId: string) {
    return prisma.agentTask.findFirst({ where: { id, userId } });
  }

  updateTask(id: string, data: Prisma.AgentTaskUpdateInput) {
    return prisma.agentTask.update({ where: { id }, data });
  }

  async appendEvent(taskId: string, eventType: string, payload: Prisma.InputJsonValue) {
    const last = await prisma.agentRunEvent.findFirst({
      where: { taskId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    return prisma.agentRunEvent.create({
      data: { taskId, sequence: (last?.sequence ?? 0) + 1, eventType, payload },
    });
  }

  listEvents(taskId: string, after: number) {
    return prisma.agentRunEvent.findMany({
      where: { taskId, sequence: { gt: after } },
      orderBy: { sequence: "asc" },
    });
  }

  listPendingApprovals(taskId: string, userId: string) {
    return prisma.agentApproval.findMany({
      where: { taskId, task: { userId }, status: "pending" },
      orderBy: { createTime: "asc" },
    });
  }

  findPendingApproval(approvalId: string, taskId: string, userId: string) {
    return prisma.agentApproval.findFirst({
      where: { id: approvalId, taskId, task: { userId }, status: "pending" },
    });
  }

  updateApproval(id: string, data: Prisma.AgentApprovalUncheckedUpdateInput) {
    return prisma.agentApproval.update({ where: { id }, data });
  }

  scanMcpTargets(userId: string, accountOwnerId: string, after?: McpServerTarget) {
    return prisma.mcpServer.findMany({
      where: {
        AND: [
          mcpAccountScope(userId, accountOwnerId),
          ...(after ? [{ OR: [{ name: { gt: after.name } }, { name: after.name, id: { gt: after.id } }] }] : []),
        ],
      },
      select: { id: true, userId: true, name: true, updateTime: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  async readMcpTargets(
    userId: string,
    accountOwnerId: string,
    targets: readonly McpServerTarget[],
  ): Promise<PublicMcpServer[]> {
    if (!targets.length) return [];
    return prisma.mcpServer.findMany({
      where: {
        AND: [
          mcpAccountScope(userId, accountOwnerId),
          { OR: targets.map((target) => ({ id: target.id, updateTime: target.updateTime })) },
        ],
      },
      include: mcpPublicCredential,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  }

  findMcpServers(userId: string) {
    return prisma.mcpServer.findMany({
      where: { userId, status: 1 },
      orderBy: { name: "asc" },
      include: mcpPublicCredential,
    });
  }

  async createMcpServer(
    data: {
      userId: string;
      name: string;
      endpoint?: string;
      transport: string;
      toolAllowlist: Prisma.InputJsonValue;
      credential?: {
        create: {
          ciphertext: string;
          iv: string;
          authTag: string;
        };
      };
    },
    accountOwnerId?: string,
  ): Promise<PublicMcpServer> {
    if (!accountOwnerId) return prisma.mcpServer.create({ data, include: mcpPublicCredential });
    return prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findFirst({
          where: { id: data.userId, status: 1, OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }] },
          select: { id: true },
        });
        if (user?.id !== data.userId) throw mcpScopeChanged();
        return tx.mcpServer.create({ data, include: mcpPublicCredential });
      },
      { isolationLevel: "Serializable" },
    );
  }

  markRuntimeAgentReady(agentId: string) {
    return prisma.agentWorkspace.updateMany({
      where: { runtimeAgentId: agentId, status: 1 },
      data: { runtimeStatus: "ready" },
    });
  }
}
