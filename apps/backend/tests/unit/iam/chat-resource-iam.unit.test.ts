import { beforeEach, describe, expect, it, vi } from "vitest";

const { findConversation, findMessage } = vi.hoisted(() => ({
  findConversation: vi.fn(),
  findMessage: vi.fn(),
}));
vi.mock("@/store/chat/conversation.repository", () => ({
  ConversationRepository: { getInstance: () => ({ findById: findConversation }) },
}));
vi.mock("@/store/chat/message.repository", () => ({
  MessageRepository: { getInstance: () => ({ findById: findMessage }) },
}));

import { getIamActionDefinition } from "@quyan/shared";
import { chatConversationResourceResolver, chatMessageResourceResolver } from "@/iam/request/chat-resource-resolvers";
import type { TypedRequest } from "@/types/express";

const principal = {
  subjectUserId: "user-1",
  principalUserId: "user-1",
  accountOwnerId: "account-1",
  subjectType: "sub_user" as const,
};
const request = (params: Record<string, string>) => ({ params }) as unknown as TypedRequest;

beforeEach(() => {
  vi.clearAllMocks();
  findConversation.mockResolvedValue({ id: "conversation-1", userId: "user-1" });
  findMessage.mockResolvedValue({ id: "message-1", conversationId: "conversation-1" });
});

describe("chat IAM resource contract", () => {
  it("resolves only conversations owned by the authenticated subject", async () => {
    await expect(
      chatConversationResourceResolver({ request: request({ conversationId: "conversation-1" }), principal }),
    ).resolves.toBe("acs:chat:*:account-1:conversation/conversation-1");
    findConversation.mockResolvedValueOnce({ id: "conversation-1", userId: "user-2" });
    await expect(
      chatConversationResourceResolver({ request: request({ conversationId: "conversation-1" }), principal }),
    ).resolves.toBeUndefined();
  });

  it("resolves a message only through its owned conversation", async () => {
    await expect(
      chatMessageResourceResolver({ request: request({ messageId: "message-1" }), principal }),
    ).resolves.toBe("acs:chat:*:account-1:message/message-1");
    findConversation.mockResolvedValueOnce({ id: "conversation-1", userId: "user-2" });
    await expect(
      chatMessageResourceResolver({ request: request({ messageId: "message-1" }), principal }),
    ).resolves.toBeUndefined();
  });

  it("registers chat actions against their actual resource kinds", () => {
    expect(getIamActionDefinition("quyan:chat:GetConversation")).toMatchObject({
      resourceTypes: ["chat/conversation"],
    });
    expect(getIamActionDefinition("quyan:chat:DeleteMessage")).toMatchObject({
      resourceTypes: ["chat/message"],
    });
    expect(getIamActionDefinition("quyan:chat:CreateConversation")).toMatchObject({
      resourceTypes: ["quyan/user"],
    });
  });
});
