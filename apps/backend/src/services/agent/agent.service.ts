import { ForbiddenError, NotFoundError, BadRequestError } from "@/util/errors";
import { randomUUID, createCipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/config/env";
import type { AgentTaskStatus, AgentWorkspaceStatus, AgentStreamEvent, AgentToolCall } from "@appserver/shared";
import type {
  CreateAgentWorkspaceRequest,
  CreateAgentRunRequest,
  AgentWorkspaceResponse,
  AgentRunResponse,
  AgentApprovalResponse,
  AgentMachineResponse,
  CreateAgentMachineRequest,
  CreateMcpServerRequest,
  McpServerResponse,
} from "@/api/dto/agent/agent.dto";
import { RootlessDockerWorkspaceProvider } from "./workspace-runtime.service";
import { AgentRuntimeGateway } from "./agent-runtime.gateway";
import { AgentRepository } from "@/store/agent/agent.repository";

const workspaceRuntime = new RootlessDockerWorkspaceProvider();
const remoteRuntime = AgentRuntimeGateway.getInstance();

const defaults = {
  policy: { allowedCommands: [], allowedPaths: ["/workspace"], allowedHosts: [], autoApproveReadOnly: true },
  limits: { cpu: 1, memoryMb: 512, diskMb: 2048, timeoutSeconds: 3600, maxSteps: 30, budget: 10 },
};

type EventPayload = AgentStreamEvent;

export class AgentService {
  private static instance: AgentService;
  private constructor(private readonly repository: AgentRepository = AgentRepository.getInstance()) {}
  static getInstance() {
    return (this.instance ??= new AgentService());
  }

  private encryptionKey() {
    const secret = String((env as any).integrations?.developerProduct?.secretsMasterKey || "").trim();
    if (secret.length < 32)
      throw new BadRequestError("Agent credential encryption is not configured", undefined, {
        messageKey: "agent.credentialEncryptionNotConfigured",
      });
    return createHash("sha256").update(secret).digest();
  }

  private encrypt(value: Record<string, string>) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
    };
  }

  private toWorkspaceDto(row: any): AgentWorkspaceResponse {
    return {
      id: row.id,
      name: row.name,
      runtime: row.runtime,
      runtimeStatus: row.runtimeStatus as AgentWorkspaceStatus,
      policy: row.policy as any,
      limits: row.limits as any,
      createTime: row.createTime,
      machineId: row.machineId ?? undefined,
      machineName: row.machine?.name,
      machineStatus: row.machine?.runtimeStatus,
    };
  }

  private toMachineDto(row: any, registrationToken?: string): AgentMachineResponse {
    return {
      id: row.id,
      name: row.name,
      runtime: row.runtime,
      runtimeStatus: row.runtimeStatus,
      agentId: row.agentId ?? undefined,
      capabilities: row.capabilities as Record<string, unknown>,
      lastHeartbeatAt: row.lastHeartbeatAt ?? undefined,
      ...(registrationToken ? { registrationToken } : {}),
    };
  }

  private createRegistrationToken() {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: createHash("sha256").update(token).digest("hex") };
  }

  async listMachines(userId: string): Promise<AgentMachineResponse[]> {
    return (await this.repository.listMachines(userId)).map((row) => this.toMachineDto(row));
  }

  async createMachine(userId: string, body: CreateAgentMachineRequest): Promise<AgentMachineResponse> {
    const registration = this.createRegistrationToken();
    const row = await this.repository.createMachine({
      userId,
      name: body.name.trim(),
      registrationHash: registration.hash,
    });
    return this.toMachineDto(row, registration.token);
  }

  async deleteMachine(userId: string, id: string) {
    const row = await this.repository.findMachineForUser(id, userId);
    if (!row) throw new NotFoundError("Agent machine not found", undefined, { messageKey: "agent.machineNotFound" });
    await this.repository.updateMachine(id, { status: -1, runtimeStatus: "revoked" });
  }

  async listWorkspaces(userId: string) {
    const rows = await this.repository.findWorkspaces(userId);
    return rows.map((row) => this.toWorkspaceDto(row));
  }

  async createWorkspace(userId: string, body: CreateAgentWorkspaceRequest) {
    const policy = { ...defaults.policy, ...(body.policy || {}) };
    const limits = { ...defaults.limits, ...(body.limits || {}) };
    const machine = body.machineId ? await this.repository.findMachineForUser(body.machineId, userId) : null;
    if (body.machineId && !machine)
      throw new NotFoundError("Agent machine not found", undefined, { messageKey: "agent.machineNotFound" });
    const row = await this.repository.createWorkspace({
      userId,
      name: body.name.trim(),
      policy,
      limits,
      machineId: machine?.id,
    });
    try {
      if (!machine && process.env.AGENT_RUNTIME_LOCAL === "true") {
        const runtime = await workspaceRuntime.create(row.id, limits);
        await this.repository.updateWorkspace(row.id, { runtimeStatus: "ready", runtimeHandle: runtime.handle });
      } else if (machine) {
        if (!machine.agentId || machine.runtimeStatus !== "online")
          await this.repository.updateWorkspace(row.id, {
            runtimeStatus: "provisioning",
            runtimeAgentId: machine.agentId,
            lastError: "Waiting for the selected remote machine to connect",
          });
        else {
          const response = await remoteRuntime.request(machine.agentId, {
            type: "workspace.create",
            requestId: randomUUID(),
            workspaceId: row.id,
            limits: {
              cpu: Number(limits.cpu),
              memoryMb: Number(limits.memoryMb),
              diskMb: Number(limits.diskMb),
              timeoutSeconds: Number(limits.timeoutSeconds),
            },
          });
          const handle = typeof response.data?.handle === "string" ? response.data.handle : undefined;
          if (!handle) throw new Error("Remote Agent returned no workspace handle");
          await this.repository.updateWorkspace(row.id, {
            runtimeStatus: "ready",
            runtimeAgentId: machine.agentId,
            runtimeHandle: handle,
            lastError: null,
          });
        }
      } else
        await this.repository.updateWorkspace(row.id, {
          runtimeStatus: "failed",
          lastError: "No remote workspace agent is connected",
        });
    } catch (error) {
      await this.repository.updateWorkspace(row.id, {
        runtimeStatus: "failed",
        lastError: error instanceof Error ? error.message : "Workspace provisioning failed",
      });
    }
    return this.toWorkspaceDto(await this.repository.findWorkspaceById(row.id));
  }

  async stopWorkspace(userId: string, id: string, destroy = false) {
    const row = await this.repository.findWorkspaceForUser(id, userId);
    if (!row)
      throw new NotFoundError("Agent workspace not found", undefined, { messageKey: "agent.workspaceNotFound" });
    if (row.runtimeHandle && process.env.AGENT_RUNTIME_LOCAL === "true") {
      if (destroy) await workspaceRuntime.destroy(row.runtimeHandle);
      else await workspaceRuntime.stop(row.runtimeHandle);
    }
    if (destroy)
      await this.repository.updateWorkspace(id, { status: -1, runtimeStatus: "stopped", runtimeHandle: null });
    else await this.repository.updateWorkspace(id, { runtimeStatus: "stopped" });
  }

  async createRun(userId: string, conversationId: string, body: CreateAgentRunRequest): Promise<AgentRunResponse> {
    const [workspace, conversation] = await Promise.all([
      this.repository.findWorkspaceForUser(body.workspaceId, userId),
      this.repository.findConversationForUser(conversationId, userId),
    ]);
    if (!workspace)
      throw new NotFoundError("Agent workspace not found", undefined, { messageKey: "agent.workspaceNotFound" });
    if (!conversation)
      throw new NotFoundError("Conversation not found", undefined, { messageKey: "agent.conversationNotFound" });
    const token = await this.repository.findRelayTokenForUser(
      body.relayTokenId || conversation.relayTokenId || undefined,
      userId,
    );
    if (!token) throw new ForbiddenError("Invalid relay token", undefined, { messageKey: "agent.invalidRelayToken" });
    const limits = workspace.limits as Record<string, number>;
    const row = await this.repository.createTask({
      userId,
      workspaceId: workspace.id,
      conversationId,
      relayTokenId: token.id,
      model: body.model.trim(),
      prompt: body.content,
      maxSteps: body.maxSteps || limits.maxSteps || 30,
      budget: body.budget ?? limits.budget,
    });
    void this.run(row.id);
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      status: row.taskStatus as AgentTaskStatus,
      model: row.model,
      stepCount: row.stepCount,
      createTime: row.createTime,
    };
  }

  private async appendEvent(taskId: string, event: EventPayload) {
    return this.repository.appendEvent(
      taskId,
      event.type,
      event as unknown as import("@prisma/client").Prisma.InputJsonValue,
    );
  }

  async listEvents(userId: string, taskId: string, after = 0) {
    const task = await this.repository.findTaskForUser(taskId, userId);
    if (!task) throw new NotFoundError("Agent task not found", undefined, { messageKey: "agent.taskNotFound" });
    return this.repository.listEvents(taskId, after);
  }

  async cancelRun(userId: string, taskId: string) {
    const task = await this.repository.findTaskForUser(taskId, userId);
    if (!task) throw new NotFoundError("Agent task not found", undefined, { messageKey: "agent.taskNotFound" });
    await this.repository.updateTask(taskId, { taskStatus: "cancelled", lastError: "Cancelled by user" });
  }

  async getApprovals(userId: string, taskId: string): Promise<AgentApprovalResponse[]> {
    const rows = await this.repository.listPendingApprovals(taskId, userId);
    return rows.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      status: row.status,
      toolCall: row.toolCall as unknown as AgentToolCall,
      expiresAt: row.expiresAt,
    }));
  }

  async decideApproval(userId: string, taskId: string, approvalId: string, decision: "approved" | "rejected") {
    const approval = await this.repository.findPendingApproval(approvalId, taskId, userId);
    if (!approval || approval.expiresAt < new Date())
      throw new BadRequestError("Approval is no longer available", undefined, {
        messageKey: "agent.approvalUnavailable",
      });
    await this.repository.updateApproval(approvalId, { status: decision, decidedBy: userId, decidedAt: new Date() });
    await this.repository.updateTask(taskId, {
      taskStatus: decision === "approved" ? "running" : "failed",
      lastError: decision === "approved" ? null : "Tool call rejected",
    });
  }

  async listMcpServers(userId: string): Promise<McpServerResponse[]> {
    const rows = await this.repository.findMcpServers(userId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      endpoint: row.endpoint || undefined,
      transport: row.transport,
      enabled: row.enabled,
      toolAllowlist: row.toolAllowlist as string[],
      hasCredential: Boolean(row.credential),
    }));
  }

  async createMcpServer(userId: string, body: CreateMcpServerRequest) {
    const encrypted = body.credential ? this.encrypt(body.credential) : undefined;
    const row = await this.repository.createMcpServer({
      userId,
      name: body.name.trim(),
      endpoint: body.endpoint,
      transport: body.transport || "streamable-http",
      toolAllowlist: body.toolAllowlist || [],
      ...(encrypted ? { credential: { create: encrypted } } : {}),
    });
    return {
      id: row.id,
      name: row.name,
      endpoint: row.endpoint || undefined,
      transport: row.transport,
      enabled: row.enabled,
      toolAllowlist: row.toolAllowlist as string[],
      hasCredential: Boolean(row.credential),
    };
  }

  private async run(taskId: string) {
    await this.repository
      .updateTask(taskId, {
        taskStatus: "running",
        leaseOwner: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 3600_000),
      })
      .catch(() => undefined);
    await this.appendEvent(taskId, { type: "task", taskId, status: "running", done: false });
    // Model/tool execution is delegated to a remote runtime in production. A task stays
    // resumable and explicit instead of ever executing arbitrary commands on the API host.
    await this.repository
      .updateTask(taskId, { taskStatus: "failed", lastError: "Remote Agent runtime is not connected" })
      .catch(() => undefined);
    await this.appendEvent(taskId, {
      type: "error",
      taskId,
      error: "Remote Agent runtime is not connected",
      done: true,
    });
  }
}
