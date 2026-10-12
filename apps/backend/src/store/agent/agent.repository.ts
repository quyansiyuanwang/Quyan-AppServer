import { prisma } from "@/config/database";
import type { AgentRuntimeMachine, AgentWorkspace, McpServer, Prisma } from "@prisma/client";

import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { ForbiddenError } from "@/util/errors";
const machineAccountScope = (userId: string, accountOwnerId: string): Prisma.AgentRuntimeMachineWhereInput => ({
  userId,
  status: 1,
  user: { status: 1, OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }] },
});
export type AgentMachineTarget = Pick<AgentRuntimeMachine, "id" | "userId" | "createTime" | "updateTime">;
export const agentMachinePublicSelect = {
  id: true,
  userId: true,
  name: true,
  status: true,
  runtime: true,
  runtimeStatus: true,
  agentId: true,
  capabilities: true,
  lastHeartbeatAt: true,
  createTime: true,
  updateTime: true,
} as const;
export type PublicAgentMachine = Prisma.AgentRuntimeMachineGetPayload<{ select: typeof agentMachinePublicSelect }>;
/** Runtime lease changes on every accepted state transition, fencing stale connections across workers. */
export type AgentRuntimeIdentity = {
  id: string;
  userId: string;
  accountOwnerId: string;
  agentId: string;
  updateTime: Date;
};
const runtimeMachineScope = (identity: AgentRuntimeIdentity): Prisma.AgentRuntimeMachineWhereInput => ({
  id: identity.id,
  userId: identity.userId,
  agentId: identity.agentId,
  updateTime: identity.updateTime,
  status: 1,
  user: {
    status: 1,
    OR: [
      { id: identity.accountOwnerId, accountOwnerId: null },
      { accountOwnerId: identity.accountOwnerId, accountOwner: { status: 1, accountOwnerId: null } },
    ],
  },
});
const nextRuntimeLease = (previous: Date) => new Date(Math.max(Date.now(), previous.getTime() + 1));
const machineScopeChanged = () =>
  new ForbiddenError("Agent machine authorization snapshot changed", undefined, {
    messageKey: "permission.insufficientPermission",
  });

const workspaceAccountScope = (userId: string, accountOwnerId: string): Prisma.AgentWorkspaceWhereInput => ({
  userId,
  status: 1,
  user: { status: 1, OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }] },
});
export type AgentWorkspaceTarget = Pick<AgentWorkspace, "id" | "userId" | "machineId" | "createTime" | "updateTime">;
export const agentWorkspacePublicSelect = {
  id: true,
  userId: true,
  status: true,
  name: true,
  runtime: true,
  runtimeStatus: true,
  policy: true,
  limits: true,
  createTime: true,
  updateTime: true,
  machineId: true,
} as const;
export type AgentMachineSummary = Pick<AgentRuntimeMachine, "id" | "userId" | "name" | "runtimeStatus">;
export type PublicAgentWorkspace = Prisma.AgentWorkspaceGetPayload<{ select: typeof agentWorkspacePublicSelect }> & {
  machine?: AgentMachineSummary | null;
};

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
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      select: {
        ...agentWorkspacePublicSelect,
        machine: { select: { id: true, userId: true, name: true, runtimeStatus: true } },
      },
    });
  }

  scanWorkspaceTargets(userId: string, accountOwnerId: string, after?: AgentWorkspaceTarget) {
    return prisma.agentWorkspace.findMany({
      where: {
        AND: [
          workspaceAccountScope(userId, accountOwnerId),
          ...(after
            ? [
                {
                  OR: [
                    { createTime: { lt: after.createTime } },
                    { createTime: after.createTime, id: { lt: after.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: { id: true, userId: true, machineId: true, createTime: true, updateTime: true },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }

  async readWorkspaceTargets(
    userId: string,
    accountOwnerId: string,
    targets: readonly AgentWorkspaceTarget[],
  ): Promise<PublicAgentWorkspace[]> {
    if (!targets.length) return Promise.resolve([]);
    return prisma.agentWorkspace.findMany({
      where: {
        AND: [
          workspaceAccountScope(userId, accountOwnerId),
          {
            OR: targets.map((target) => ({
              id: target.id,
              machineId: target.machineId,
              updateTime: target.updateTime,
            })),
          },
        ],
      },
      select: agentWorkspacePublicSelect,
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
    });
  }

  async readMachineSummaries(
    userId: string,
    accountOwnerId: string,
    machineIds: readonly string[],
  ): Promise<AgentMachineSummary[]> {
    if (!machineIds.length) return Promise.resolve([]);
    return prisma.agentRuntimeMachine.findMany({
      where: { id: { in: [...machineIds] }, ...machineAccountScope(userId, accountOwnerId) },
      select: { id: true, userId: true, name: true, runtimeStatus: true },
    });
  }

  findWorkspaceForUser(id: string, userId: string) {
    return prisma.agentWorkspace.findFirst({ where: { id, userId, status: 1 } });
  }

  findWorkspaceById(id: string) {
    return prisma.agentWorkspace.findUniqueOrThrow({
      where: { id },
      select: {
        ...agentWorkspacePublicSelect,
        machine: { select: { id: true, userId: true, name: true, runtimeStatus: true } },
      },
    });
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

  findMachineTarget(id: string, userId: string, accountOwnerId: string) {
    return prisma.agentRuntimeMachine.findFirst({
      where: { id, ...machineAccountScope(userId, accountOwnerId) },
      select: { id: true, userId: true, createTime: true, updateTime: true },
    });
  }
  scanMachineTargets(userId: string, accountOwnerId: string, after?: AgentMachineTarget) {
    return prisma.agentRuntimeMachine.findMany({
      where: {
        AND: [
          machineAccountScope(userId, accountOwnerId),
          ...(after
            ? [
                {
                  OR: [
                    { createTime: { lt: after.createTime } },
                    { createTime: after.createTime, id: { lt: after.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: { id: true, userId: true, createTime: true, updateTime: true },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  async readMachineTargets(
    userId: string,
    accountOwnerId: string,
    targets: readonly AgentMachineTarget[],
  ): Promise<PublicAgentMachine[]> {
    if (!targets.length) return [];
    return prisma.agentRuntimeMachine.findMany({
      where: {
        AND: [
          machineAccountScope(userId, accountOwnerId),
          { OR: targets.map((target) => ({ id: target.id, updateTime: target.updateTime })) },
        ],
      },
      select: agentMachinePublicSelect,
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
    });
  }
  async deleteMachineTarget(target: AgentMachineTarget, accountOwnerId: string) {
    const result = await prisma.agentRuntimeMachine.updateMany({
      where: { id: target.id, updateTime: target.updateTime, ...machineAccountScope(target.userId, accountOwnerId) },
      data: { status: -1, runtimeStatus: "revoked" },
    });
    if (result.count !== 1) throw machineScopeChanged();
  }

  findMachineForUser(id: string, userId: string) {
    return prisma.agentRuntimeMachine.findFirst({ where: { id, userId, status: 1 }, select: agentMachinePublicSelect });
  }

  listMachines(userId: string) {
    return prisma.agentRuntimeMachine.findMany({
      where: { userId, status: 1 },
      orderBy: { createTime: "desc" },
      select: agentMachinePublicSelect,
    });
  }

  async createMachine(
    data: { userId: string; name: string; registrationHash: string },
    accountOwnerId?: string,
  ): Promise<PublicAgentMachine> {
    if (!accountOwnerId) return prisma.agentRuntimeMachine.create({ data, select: agentMachinePublicSelect });
    return prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findFirst({
          where: { id: data.userId, status: 1, OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }] },
          select: { id: true },
        });
        if (user?.id !== data.userId) throw machineScopeChanged();
        return tx.agentRuntimeMachine.create({ data, select: agentMachinePublicSelect });
      },
      { isolationLevel: "Serializable" },
    );
  }

  updateMachine(id: string, data: Prisma.AgentRuntimeMachineUpdateInput) {
    return prisma.agentRuntimeMachine.update({ where: { id }, data });
  }

  async connectRuntimeMachine(registrationHash: string, agentId: string, capabilities: Prisma.InputJsonValue) {
    return prisma.$transaction(
      async (tx) => {
        const machine = await tx.agentRuntimeMachine.findFirst({
          where: {
            registrationHash,
            status: 1,
            user: { status: 1, OR: [{ accountOwnerId: null }, { accountOwner: { status: 1, accountOwnerId: null } }] },
          },
          select: { id: true, userId: true, updateTime: true, user: { select: { accountOwnerId: true } } },
        });
        if (!machine) return null;
        const identity: AgentRuntimeIdentity = {
          id: machine.id,
          userId: machine.userId,
          accountOwnerId: machine.user.accountOwnerId ?? machine.userId,
          agentId,
          updateTime: nextRuntimeLease(machine.updateTime),
        };
        const updated = await tx.agentRuntimeMachine.updateMany({
          where: { id: machine.id, status: 1, updateTime: machine.updateTime, registrationHash },
          data: {
            agentId,
            capabilities,
            runtimeStatus: "online",
            lastHeartbeatAt: new Date(),
            lastError: null,
            updateTime: identity.updateTime,
          },
        });
        return updated.count === 1 ? identity : null;
      },
      { isolationLevel: "Serializable" },
    );
  }

  async isRuntimeConnectionActive(identity: AgentRuntimeIdentity) {
    return (await prisma.agentRuntimeMachine.count({ where: runtimeMachineScope(identity) })) === 1;
  }

  async markMachineHeartbeat(identity: AgentRuntimeIdentity, capabilities?: Prisma.InputJsonValue) {
    const updateTime = nextRuntimeLease(identity.updateTime);
    const updated = await prisma.agentRuntimeMachine.updateMany({
      where: runtimeMachineScope(identity),
      data: {
        runtimeStatus: "online",
        lastHeartbeatAt: new Date(),
        updateTime,
        ...(capabilities ? { capabilities } : {}),
      },
    });
    return updated.count === 1 ? { ...identity, updateTime } : null;
  }

  markMachineOffline(identity: AgentRuntimeIdentity) {
    return prisma.agentRuntimeMachine.updateMany({
      where: runtimeMachineScope(identity),
      data: { runtimeStatus: "offline", updateTime: nextRuntimeLease(identity.updateTime) },
    });
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

  markRuntimeAgentReady(identity: AgentRuntimeIdentity) {
    return prisma.agentWorkspace.updateMany({
      where: {
        runtimeAgentId: identity.agentId,
        machineId: identity.id,
        userId: identity.userId,
        status: 1,
        runtimeHandle: { not: null },
        machine: runtimeMachineScope(identity),
      },
      data: { runtimeStatus: "ready" },
    });
  }
}
