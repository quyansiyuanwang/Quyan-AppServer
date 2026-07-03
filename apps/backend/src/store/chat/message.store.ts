import type { Message } from "@prisma/client";
import type { Decimal } from "@prisma/client/runtime/library";

export interface MessageCreateInput {
  conversationId: string;
  role: string;
  content: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cost?: Decimal;
}

export interface MessageStore {
  create(data: MessageCreateInput): Promise<Message>;
  findByConversationId(conversationId: string): Promise<Message[]>;
  findById(id: string): Promise<Message | null>;
  delete(id: string): Promise<void>;
}
