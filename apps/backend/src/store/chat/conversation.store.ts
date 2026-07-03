import type { Conversation } from "@prisma/client";

export interface ConversationListResult {
  conversations: Conversation[];
  total: number;
}

export interface ConversationStore {
  create(userId: string, title?: string, relayTokenId?: string): Promise<Conversation>;
  findById(id: string): Promise<Conversation | null>;
  findByUserId(userId: string, page?: number, pageSize?: number): Promise<ConversationListResult>;
  update(id: string, data: { title?: string; relayTokenId?: string }): Promise<Conversation>;
  delete(id: string): Promise<void>;
}
