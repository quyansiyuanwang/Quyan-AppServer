import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TypedRequest } from "@/types/express";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  authorize: vi.fn(),
  init: vi.fn(),
  chunk: vi.fn(),
  done: vi.fn(),
  end: vi.fn(),
}));
vi.mock("@/services/agent/agent.service", () => ({
  AgentService: { getInstance: () => ({ listEvents: mocks.list, assertTaskEventsAuthorized: mocks.authorize }) },
}));
vi.mock("@/util/streaming/sse", () => ({
  SSEStreamService: {
    getInstance: () => ({ initStream: mocks.init, sendChunk: mocks.chunk, sendDone: mocks.done, endStream: mocks.end }),
  },
}));
vi.mock("@/util/permission/permission-decorator", () => ({
  CheckPermission: () => () => {},
  RequirePermission: () => () => {},
  PermissionCheckMode: { ALL: "ALL" },
}));
vi.mock("@/iam/middleware/iam-authorization.middleware", () => ({
  iamCollectionAuthorizationMiddleware: () => () => {},
}));
vi.mock("@/util/replay-protected-decorator", () => ({
  ReplayProtected: () => () => {},
  replayProtectionMiddleware: () => {},
}));
vi.mock("@/middleware/validation", () => ({ validateBody: () => () => {} }));
vi.mock("@/iam/request/agent-resource-resolvers", () => ({
  agentMachineResourceResolver: vi.fn(),
  agentWorkspaceResourceResolver: vi.fn(),
  agentTaskResourceResolver: vi.fn(),
  agentApprovalResourcesResolver: vi.fn(),
}));
import { AgentController } from "@/api/controllers/v1/agent/agent.controller";
const event = (sequence: number) => ({
  sequence,
  eventType: "assistant_delta",
  payload: { type: "assistant_delta", content: "private" },
});
const request = () =>
  ({
    user: { userId: "actor" },
    res: { locals: {}, writableEnded: false, destroyed: false },
  }) as unknown as TypedRequest;
beforeEach(() => {
  vi.resetAllMocks();
});
describe("Agent event stream authorization lifecycle", () => {
  it("rejects initial authorization before committing SSE response headers", async () => {
    mocks.list.mockRejectedValue(new Error("denied"));
    await expect(new AgentController().streamEvents("task", 0, request())).rejects.toThrow("denied");
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.chunk).not.toHaveBeenCalled();
  });
  it("reauthorizes each event after backpressure and stops on revocation", async () => {
    mocks.list.mockResolvedValue([event(1), event(2)]);
    mocks.authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked"));
    await expect(new AgentController().streamEvents("task", 0, request())).rejects.toThrow("revoked");
    expect(mocks.chunk).toHaveBeenCalledTimes(1);
    expect(mocks.chunk).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sequence: 1 }));
    expect(mocks.end).toHaveBeenCalled();
    expect(mocks.done).not.toHaveBeenCalled();
  });
  it("passes trusted request context and preserves terminal event completion", async () => {
    const req = request();
    mocks.list.mockResolvedValue([{ ...event(1), eventType: "complete" }]);
    await new AgentController().streamEvents("task", 0, req);
    expect(mocks.list).toHaveBeenCalledWith("actor", "task", 0, req);
    expect(mocks.authorize).toHaveBeenCalledWith("actor", "task", req);
    expect(mocks.done).toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalled();
  });
});
