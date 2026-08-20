import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";

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

  findMcpServers(userId: string) {
    return prisma.mcpServer.findMany({
      where: { userId, status: 1 },
      orderBy: { name: "asc" },
      include: { credential: true },
    });
  }

  createMcpServer(data: {
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
  }) {
    return prisma.mcpServer.create({ data, include: { credential: true } });
  }

  markRuntimeAgentReady(agentId: string) {
    return prisma.agentWorkspace.updateMany({
      where: { runtimeAgentId: agentId, status: 1 },
      data: { runtimeStatus: "ready" },
    });
  }
}
