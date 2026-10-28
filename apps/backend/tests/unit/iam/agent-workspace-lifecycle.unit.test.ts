import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { AgentRepository } from "@/store/agent/agent.repository";
import type { AgentWorkspaceIamService } from "@/services/agent/agent-workspace-iam.service";
import type { AgentRuntimeGateway } from "@/services/agent/agent-runtime.gateway";
import type { RootlessDockerWorkspaceProvider } from "@/services/agent/workspace-runtime.service";
import type { TypedRequest } from "@/types/express";
const config = vi.hoisted(() => ({ local: true }));
vi.mock("@/config/env", () => ({
  env: {
    runtime: {
      get agentRuntimeLocal() {
        return config.local;
      },
    },
  },
}));
vi.mock("@/store/agent/agent.repository", () => ({ AgentRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/agent-workspace-iam.service", () => ({ AgentWorkspaceIamService: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/agent-runtime.gateway", () => ({ AgentRuntimeGateway: { getInstance: vi.fn() } }));
vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: vi.fn() }), LogCategory: { SECURITY: "security" } }));
import { AgentWorkspaceLifecycleService } from "@/services/agent/agent-workspace-lifecycle.service";
import { ForbiddenError } from "@/util/errors";
const repository = mockDeep<AgentRepository>(),
  iam = mockDeep<AgentWorkspaceIamService>(),
  remote = mockDeep<AgentRuntimeGateway>(),
  local = mockDeep<RootlessDockerWorkspaceProvider>();
const Service = AgentWorkspaceLifecycleService as unknown as new (
  repository: AgentRepository,
  iam: AgentWorkspaceIamService,
  remote: AgentRuntimeGateway,
  local: RootlessDockerWorkspaceProvider,
) => AgentWorkspaceLifecycleService;
const service = new Service(repository, iam, remote, local);
const request = { user: { userId: "actor" } } as unknown as TypedRequest;
const target = {
  id: "workspace",
  userId: "actor",
  machineId: null as string | null,
  createTime: new Date(1),
  updateTime: new Date(1),
};
const claim = { ...target, updateTime: new Date(2) };
const principal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user" as const,
};
const runtime = { ...claim, runtimeHandle: "private-handle", runtimeAgentId: null as string | null };
const machineTarget = { id: "machine", userId: "actor", createTime: new Date(1), updateTime: new Date(1) };
beforeEach(() => {
  vi.resetAllMocks();
  config.local = true;
  iam.authorizeDelete.mockResolvedValue({ target: claim, principal }).mockResolvedValueOnce({ target, principal });
  repository.claimWorkspaceDeletion.mockResolvedValue(claim);
  repository.readWorkspaceRuntimeTarget.mockResolvedValue(runtime);
  repository.releaseWorkspaceDeletion.mockResolvedValue({ count: 1 });
});
describe("Agent workspace deletion authorization and runtime cleanup", () => {
  it("does not load runtime handles or mutate state after an initial denial", async () => {
    iam.authorizeDelete.mockReset().mockRejectedValue(new ForbiddenError("denied"));
    await expect(service.delete("actor", "workspace", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.claimWorkspaceDeletion).not.toHaveBeenCalled();
    expect(repository.readWorkspaceRuntimeTarget).not.toHaveBeenCalled();
    expect(local.destroy).not.toHaveBeenCalled();
  });
  it("claims a version before releasing the local runtime, then reauthorizes final deletion", async () => {
    await service.delete("actor", "workspace", request);
    expect(repository.claimWorkspaceDeletion).toHaveBeenCalledWith(target, "owner");
    expect(local.destroy).toHaveBeenCalledWith("private-handle");
    expect(repository.claimWorkspaceDeletion.mock.invocationCallOrder[0]).toBeLessThan(
      repository.readWorkspaceRuntimeTarget.mock.invocationCallOrder[0],
    );
    expect(repository.readWorkspaceRuntimeTarget.mock.invocationCallOrder[0]).toBeLessThan(
      local.destroy.mock.invocationCallOrder[0],
    );
    expect(iam.authorizeDelete).toHaveBeenCalledTimes(3);
    expect(repository.updateWorkspaceTarget).toHaveBeenCalledWith(claim, "owner", {
      status: -1,
      runtimeStatus: "stopped",
      runtimeHandle: null,
      runtimeAgentId: null,
      lastError: null,
    });
    expect(repository.releaseWorkspaceDeletion).not.toHaveBeenCalled();
  });
  it("dispatches remote cleanup exclusively to the authorized linked machine", async () => {
    const remoteClaim = { ...claim, machineId: "machine" };
    iam.authorizeDelete
      .mockReset()
      .mockResolvedValue({ target: remoteClaim, principal, machineTarget })
      .mockResolvedValueOnce({ target: { ...target, machineId: "machine" }, principal, machineTarget });
    repository.claimWorkspaceDeletion.mockResolvedValue(remoteClaim);
    repository.readWorkspaceRuntimeTarget.mockResolvedValue({
      ...runtime,
      machineId: "machine",
      runtimeAgentId: "agent-1",
    });
    repository.readMachineRuntimeTarget.mockResolvedValue({
      ...machineTarget,
      status: 1,
      name: "fixture",
      runtime: "rootless-docker",
      runtimeStatus: "online",
      agentId: "agent-1",
      capabilities: {},
      lastHeartbeatAt: null,
    });
    await service.delete("actor", "workspace", request);
    expect(remote.request).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ type: "workspace.destroy", workspaceId: "workspace" }),
      undefined,
      { machineId: "machine", userId: "actor" },
    );
    expect(local.destroy).not.toHaveBeenCalled();
  });
  it("retains a failed cleanup for retry and never reveals provider error details", async () => {
    local.destroy.mockRejectedValue(new Error("private upstream credentials"));
    await expect(service.delete("actor", "workspace", request)).rejects.toMatchObject({
      statusCode: 400,
      message: "Workspace cleanup failed",
    });
    expect(repository.updateWorkspaceTarget).not.toHaveBeenCalled();
    expect(repository.releaseWorkspaceDeletion).toHaveBeenCalledWith(claim, "owner", false);
  });
  it("does not perform cleanup after policy revocation or a changed claimed snapshot", async () => {
    iam.authorizeDelete.mockRejectedValueOnce(new ForbiddenError("denied"));
    await expect(service.delete("actor", "workspace", request)).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeDelete
      .mockReset()
      .mockResolvedValueOnce({ target, principal })
      .mockResolvedValueOnce({ target: { ...claim, machineId: "other-machine" }, principal });
    await expect(service.delete("actor", "workspace", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.readWorkspaceRuntimeTarget).not.toHaveBeenCalled();
    expect(local.destroy).not.toHaveBeenCalled();
    expect(repository.releaseWorkspaceDeletion).toHaveBeenCalledWith(claim, "owner", false);
  });
  it("records completed cleanup without deleting the resource after a final authorization revocation", async () => {
    iam.authorizeDelete
      .mockResolvedValueOnce({ target: claim, principal })
      .mockRejectedValueOnce(new ForbiddenError("revoked"));
    await expect(service.delete("actor", "workspace", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(local.destroy).toHaveBeenCalled();
    expect(repository.updateWorkspaceTarget).not.toHaveBeenCalled();
    expect(repository.releaseWorkspaceDeletion).toHaveBeenCalledWith(claim, "owner", true);
  });
  it("rejects runtime snapshot substitution and disabled local execution", async () => {
    repository.readWorkspaceRuntimeTarget.mockResolvedValueOnce({ ...runtime, userId: "foreign" });
    await expect(service.delete("actor", "workspace", request)).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeDelete.mockResolvedValueOnce({ target, principal });
    config.local = false;
    await expect(service.delete("actor", "workspace", request)).rejects.toMatchObject({ statusCode: 400 });
    expect(local.destroy).not.toHaveBeenCalled();
    expect(repository.updateWorkspaceTarget).not.toHaveBeenCalled();
  });
  it("can delete an unprovisioned workspace without contacting a runtime", async () => {
    repository.readWorkspaceRuntimeTarget.mockResolvedValue({ ...runtime, runtimeHandle: null });
    await service.delete("actor", "workspace", request);
    expect(local.destroy).not.toHaveBeenCalled();
    expect(remote.request).not.toHaveBeenCalled();
    expect(repository.updateWorkspaceTarget).toHaveBeenCalled();
  });
});
