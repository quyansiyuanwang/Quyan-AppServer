import { describe, expect, it, vi } from "vitest";
import { ChatController } from "../../../src/api/controllers/v1/chat/chat.controller";
import type { TypedRequest } from "../../../src/types/express";

const completeMessage = {
  id: "message-1",
  conversationId: "conversation-1",
  role: "assistant",
  content: "answer",
  model: "gpt-4o-mini",
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  completionStatus: "completed",
  createTime: "2026-01-01T00:00:00.000Z",
};

async function* chatEvents() {
  yield { type: "delta" as const, content: "answer", done: false as const };
  yield { type: "complete" as const, message: completeMessage, done: true as const };
}

const createResponse = () => ({
  writableEnded: false,
  destroyed: false,
  locals: {},
  once: vi.fn(),
  off: vi.fn(),
});

const createRequest = (res: ReturnType<typeof createResponse>): TypedRequest =>
  ({
    user: { userId: "user-1" },
    res,
    path: "/v1/chat/conversations/conversation-1/messages",
    method: "POST",
    ip: "127.0.0.1",
    headers: {},
    connection: { remoteAddress: "127.0.0.1" },
    once: vi.fn(),
    off: vi.fn(),
  }) as unknown as TypedRequest;

describe("ChatController streaming", () => {
  it("writes typed chat events followed by transport completion", async () => {
    const res = createResponse();
    const request = createRequest(res);
    const chatService = { sendMessage: vi.fn(() => chatEvents()) };
    const sseService = {
      initStream: vi.fn(),
      sendChunk: vi.fn(),
      sendDone: vi.fn(),
      sendError: vi.fn(),
      endStream: vi.fn(),
    };
    const controller = new ChatController() as unknown as {
      chatService: typeof chatService;
      sseService: typeof sseService;
      sendMessage: ChatController["sendMessage"];
    };
    controller.chatService = chatService;
    controller.sseService = sseService;

    await controller.sendMessage("conversation-1", { content: "hello", model: "gpt-4o-mini" }, request);

    expect(sseService.sendChunk).toHaveBeenNthCalledWith(1, res, {
      type: "delta",
      content: "answer",
      done: false,
    });
    expect(sseService.sendChunk).toHaveBeenNthCalledWith(2, res, {
      type: "complete",
      message: completeMessage,
      done: true,
    });
    expect(sseService.sendChunk).toHaveBeenNthCalledWith(3, res, { type: "done", done: true });
    expect(sseService.sendDone).toHaveBeenCalledWith(res);
    expect(sseService.endStream).toHaveBeenCalledWith(res);
  });

  it("aborts the provider request and writes no terminal frames after a client disconnect", async () => {
    const res = createResponse();
    res.once.mockImplementation((event: string, listener: () => void) => {
      if (event === "close") {
        res.destroyed = true;
        listener();
      }
      return res;
    });
    const request = createRequest(res);
    const chatService = { sendMessage: vi.fn(() => chatEvents()) };
    const sseService = {
      initStream: vi.fn(),
      sendChunk: vi.fn(),
      sendDone: vi.fn(),
      sendError: vi.fn(),
      endStream: vi.fn(),
    };
    const controller = new ChatController() as unknown as {
      chatService: typeof chatService;
      sseService: typeof sseService;
      sendMessage: ChatController["sendMessage"];
    };
    controller.chatService = chatService;
    controller.sseService = sseService;

    await controller.sendMessage("conversation-1", { content: "hello", model: "gpt-4o-mini" }, request);

    expect(chatService.sendMessage).toHaveBeenCalledWith(
      "conversation-1",
      "user-1",
      "hello",
      "gpt-4o-mini",
      undefined,
      expect.objectContaining({ signal: expect.objectContaining({ aborted: true }) }),
      undefined,
    );
    expect(sseService.sendChunk).not.toHaveBeenCalled();
    expect(sseService.sendDone).not.toHaveBeenCalled();
    expect(sseService.sendError).not.toHaveBeenCalled();
    expect(sseService.endStream).not.toHaveBeenCalled();
  });
});
