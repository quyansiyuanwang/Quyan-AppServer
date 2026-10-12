import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { AgentRepository, PublicAgentWorkspace, PublicAgentMachine } from "@/store/agent/agent.repository";
import type { ModelPricingRepository } from "@/store/relay/model-pricing.repository";
import type { TypedRequest } from "@/types/express";
const mocks = vi.hoisted(() => ({
  mode: "enforce",
  list: vi.fn(),
  check: vi.fn(),
  create: vi.fn(),
  localCreate: vi.fn(),
  localDestroy: vi.fn(),
  remoteRequest: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  env: {
    runtime: { agentRuntimeLocal: false },
    security: {
      get iamAuthorizationMode() {
        return mocks.mode;
      },
    },
  },
}));
vi.mock("@/services/agent/agent-workspace-iam.service", () => ({
  AgentWorkspaceIamService: { getInstance: () => ({ list: mocks.list, authorizeCreate: mocks.create }) },
}));
vi.mock("@/services/agent/agent-machine-iam.service", () => ({ AgentMachineIamService: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/mcp-server-iam.service", () => ({ McpServerIamService: { getInstance: vi.fn() } }));
vi.mock("@/store/agent/agent.repository", () => ({ AgentRepository: { getInstance: vi.fn() } }));
vi.mock("@/store/relay/model-pricing.repository", () => ({ ModelPricingRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/agent-runtime.gateway", () => ({
  AgentRuntimeGateway: { getInstance: () => ({ request: mocks.remoteRequest }) },
}));
vi.mock("@/services/agent/workspace-runtime.service", () => ({
  RootlessDockerWorkspaceProvider: class {
    create = mocks.localCreate;
    destroy = mocks.localDestroy;
  },
}));
vi.mock("@/services/users/permission.service", () => ({
  PermissionService: { getInstance: () => ({ checkUserPermissions: mocks.check }) },
}));
vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: vi.fn() }), LogCategory: { SECURITY: "security" } }));
import { AgentService } from "@/services/agent/agent.service";
const repository = mockDeep<AgentRepository>(),
  pricing = mockDeep<ModelPricingRepository>();
const Service = AgentService as unknown as new (
  repository: AgentRepository,
  pricing: ModelPricingRepository,
) => AgentService;
const service = new Service(repository, pricing);
const request = { user: { userId: "actor", roleSessionId: "session" } } as unknown as TypedRequest;
const row: PublicAgentWorkspace = {
  id: "workspace",
  userId: "actor",
  status: 1,
  name: "fixture",
  runtime: "rootless-docker",
  runtimeStatus: "pending",
  createTime: new Date(1),
  updateTime: new Date(1),
  machineId: null,
  policy: {},
  limits: {},
};
const machineTarget = { id: "machine", userId: "actor", createTime: new Date(1), updateTime: new Date(1) };
const machine: PublicAgentMachine = {
  ...machineTarget,
  name: "private-machine",
  status: 1,
  runtime: "rootless-docker",
  runtimeStatus: "online",
  agentId: "agent-1",
  capabilities: {},
  lastHeartbeatAt: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.mode = "enforce";
  mocks.list.mockResolvedValue([row]);
  mocks.check.mockResolvedValue({ hasPermission: true });
  mocks.create.mockResolvedValue({ principal: { accountOwnerId: "owner" } });
  repository.createWorkspace.mockResolvedValue({ ...row, runtimeAgentId: null, runtimeHandle: null, lastError: null });
  repository.readMachineRuntimeTarget.mockResolvedValue(machine);
  repository.updateWorkspaceTarget.mockImplementation(async (_target, _owner, data) => ({
    ...row,
    machineId: _target.machineId,
    runtimeStatus: data.runtimeStatus as string,
    updateTime: new Date(2),
  }));
  repository.findWorkspaceById.mockResolvedValue({ ...row, machine: null });
  mocks.remoteRequest.mockResolvedValue({ ok: true, data: { handle: "runtime-handle" } });
  repository.findWorkspaces.mockResolvedValue([row as Awaited<ReturnType<AgentRepository["findWorkspaces"]>>[number]]);
});
describe("Agent workspace list rollout", () => {
  it("uses IAM filtered rows and never falls back on evaluator failure", async () => {
    expect((await service.listWorkspaces("actor", request))[0].id).toBe("workspace");
    expect(repository.findWorkspaces).not.toHaveBeenCalled();
    mocks.list.mockRejectedValue(new Error("unavailable"));
    await expect(service.listWorkspaces("actor", request)).rejects.toThrow("unavailable");
    expect(repository.findWorkspaces).not.toHaveBeenCalled();
  });
  it("keeps legacy role session checks and shadow failures cannot widen the old permission", async () => {
    for (const mode of ["legacy", "shadow"]) {
      mocks.mode = mode;
      mocks.list.mockRejectedValue(new Error("unavailable"));
      expect((await service.listWorkspaces("actor", request))[0].id).toBe("workspace");
      expect(mocks.check).toHaveBeenCalledWith("actor", expect.any(Array), { assumedRoleSessionId: "session" });
      mocks.check.mockResolvedValueOnce({ hasPermission: false });
      await expect(service.listWorkspaces("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    }
  });
  it("denies creation before database writes and runtime work", async () => {
    mocks.create.mockRejectedValue(new Error("denied"));
    await expect(service.createWorkspace("actor", { name: "fixture" }, request)).rejects.toThrow("denied");
    expect(repository.createWorkspace).not.toHaveBeenCalled();
    expect(mocks.remoteRequest).not.toHaveBeenCalled();
    expect(mocks.localCreate).not.toHaveBeenCalled();
  });
  it("passes trusted account and machine snapshots into creation and binds dispatch to that machine", async () => {
    mocks.create.mockResolvedValue({ principal: { accountOwnerId: "owner" }, machineTarget });
    repository.createWorkspace.mockResolvedValue({
      ...row,
      machineId: "machine",
      runtimeAgentId: null,
      runtimeHandle: null,
      lastError: null,
    });
    const result = await service.createWorkspace("actor", { name: " fixture ", machineId: "machine" }, request);
    expect(repository.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "actor", name: "fixture", machineId: "machine" }),
      "owner",
      machineTarget,
    );
    expect(mocks.create).toHaveBeenCalledTimes(3);
    expect(mocks.remoteRequest).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ type: "workspace.create", workspaceId: "workspace" }),
      undefined,
      { machineId: "machine", userId: "actor" },
    );
    expect(repository.updateWorkspaceTarget).toHaveBeenCalledWith(
      expect.objectContaining({ id: "workspace", machineId: "machine" }),
      "owner",
      expect.objectContaining({ runtimeStatus: "ready", runtimeHandle: "runtime-handle" }),
    );
    expect(result.machineName).toBeUndefined();
    expect(repository.findMachineForUser).not.toHaveBeenCalled();
    expect(repository.findWorkspaceById).not.toHaveBeenCalled();
  });
  it("rechecks policy revocation after database creation before runtime dispatch", async () => {
    const { ForbiddenError } = await import("@/util/errors");
    mocks.create
      .mockResolvedValueOnce({ principal: { accountOwnerId: "owner" }, machineTarget })
      .mockRejectedValueOnce(new ForbiddenError("denied"));
    await expect(
      service.createWorkspace("actor", { name: "fixture", machineId: "machine" }, request),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.createWorkspace).toHaveBeenCalledOnce();
    expect(mocks.remoteRequest).not.toHaveBeenCalled();
    expect(repository.updateWorkspaceTarget).not.toHaveBeenCalled();
  });
  it("rejects changed machine snapshots and keeps provider errors out of stored failure messages", async () => {
    mocks.create.mockResolvedValue({ principal: { accountOwnerId: "owner" }, machineTarget });
    repository.readMachineRuntimeTarget.mockResolvedValueOnce(null);
    await expect(
      service.createWorkspace("actor", { name: "fixture", machineId: "machine" }, request),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(repository.createWorkspace).not.toHaveBeenCalled();
    mocks.remoteRequest.mockRejectedValue(new Error("private-runtime-error"));
    await service.createWorkspace("actor", { name: "fixture", machineId: "machine" }, request);
    expect(repository.updateWorkspaceTarget).toHaveBeenCalledWith(expect.anything(), "owner", {
      runtimeStatus: "failed",
      lastError: "Workspace provisioning failed",
    });
  });
  it("cleans up a newly provisioned remote runtime when the guarded state write fails", async () => {
    const { ForbiddenError } = await import("@/util/errors");
    mocks.create.mockResolvedValue({ principal: { accountOwnerId: "owner" }, machineTarget });
    repository.updateWorkspaceTarget.mockRejectedValueOnce(new ForbiddenError("snapshot changed"));
    await expect(
      service.createWorkspace("actor", { name: "fixture", machineId: "machine" }, request),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.remoteRequest).toHaveBeenCalledTimes(2);
    expect(mocks.remoteRequest).toHaveBeenLastCalledWith(
      "agent-1",
      expect.objectContaining({ type: "workspace.destroy", workspaceId: "workspace" }),
      undefined,
      { machineId: "machine", userId: "actor" },
    );
  });
  it("preserves legacy creation and shadow behavior while enforcing actual machine ownership", async () => {
    for (const mode of ["legacy", "shadow"]) {
      mocks.mode = mode;
      repository.findMachineForUser.mockResolvedValue(null);
      await expect(
        service.createWorkspace("actor", { name: "fixture", machineId: "foreign" }, request),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(mocks.create).not.toHaveBeenCalled();
    }
  });
});
