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
  completionStatus?: "completed" | "stopped" | "failed";
}

export interface MessageStore {
  getContextSize(
    conversationId: string,
    before?: { id: string; createTime: Date },
  ): Promise<{ count: number; bytes: number }>;
  findContext(conversationId: string, maxMessages: number): Promise<Array<Pick<Message, "role" | "content">>>;
  create(data: MessageCreateInput): Promise<Message>;
  findByConversationId(conversationId: string): Promise<Message[]>;
  findById(id: string): Promise<Message | null>;
  update(id: string, data: Partial<Pick<MessageCreateInput, "content" | "completionStatus">>): Promise<Message>;
  replaceFrom(messageId: string, content: string): Promise<Message>;
  delete(id: string): Promise<void>;
  deleteFrom(messageId: string): Promise<void>;
}
