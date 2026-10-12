import { prisma } from "@/config/database";
import type { AgentRuntimeMachine, AgentWorkspace, AgentTask, AgentApproval, McpServer, Prisma } from "@prisma/client";

import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { AGENT_TASK_LIMITS } from "@/services/agent/agent-task.policy";
import { BadRequestError, ForbiddenError } from "@/util/errors";
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
  user: {
    status: 1,
    OR: [
      { accountOwnerId, accountOwner: { status: 1, accountOwnerId: null } },
      { id: accountOwnerId, accountOwnerId: null },
    ],
  },
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

export type AgentTaskTarget = Pick<AgentTask, "id" | "userId" | "workspaceId" | "taskStatus" | "updateTime">;
export type AgentApprovalTarget = Pick<AgentApproval, "id" | "taskId" | "stepId" | "createTime" | "expiresAt">;
const taskAccountScope = (userId: string, accountOwnerId: string): Prisma.AgentTaskWhereInput => ({
  userId,
  status: 1,
  user: {
    status: 1,
    OR: [
      { id: accountOwnerId, accountOwnerId: null },
      { accountOwnerId, accountOwner: { status: 1, accountOwnerId: null } },
    ],
  },
  workspace: { userId, status: 1 },
  conversation: { userId, status: 1 },
});
const taskStateChanged = () =>
  new BadRequestError("Agent task state changed", undefined, { messageKey: "agent.taskStateChanged" });

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

  async createWorkspace(
    data: {
      userId: string;
      name: string;
      policy: Prisma.InputJsonValue;
      limits: Prisma.InputJsonValue;
      machineId?: string;
    },
    accountOwnerId?: string,
    machineTarget?: AgentMachineTarget,
  ) {
    if (!accountOwnerId) return prisma.agentWorkspace.create({ data: { ...data, runtimeStatus: "provisioning" } });
    return prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findFirst({
          where: {
            id: data.userId,
            status: 1,
            OR: [
              { accountOwnerId, accountOwner: { status: 1, accountOwnerId: null } },
              { id: accountOwnerId, accountOwnerId: null },
            ],
          },
          select: { id: true },
        });
        if (user?.id !== data.userId) throw machineScopeChanged();
        if (data.machineId) {
          if (!machineTarget || machineTarget.id !== data.machineId || machineTarget.userId !== data.userId)
            throw machineScopeChanged();
          const machine = await tx.agentRuntimeMachine.findFirst({
            where: {
              id: machineTarget.id,
              updateTime: machineTarget.updateTime,
              ...machineAccountScope(data.userId, accountOwnerId),
            },
            select: { id: true },
          });
          if (machine?.id !== machineTarget.id) throw machineScopeChanged();
        } else if (machineTarget) throw machineScopeChanged();
        return tx.agentWorkspace.create({ data: { ...data, runtimeStatus: "provisioning" } });
      },
      { isolationLevel: "Serializable" },
    );
  }

  findWorkspaceTarget(id: string, userId: string, accountOwnerId: string) {
    return prisma.agentWorkspace.findFirst({
      where: { id, ...workspaceAccountScope(userId, accountOwnerId) },
      select: { id: true, userId: true, machineId: true, createTime: true, updateTime: true },
    });
  }

  readWorkspaceRuntimeTarget(target: AgentWorkspaceTarget, accountOwnerId: string) {
    return prisma.agentWorkspace.findFirst({
      where: {
        id: target.id,
        machineId: target.machineId,
        updateTime: target.updateTime,
        ...workspaceAccountScope(target.userId, accountOwnerId),
      },
      select: { id: true, userId: true, machineId: true, updateTime: true, runtimeHandle: true, runtimeAgentId: true },
    });
  }

  async claimWorkspaceDeletion(target: AgentWorkspaceTarget, accountOwnerId: string): Promise<AgentWorkspaceTarget> {
    return prisma.$transaction(
      async (tx) => {
        const updated = await tx.agentWorkspace.updateMany({
          where: {
            id: target.id,
            machineId: target.machineId,
            updateTime: target.updateTime,
            runtimeStatus: { not: "stopping" },
            ...workspaceAccountScope(target.userId, accountOwnerId),
          },
          data: { runtimeStatus: "stopping", updateTime: nextRuntimeLease(target.updateTime) },
        });
        if (updated.count !== 1) throw machineScopeChanged();
        return tx.agentWorkspace.findFirstOrThrow({
          where: { id: target.id, userId: target.userId },
          select: { id: true, userId: true, machineId: true, createTime: true, updateTime: true },
        });
      },
      { isolationLevel: "Serializable" },
    );
  }

  releaseWorkspaceDeletion(target: AgentWorkspaceTarget, accountOwnerId: string, runtimeReleased: boolean) {
    // Internal compensation only: never overwrite another operation or move the account scope.
    return prisma.agentWorkspace.updateMany({
      where: {
        id: target.id,
        machineId: target.machineId,
        updateTime: target.updateTime,
        runtimeStatus: "stopping",
        ...workspaceAccountScope(target.userId, accountOwnerId),
      },
      data: {
        runtimeStatus: "failed",
        lastError: "Workspace cleanup failed",
        ...(runtimeReleased ? { runtimeHandle: null, runtimeAgentId: null } : {}),
        updateTime: nextRuntimeLease(target.updateTime),
      },
    });
  }

  readMachineRuntimeTarget(target: AgentMachineTarget, accountOwnerId: string) {
    return prisma.agentRuntimeMachine.findFirst({
      where: { id: target.id, updateTime: target.updateTime, ...machineAccountScope(target.userId, accountOwnerId) },
      select: agentMachinePublicSelect,
    });
  }

  async updateWorkspaceTarget(
    target: AgentWorkspaceTarget,
    accountOwnerId: string,
    data: Prisma.AgentWorkspaceUpdateManyMutationInput,
  ) {
    return prisma.$transaction(
      async (tx) => {
        const updated = await tx.agentWorkspace.updateMany({
          where: {
            id: target.id,
            machineId: target.machineId,
            updateTime: target.updateTime,
            ...workspaceAccountScope(target.userId, accountOwnerId),
          },
          data: { ...data, updateTime: nextRuntimeLease(target.updateTime) },
        });
        if (updated.count !== 1) throw machineScopeChanged();
        return tx.agentWorkspace.findFirstOrThrow({
          where: { id: target.id, userId: target.userId },
          select: agentWorkspacePublicSelect,
        });
      },
      { isolationLevel: "Serializable" },
    );
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
    return prisma.agentTask.findFirst({ where: { id, userId, status: 1 } });
  }

  findTaskTarget(id: string, userId: string, accountOwnerId: string) {
    return prisma.agentTask.findFirst({
      where: { id, ...taskAccountScope(userId, accountOwnerId) },
      select: { id: true, userId: true, workspaceId: true, taskStatus: true, updateTime: true },
    });
  }

  listTaskEvents(target: AgentTaskTarget, accountOwnerId: string, after: number) {
    return prisma.agentRunEvent.findMany({
      where: {
        taskId: target.id,
        sequence: { gt: after },
        task: {
          id: target.id,
          workspaceId: target.workspaceId,
          updateTime: target.updateTime,
          ...taskAccountScope(target.userId, accountOwnerId),
        },
      },
      orderBy: { sequence: "asc" },
      take: AGENT_TASK_LIMITS.eventsPerPage,
      select: { taskId: true, sequence: true, eventType: true, payload: true, createTime: true },
    });
  }

  async cancelTaskTarget(target: AgentTaskTarget, accountOwnerId: string) {
    if (!["queued", "running", "waiting_approval"].includes(target.taskStatus)) throw taskStateChanged();
    const updated = await prisma.agentTask.updateMany({
      where: {
        id: target.id,
        workspaceId: target.workspaceId,
        taskStatus: target.taskStatus,
        updateTime: target.updateTime,
        ...taskAccountScope(target.userId, accountOwnerId),
      },
      data: {
        taskStatus: "cancelled",
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
        lastError: "Cancelled by user",
        updateTime: nextRuntimeLease(target.updateTime),
      },
    });
    if (updated.count !== 1) throw machineScopeChanged();
  }

  async startQueuedTask(id: string, leaseOwner: string, leaseExpiresAt: Date) {
    const updated = await prisma.agentTask.updateMany({
      where: {
        id,
        status: 1,
        taskStatus: "queued",
        user: { status: 1 },
        workspace: { status: 1, runtimeStatus: { not: "stopping" } },
      },
      data: { taskStatus: "running", leaseOwner, leaseExpiresAt },
    });
    return updated.count === 1;
  }

  async failRunningTask(id: string, leaseOwner: string) {
    const updated = await prisma.agentTask.updateMany({
      where: { id, status: 1, taskStatus: "running", leaseOwner },
      data: {
        taskStatus: "failed",
        lastError: "Remote Agent runtime is not connected",
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
      },
    });
    return updated.count === 1;
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
      take: AGENT_TASK_LIMITS.eventsPerPage,
    });
  }

  scanApprovalTargets(target: AgentTaskTarget, accountOwnerId: string, after?: AgentApprovalTarget) {
    return prisma.agentApproval.findMany({
      where: {
        taskId: target.id,
        status: "pending",
        expiresAt: { gt: new Date() },
        task: {
          id: target.id,
          workspaceId: target.workspaceId,
          taskStatus: "waiting_approval",
          ...taskAccountScope(target.userId, accountOwnerId),
        },
        step: { taskId: target.id },
        ...(after
          ? { OR: [{ createTime: { gt: after.createTime } }, { createTime: after.createTime, id: { gt: after.id } }] }
          : {}),
      },
      select: { id: true, taskId: true, stepId: true, createTime: true, expiresAt: true },
      orderBy: [{ createTime: "asc" }, { id: "asc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }

  findApprovalTarget(id: string, target: AgentTaskTarget, accountOwnerId: string) {
    return prisma.agentApproval.findFirst({
      where: {
        id,
        taskId: target.id,
        status: "pending",
        expiresAt: { gt: new Date() },
        task: {
          id: target.id,
          workspaceId: target.workspaceId,
          taskStatus: "waiting_approval",
          ...taskAccountScope(target.userId, accountOwnerId),
        },
        step: { taskId: target.id },
      },
      select: { id: true, taskId: true, stepId: true, createTime: true, expiresAt: true },
    });
  }

  async readApprovalTargets(
    target: AgentTaskTarget,
    accountOwnerId: string,
    approvals: readonly AgentApprovalTarget[],
  ) {
    if (!approvals.length) return [];
    return prisma.agentApproval.findMany({
      where: {
        taskId: target.id,
        status: "pending",
        expiresAt: { gt: new Date() },
        task: {
          id: target.id,
          workspaceId: target.workspaceId,
          taskStatus: "waiting_approval",
          ...taskAccountScope(target.userId, accountOwnerId),
        },
        step: { taskId: target.id },
        OR: approvals.map((approval) => ({ id: approval.id, stepId: approval.stepId, expiresAt: approval.expiresAt })),
      },
      select: { id: true, taskId: true, status: true, toolCall: true, expiresAt: true },
      orderBy: [{ createTime: "asc" }, { id: "asc" }],
    });
  }

  async decideApprovalTarget(
    target: AgentTaskTarget,
    accountOwnerId: string,
    approval: AgentApprovalTarget,
    decision: "approved" | "rejected",
  ) {
    if (approval.taskId !== target.id || target.taskStatus !== "waiting_approval") throw taskStateChanged();
    await prisma.$transaction(
      async (tx) => {
        const task = await tx.agentTask.updateMany({
          where: {
            id: target.id,
            workspaceId: target.workspaceId,
            taskStatus: "waiting_approval",
            updateTime: target.updateTime,
            ...taskAccountScope(target.userId, accountOwnerId),
          },
          data: {
            taskStatus: decision === "approved" ? "running" : "failed",
            lastError: decision === "approved" ? null : "Tool call rejected",
            updateTime: nextRuntimeLease(target.updateTime),
          },
        });
        if (task.count !== 1) throw machineScopeChanged();
        const changed = await tx.agentApproval.updateMany({
          where: {
            id: approval.id,
            taskId: target.id,
            stepId: approval.stepId,
            status: "pending",
            expiresAt: { gt: new Date(), equals: approval.expiresAt },
            step: { taskId: target.id },
          },
          data: { status: decision, decidedBy: target.userId, decidedAt: new Date() },
        });
        if (changed.count !== 1)
          throw new BadRequestError("Approval is no longer available", undefined, {
            messageKey: "agent.approvalUnavailable",
          });
      },
      { isolationLevel: "Serializable" },
    );
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
        runtimeStatus: { in: ["provisioning", "ready"] },
        machine: runtimeMachineScope(identity),
      },
      data: { runtimeStatus: "ready" },
    });
  }
}
