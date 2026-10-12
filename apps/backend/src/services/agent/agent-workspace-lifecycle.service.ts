import { env } from "@/config/env";
import { AgentRepository, type AgentWorkspaceTarget } from "@/store/agent/agent.repository";
import type { TypedRequest } from "@/types/express";
import { BadRequestError, ForbiddenError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import { randomUUID } from "node:crypto";
import { AgentWorkspaceIamService } from "./agent-workspace-iam.service";
import { AgentRuntimeGateway } from "./agent-runtime.gateway";
import { RootlessDockerWorkspaceProvider } from "./workspace-runtime.service";
import { agentIamDenied } from "./agent-iam-authorization";
const sameTarget = (actual: AgentWorkspaceTarget, expected: AgentWorkspaceTarget) =>
  actual.id === expected.id &&
  actual.userId === expected.userId &&
  actual.machineId === expected.machineId &&
  actual.updateTime.getTime() === expected.updateTime.getTime();

export class AgentWorkspaceLifecycleService {
  private static instance: AgentWorkspaceLifecycleService;
  private constructor(
    private readonly repository: Pick<
      AgentRepository,
      | "claimWorkspaceDeletion"
      | "releaseWorkspaceDeletion"
      | "readWorkspaceRuntimeTarget"
      | "readMachineRuntimeTarget"
      | "updateWorkspaceTarget"
    > = AgentRepository.getInstance(),
    private readonly iam: Pick<AgentWorkspaceIamService, "authorizeDelete"> = AgentWorkspaceIamService.getInstance(),
    private readonly remote: Pick<AgentRuntimeGateway, "request"> = AgentRuntimeGateway.getInstance(),
    private readonly local: Pick<RootlessDockerWorkspaceProvider, "destroy"> = new RootlessDockerWorkspaceProvider(),
  ) {}
  static getInstance() {
    return (this.instance ??= new AgentWorkspaceLifecycleService());
  }

  async delete(userId: string, id: string, request?: TypedRequest) {
    const initial = await this.iam.authorizeDelete(id, userId, request);
    const claim = await this.repository.claimWorkspaceDeletion(initial.target, initial.principal.accountOwnerId);
    let runtimeReleased = false;
    try {
      const current = await this.iam.authorizeDelete(id, userId, request);
      if (!sameTarget(current.target, claim) || current.principal.accountOwnerId !== initial.principal.accountOwnerId)
        throw agentIamDenied();
      const runtime = await this.repository.readWorkspaceRuntimeTarget(claim, current.principal.accountOwnerId);
      if (
        !runtime ||
        runtime.id !== claim.id ||
        runtime.userId !== userId ||
        runtime.machineId !== claim.machineId ||
        runtime.updateTime.getTime() !== claim.updateTime.getTime()
      )
        throw agentIamDenied();
      if (runtime.runtimeHandle) {
        if (runtime.machineId) {
          if (!current.machineTarget) throw agentIamDenied();
          const machine = await this.repository.readMachineRuntimeTarget(
            current.machineTarget,
            current.principal.accountOwnerId,
          );
          if (
            !machine ||
            machine.id !== runtime.machineId ||
            machine.userId !== userId ||
            machine.status !== 1 ||
            !machine.agentId ||
            machine.agentId !== runtime.runtimeAgentId ||
            machine.runtimeStatus !== "online"
          )
            throw agentIamDenied();
          await this.remote.request(
            machine.agentId,
            { type: "workspace.destroy", requestId: randomUUID(), workspaceId: id },
            undefined,
            { machineId: machine.id, userId },
          );
        } else {
          if (!env.runtime.agentRuntimeLocal) throw new Error("Workspace runtime unavailable");
          await this.local.destroy(runtime.runtimeHandle);
        }
      }
      runtimeReleased = true;
      const final = await this.iam.authorizeDelete(id, userId, request);
      if (!sameTarget(final.target, claim) || final.principal.accountOwnerId !== initial.principal.accountOwnerId)
        throw agentIamDenied();
      await this.repository.updateWorkspaceTarget(claim, final.principal.accountOwnerId, {
        status: -1,
        runtimeStatus: "stopped",
        runtimeHandle: null,
        runtimeAgentId: null,
        lastError: null,
      });
    } catch (error) {
      try {
        await this.repository.releaseWorkspaceDeletion(claim, initial.principal.accountOwnerId, runtimeReleased);
      } catch {
        getLogger("AgentWorkspaceRuntime", LogCategory.SECURITY).warn("Workspace cleanup state unavailable", {
          reason: "runtime-cleanup-state-unavailable",
          workspaceId: id,
        });
      }
      if (error instanceof ForbiddenError) throw error;
      throw new BadRequestError("Workspace cleanup failed", undefined, { messageKey: "agent.workspaceCleanupFailed" });
    }
  }
}
