import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { AgentRepository, PublicMcpServer } from "@/store/agent/agent.repository";
import type { ModelPricingRepository } from "@/store/relay/model-pricing.repository";
import type { TypedRequest } from "@/types/express";
const mocks = vi.hoisted(() => ({ mode: "enforce", list: vi.fn(), create: vi.fn(), check: vi.fn() }));
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
vi.mock("@/services/agent/mcp-server-iam.service", () => ({
  McpServerIamService: { getInstance: () => ({ list: mocks.list, authorizeCreate: mocks.create }) },
}));
vi.mock("@/store/agent/agent.repository", () => ({ AgentRepository: { getInstance: vi.fn() } }));
vi.mock("@/store/relay/model-pricing.repository", () => ({ ModelPricingRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/agent-runtime.gateway", () => ({ AgentRuntimeGateway: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/workspace-runtime.service", () => ({ RootlessDockerWorkspaceProvider: class {} }));
vi.mock("@/services/users/permission.service", () => ({
  PermissionService: { getInstance: () => ({ checkUserPermissions: mocks.check }) },
}));
vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: vi.fn() }), LogCategory: { SECURITY: "security" } }));
vi.mock("@/services/agent/agent-machine-iam.service", () => ({ AgentMachineIamService: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/agent-workspace-iam.service", () => ({ AgentWorkspaceIamService: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/agent-task-iam.service", () => ({ AgentTaskIamService: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/agent-approval-iam.service", () => ({ AgentApprovalIamService: { getInstance: vi.fn() } }));
import { AgentService } from "@/services/agent/agent.service";
const repository = mockDeep<AgentRepository>(),
  pricing = mockDeep<ModelPricingRepository>();
const Service = AgentService as unknown as new (
  repository: AgentRepository,
  pricing: ModelPricingRepository,
) => AgentService;
const service = new Service(repository, pricing);
const request = { user: { userId: "actor", roleSessionId: "session" } } as unknown as TypedRequest;
const row: PublicMcpServer = {
  id: "server",
  userId: "actor",
  status: 1,
  name: "fixture",
  endpoint: "https://fixture.invalid/mcp",
  transport: "sse",
  enabled: true,
  toolAllowlist: [],
  metadata: {},
  agentId: null,
  createTime: new Date(),
  updateTime: new Date(),
  credential: { id: "marker" },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.mode = "enforce";
  mocks.check.mockResolvedValue({ hasPermission: true });
  repository.findMcpServers.mockResolvedValue([row]);
  repository.createMcpServer.mockResolvedValue(row);
});
describe("MCP rollout and credential safety", () => {
  it("does not fall back to legacy reads or credential writes after an enforce denial", async () => {
    mocks.list.mockRejectedValue(new Error("denied"));
    await expect(service.listMcpServers("actor", request)).rejects.toThrow("denied");
    expect(repository.findMcpServers).not.toHaveBeenCalled();
    mocks.create.mockRejectedValue(new Error("denied"));
    await expect(
      service.createMcpServer("actor", { name: "fixture", credential: { token: "fixture-secret" } }, request),
    ).rejects.toThrow("denied");
    expect(repository.createMcpServer).not.toHaveBeenCalled();
  });
  it("keeps legacy checks and actual role sessions in legacy and shadow modes", async () => {
    for (const mode of ["legacy", "shadow"]) {
      mocks.mode = mode;
      mocks.list.mockRejectedValue(new Error("unavailable"));
      expect((await service.listMcpServers("actor", request))[0].hasCredential).toBe(true);
      expect(mocks.check).toHaveBeenCalledWith("actor", expect.any(Array), { assumedRoleSessionId: "session" });
      mocks.check.mockResolvedValueOnce({ hasPermission: false });
      await expect(service.listMcpServers("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    }
  });
  it("stores only encrypted credentials under the trusted account and never returns them", async () => {
    mocks.create.mockResolvedValue({ accountOwnerId: "owner" });
    const result = await service.createMcpServer(
      "actor",
      { name: "fixture", credential: { token: "fixture-secret" } },
      request,
    );
    const [data, owner] = repository.createMcpServer.mock.calls[0];
    expect(owner).toBe("owner");
    expect(data.credential?.create.ciphertext).not.toContain("fixture-secret");
    expect(data.credential?.create.iv).toBeTruthy();
    expect(data.credential?.create.authTag).toBeTruthy();
    expect(result).toMatchObject({ id: "server", hasCredential: true });
    expect(result).not.toHaveProperty("credential");
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
  });
});
