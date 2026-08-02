export interface CreateConversationRequest {
  title?: string;
  relayTokenId?: string;
}

export interface UpdateConversationRequest {
  title?: string;
  relayTokenId?: string;
}

export interface SendMessageRequest {
  content: string;
  model: string;
  relayTokenId?: string;
  replaceMessageId?: string;
}

export interface ConversationResponse {
  id: string;
  userId: string;
  title: string | null;
  relayTokenId: string | null;
  messageCount: number;
  lastMessageTime?: Date;
  createTime: Date;
  updateTime: Date;
}

export interface MessageResponse {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cost?: number | null;
  completionStatus: string;
  createTime: Date;
}

export interface ChatTokenResponse {
  id: string;
  name: string | null;
  token: string;
  allowedModels: string | null;
}
