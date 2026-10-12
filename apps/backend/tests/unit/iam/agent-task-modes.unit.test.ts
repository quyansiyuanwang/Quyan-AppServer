import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { AgentRepository } from "@/store/agent/agent.repository";
import type { ModelPricingRepository } from "@/store/relay/model-pricing.repository";
import type { TypedRequest } from "@/types/express";
const mocks = vi.hoisted(() => ({
  mode: "enforce",
  events: vi.fn(),
  cancel: vi.fn(),
  authorize: vi.fn(),
  check: vi.fn(),
  warn: vi.fn(),
  approvals: vi.fn(),
  decide: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  env: {
    security: {
      get iamAuthorizationMode() {
        return mocks.mode;
      },
    },
  },
}));
vi.mock("@/services/agent/agent-task-iam.service", () => ({
  AgentTaskIamService: {
    getInstance: () => ({ listEvents: mocks.events, cancel: mocks.cancel, authorize: mocks.authorize }),
  },
}));
vi.mock("@/services/agent/agent-machine-iam.service", () => ({ AgentMachineIamService: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/agent-workspace-iam.service", () => ({ AgentWorkspaceIamService: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/agent-workspace-lifecycle.service", () => ({
  AgentWorkspaceLifecycleService: { getInstance: vi.fn() },
}));
vi.mock("@/services/agent/mcp-server-iam.service", () => ({ McpServerIamService: { getInstance: vi.fn() } }));
vi.mock("@/store/agent/agent.repository", () => ({ AgentRepository: { getInstance: vi.fn() } }));
vi.mock("@/store/relay/model-pricing.repository", () => ({ ModelPricingRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/agent-runtime.gateway", () => ({ AgentRuntimeGateway: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/workspace-runtime.service", () => ({ RootlessDockerWorkspaceProvider: class {} }));
vi.mock("@/services/users/permission.service", () => ({
  PermissionService: { getInstance: () => ({ checkUserPermissions: mocks.check }) },
}));
vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: mocks.warn }), LogCategory: { SECURITY: "security" } }));
vi.mock("@/services/agent/agent-approval-iam.service", () => ({
  AgentApprovalIamService: { getInstance: () => ({ list: mocks.approvals, decide: mocks.decide }) },
}));
import { AgentService } from "@/services/agent/agent.service";
const repository = mockDeep<AgentRepository>(),
  pricing = mockDeep<ModelPricingRepository>();
const Service = AgentService as unknown as new (
  repository: AgentRepository,
  pricing: ModelPricingRepository,
) => AgentService;
const service = new Service(repository, pricing);
const request = () => ({ user: { userId: "actor", roleSessionId: "session" } }) as unknown as TypedRequest;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.mode = "enforce";
  mocks.events.mockResolvedValue([]);
  mocks.check.mockResolvedValue({ hasPermission: true });
  repository.listEvents.mockResolvedValue([]);
  repository.findTaskForUser.mockResolvedValue({ id: "task", userId: "actor" } as Awaited<
    ReturnType<AgentRepository["findTaskForUser"]>
  >);
});
describe("Agent task event and cancellation modes", () => {
  it("enforces task IAM and never falls back to unscoped reads or writes", async () => {
    const req = request();
    await service.listEvents("actor", "task", 0, req);
    await service.cancelRun("actor", "task", req);
    expect(mocks.events).toHaveBeenCalledWith("actor", "task", 0, req);
    expect(mocks.cancel).toHaveBeenCalledWith("actor", "task", req);
    mocks.events.mockRejectedValue(new Error("denied"));
    mocks.cancel.mockRejectedValue(new Error("denied"));
    await expect(service.listEvents("actor", "task", 0, req)).rejects.toThrow("denied");
    await expect(service.cancelRun("actor", "task", req)).rejects.toThrow("denied");
    expect(repository.listEvents).not.toHaveBeenCalled();
    expect(repository.updateTask).not.toHaveBeenCalled();
  });
  it("rechecks live IAM permission before every streamed event", async () => {
    const req = request();
    await service.assertTaskEventsAuthorized("actor", "task", req);
    expect(mocks.authorize).toHaveBeenCalledWith("task", "actor", "quyan:agent:GetTaskEvents", req);
    mocks.authorize.mockRejectedValue(new Error("revoked"));
    await expect(service.assertTaskEventsAuthorized("actor", "task", req)).rejects.toThrow("revoked");
  });
  it("preserves legacy role session permission and shadow failures cannot override rejection", async () => {
    for (const mode of ["legacy", "shadow"]) {
      mocks.mode = mode;
      mocks.authorize.mockRejectedValue(new Error("unavailable"));
      expect(await service.listEvents("actor", "task", 0, request())).toEqual([]);
      expect(mocks.check).toHaveBeenCalledWith("actor", expect.any(Array), { assumedRoleSessionId: "session" });
      mocks.check.mockResolvedValueOnce({ hasPermission: false });
      await expect(service.listEvents("actor", "task", 0, request())).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(mocks.warn).toHaveBeenCalledWith("Task events shadow evaluation failed", {
      reason: "iam-events-unavailable",
    });
  });
  it("enforces approval resource checks before tool-call hydration and decision mutation", async () => {
    mocks.approvals.mockResolvedValue([]);
    await expect(service.getApprovals("actor", "task", request())).resolves.toEqual([]);
    mocks.approvals.mockRejectedValue(new Error("denied"));
    mocks.decide.mockRejectedValue(new Error("denied"));
    await expect(service.getApprovals("actor", "task", request())).rejects.toThrow("denied");
    await expect(service.decideApproval("actor", "task", "approval", "approved", request())).rejects.toThrow("denied");
    expect(repository.listPendingApprovals).not.toHaveBeenCalled();
    expect(repository.updateApproval).not.toHaveBeenCalled();
    expect(repository.updateTask).not.toHaveBeenCalled();
  });
});
