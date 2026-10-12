import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { AgentRepository, PublicAgentWorkspace } from "@/store/agent/agent.repository";
import type { ModelPricingRepository } from "@/store/relay/model-pricing.repository";
import type { TypedRequest } from "@/types/express";
const mocks = vi.hoisted(() => ({ mode: "enforce", list: vi.fn(), check: vi.fn() }));
vi.mock("@/config/env", () => ({
  env: {
    security: {
      get iamAuthorizationMode() {
        return mocks.mode;
      },
    },
  },
}));
vi.mock("@/services/agent/agent-workspace-iam.service", () => ({
  AgentWorkspaceIamService: { getInstance: () => ({ list: mocks.list }) },
}));
vi.mock("@/services/agent/agent-machine-iam.service", () => ({ AgentMachineIamService: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/mcp-server-iam.service", () => ({ McpServerIamService: { getInstance: vi.fn() } }));
vi.mock("@/store/agent/agent.repository", () => ({ AgentRepository: { getInstance: vi.fn() } }));
vi.mock("@/store/relay/model-pricing.repository", () => ({ ModelPricingRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/agent-runtime.gateway", () => ({ AgentRuntimeGateway: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/workspace-runtime.service", () => ({ RootlessDockerWorkspaceProvider: class {} }));
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
beforeEach(() => {
  vi.resetAllMocks();
  mocks.mode = "enforce";
  mocks.list.mockResolvedValue([row]);
  mocks.check.mockResolvedValue({ hasPermission: true });
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
});
