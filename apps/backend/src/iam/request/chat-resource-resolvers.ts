import { ConversationRepository } from "@/store/chat/conversation.repository";
import { MessageRepository } from "@/store/chat/message.repository";
import { chatConversationArn, chatMessageArn } from "../resources/chat-resources";
import type { ResourceResolver } from "./resource-resolvers";

const conversations = ConversationRepository.getInstance();
const messages = MessageRepository.getInstance();

function id(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

export const chatConversationResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const conversationId = id(request.params.conversationId);
  if (!conversationId) return undefined;
  const conversation = await conversations.findById(conversationId);
  return conversation?.userId === principal.subjectUserId
    ? chatConversationArn(principal.accountOwnerId, conversationId)
    : undefined;
};

export const chatMessageResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const messageId = id(request.params.messageId);
  if (!messageId) return undefined;
  const message = await messages.findById(messageId);
  if (!message) return undefined;
  const conversation = await conversations.findById(message.conversationId);
  return conversation?.userId === principal.subjectUserId
    ? chatMessageArn(principal.accountOwnerId, messageId)
    : undefined;
};
