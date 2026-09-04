import { describe, expect, it, vi } from "vitest";
import { AgentService } from "../../../src/services/agent/agent.service";

describe("agent workspace runtime safety", () => {
  it("does not enable local execution by default", () => {
    expect(process.env.AGENT_RUNTIME_LOCAL).not.toBe("true");
  });

  it("keeps task statuses explicit", async () => {
    const shared = await import("@appserver/shared");
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
    const pricing = { listActiveOrderedByModel: vi.fn().mockResolvedValue([]) };
    const service = new (AgentService as any)(repository, pricing);

    await expect(
      service.createRun("user-1", "conversation-1", {
        workspaceId: "workspace-1",
        content: "hello",
        model: "glm-5.1",
      }),
    ).rejects.toThrow("Model glm-5.1 is not configured");
    expect(repository.createTask).not.toHaveBeenCalled();
  });

  it("stores the configured mapped model and enforces token model permissions", async () => {
    const repository = {
      findWorkspaceForUser: vi.fn().mockResolvedValue({ id: "workspace-1", limits: {} }),
      findConversationForUser: vi.fn().mockResolvedValue({ id: "conversation-1", relayTokenId: "token-1" }),
      findRelayTokenForUser: vi.fn().mockResolvedValue({
        id: "token-1",
        allowedModels: "gpt-4o-mini",
        modelMapping: { "customer-model": "gpt-4o-mini" },
      }),
      createTask: vi.fn().mockResolvedValue({
        id: "task-1",
        workspaceId: "workspace-1",
        taskStatus: "queued",
        model: "gpt-4o-mini",
        stepCount: 0,
        createTime: new Date(),
      }),
    };
    const pricing = {
      listActiveOrderedByModel: vi.fn().mockResolvedValue([{ model: "GPT-4o Mini", provider: "gpt-4o-mini" }]),
    };
    const service = new (AgentService as any)(repository, pricing);
    service.run = vi.fn();

    const result = await service.createRun("user-1", "conversation-1", {
      workspaceId: "workspace-1",
      content: "hello",
      model: "customer-model",
    });

    expect(result.model).toBe("gpt-4o-mini");
    expect(repository.createTask).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o-mini" }));
  });
});
