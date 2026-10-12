import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { AgentRepository, PublicAgentMachine } from "@/store/agent/agent.repository";
import type { ModelPricingRepository } from "@/store/relay/model-pricing.repository";
import type { TypedRequest } from "@/types/express";
const mocks = vi.hoisted(() => ({
  mode: "enforce",
  list: vi.fn(),
  create: vi.fn(),
  check: vi.fn(),
  target: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  env: {
    security: {
      get iamAuthorizationMode() {
        return mocks.mode;
      },
    },
    integrations: { developerProduct: { secretsMasterKey: "fixture-only-encryption-key-not-for-production" } },
  },
}));
vi.mock("@/services/agent/agent-machine-iam.service", () => ({
  AgentMachineIamService: {
    getInstance: () => ({ list: mocks.list, authorizeCreate: mocks.create, authorizeTarget: mocks.target }),
  },
}));
vi.mock("@/store/agent/agent.repository", () => ({ AgentRepository: { getInstance: vi.fn() } }));
vi.mock("@/store/relay/model-pricing.repository", () => ({ ModelPricingRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/agent-runtime.gateway", () => ({
  AgentRuntimeGateway: { getInstance: () => ({ revokeMachine: mocks.revoke }) },
}));
vi.mock("@/services/agent/workspace-runtime.service", () => ({ RootlessDockerWorkspaceProvider: class {} }));
vi.mock("@/services/users/permission.service", () => ({
  PermissionService: { getInstance: () => ({ checkUserPermissions: mocks.check }) },
}));
vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: vi.fn() }), LogCategory: { SECURITY: "security" } }));
vi.mock("@/services/agent/mcp-server-iam.service", () => ({ McpServerIamService: { getInstance: vi.fn() } }));
import { AgentService } from "@/services/agent/agent.service";
const repository = mockDeep<AgentRepository>(),
  pricing = mockDeep<ModelPricingRepository>();
const Service = AgentService as unknown as new (
  repository: AgentRepository,
  pricing: ModelPricingRepository,
) => AgentService;
const service = new Service(repository, pricing);
const request = { user: { userId: "actor", roleSessionId: "session" } } as unknown as TypedRequest;
const row: PublicAgentMachine = {
  id: "machine",
  userId: "actor",
  name: "fixture",
  status: 1,
  runtime: "rootless-docker",
  runtimeStatus: "pending",
  agentId: null,
  capabilities: {},
  lastHeartbeatAt: null,
  createTime: new Date(),
  updateTime: new Date(),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.mode = "enforce";
  mocks.check.mockResolvedValue({ hasPermission: true });
  repository.listMachines.mockResolvedValue([row]);
  repository.createMachine.mockResolvedValue(row);
});
describe("Agent machine rollout and registration safety", () => {
  it("does not fall back to legacy reads or credential writes after an enforce denial", async () => {
    mocks.list.mockRejectedValue(new Error("denied"));
    await expect(service.listMachines("actor", request)).rejects.toThrow("denied");
    expect(repository.listMachines).not.toHaveBeenCalled();
    mocks.create.mockRejectedValue(new Error("denied"));
    await expect(service.createMachine("actor", { name: "fixture" }, request)).rejects.toThrow("denied");
    expect(repository.createMachine).not.toHaveBeenCalled();
  });
  it("keeps legacy checks and actual role sessions in legacy and shadow modes", async () => {
    for (const mode of ["legacy", "shadow"]) {
      mocks.mode = mode;
      mocks.list.mockRejectedValue(new Error("unavailable"));
      expect((await service.listMachines("actor", request))[0].id).toBe("machine");
      expect(mocks.check).toHaveBeenCalledWith("actor", expect.any(Array), { assumedRoleSessionId: "session" });
      mocks.check.mockResolvedValueOnce({ hasPermission: false });
      await expect(service.listMachines("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    }
  });
  it("stores a token hash under the trusted account and returns the token only at creation", async () => {
    mocks.create.mockResolvedValue({ accountOwnerId: "owner" });
    const result = await service.createMachine("actor", { name: "fixture" }, request);
    const [data, owner] = repository.createMachine.mock.calls[0];
    expect(owner).toBe("owner");
    expect(result.registrationToken).toBeTruthy();
    expect(data.registrationHash).toBe(createHash("sha256").update(result.registrationToken!).digest("hex"));
    expect(result).not.toHaveProperty("registrationHash");
    mocks.list.mockResolvedValue([row]);
    expect((await service.listMachines("actor", request))[0]).not.toHaveProperty("registrationToken");
  });
  it("does not mutate a machine after an enforce target denial", async () => {
    mocks.target.mockRejectedValue(new Error("denied"));
    await expect(service.deleteMachine("actor", "machine", request)).rejects.toThrow("denied");
    expect(repository.deleteMachineTarget).not.toHaveBeenCalled();
    expect(repository.updateMachine).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("preserves legacy owner checks and uses fresh account snapshots in enforce", async () => {
    const target = { id: "machine", userId: "actor", createTime: row.createTime, updateTime: row.updateTime };
    mocks.target.mockResolvedValue({ target, principal: { accountOwnerId: "owner" } });
    await service.deleteMachine("actor", "machine", request);
    expect(mocks.revoke).toHaveBeenCalledWith("machine");
    expect(repository.deleteMachineTarget).toHaveBeenCalledWith(target, "owner");
    mocks.mode = "legacy";
    mocks.revoke.mockClear();
    repository.findMachineForUser.mockResolvedValue(null);
    await expect(service.deleteMachine("actor", "machine", request)).rejects.toMatchObject({ statusCode: 404 });
    expect(repository.updateMachine).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
});
