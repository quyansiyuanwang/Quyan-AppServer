import { describe, expect, it, vi } from "vitest";
import { AgentService } from "../../../src/services/agent/agent.service";

describe("agent workspace runtime safety", () => {
  it("does not enable local execution by default", () => {
    expect(process.env.AGENT_RUNTIME_LOCAL).not.toBe("true");
  });

  it("keeps task statuses explicit", async () => {
    const shared = await import("@quyan/shared");
    expect(shared).toBeDefined();
    expect(["queued", "running", "waiting_approval", "completed", "failed", "cancelled", "expired"]).toContain(
      "waiting_approval",
    );
  });

  it("rejects an agent run for a model that is not configured", async () => {
    const repository = {
      findWorkspaceForUser: vi.fn().mockResolvedValue({ id: "workspace-1", limits: {} }),
      findConversationForUser: vi.fn().mockResolvedValue({ id: "conversation-1", relayTokenId: "token-1" }),
      findRelayTokenForUser: vi.fn().mockResolvedValue({ id: "token-1", allowedModels: null, modelMapping: null }),
      createTask: vi.fn(),
    };
    const relayProxy = { canServeRequestedModel: vi.fn().mockResolvedValue(false) };
    const service = new (AgentService as any)(repository, relayProxy);

    await expect(
      service.createRun("user-1", "conversation-1", {
        workspaceId: "workspace-1",
        content: "hello",
        model: "glm-5.1",
      }),
    ).rejects.toThrow("Model glm-5.1 is not configured");
    expect(relayProxy.canServeRequestedModel).toHaveBeenCalledWith("token-1", "glm-5.1");
    expect(repository.createTask).not.toHaveBeenCalled();
  });

  it.each(["channel-configs", "composite"])(
    "preserves the requested alias for %s route execution",
    async (routingMode) => {
      const repository = {
        findWorkspaceForUser: vi.fn().mockResolvedValue({ id: "workspace-1", limits: {} }),
        findConversationForUser: vi.fn().mockResolvedValue({ id: "conversation-1", relayTokenId: "token-1" }),
        findRelayTokenForUser: vi.fn().mockResolvedValue({
          id: "token-1",
          routingMode,
          allowedModels: "customer-model",
          modelMapping: null,
        }),
        createTask: vi.fn().mockResolvedValue({
          id: "task-1",
          workspaceId: "workspace-1",
          taskStatus: "queued",
          model: "customer-model",
          stepCount: 0,
          createTime: new Date(),
        }),
      };
      const relayProxy = { canServeRequestedModel: vi.fn().mockResolvedValue(true) };
      const service = new (AgentService as any)(repository, relayProxy);
      service.run = vi.fn().mockResolvedValue(undefined);

      const result = await service.createRun("user-1", "conversation-1", {
        workspaceId: "workspace-1",
        content: "hello",
        model: " customer-model ",
      });

      expect(result.model).toBe("customer-model");
      expect(relayProxy.canServeRequestedModel).toHaveBeenCalledWith("token-1", "customer-model");
      expect(repository.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ model: "customer-model" }),
        undefined,
        undefined,
      );
    },
  );
});
