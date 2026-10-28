import { buildAcsResource } from "@quyan/shared";

const identifier = (value: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function chatConversationArn(accountOwnerId: string, conversationId: string): string {
  if (!identifier(conversationId)) throw new Error("Invalid chat conversation identifier");
  return buildAcsResource({
    service: "chat",
    region: "*",
    accountId: accountOwnerId,
    path: `conversation/${conversationId}`,
  });
}

export function chatMessageArn(accountOwnerId: string, messageId: string): string {
  if (!identifier(messageId)) throw new Error("Invalid chat message identifier");
  return buildAcsResource({
    service: "chat",
    region: "*",
    accountId: accountOwnerId,
    path: `message/${messageId}`,
  });
}
