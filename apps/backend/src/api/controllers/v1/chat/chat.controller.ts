import {
  Middlewares,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Route,
  Tags,
  Security,
  Request,
  Path,
  Body,
  Query,
} from "@tsoa/runtime";
import { ChatService } from "@/services/chat/chat.service";
import { SSEStreamService } from "@/util/streaming/sse";
import type { TypedRequest } from "@/types/express";
import type {
  CreateConversationRequest,
  UpdateConversationRequest,
  SendMessageRequest,
  ConversationResponse,
  MessageResponse,
  ChatTokenResponse,
} from "@/api/dto/chat/chat.dto";
import type { SuccessResponse } from "@/api/response";
import { skipResponseWrapper } from "@/util/response-wrapper";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";
import type { ChatStreamEvent } from "@quyan/shared";

@Route("v1/chat")
@Tags("Chat")
export class ChatController extends Controller {
  private chatService = ChatService.getInstance();
  private sseService = SSEStreamService.getInstance();

  @Post("conversations")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  public async createConversation(
    @Body() body: CreateConversationRequest,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<ConversationResponse>> {
    const userId = request.user?.userId;
    const conversation = await this.chatService.createConversation(userId!, body.title, body.relayTokenId);
    return { code: 0, message: "Success", data: { ...conversation, messageCount: 0 } };
  }

  @Get("conversations")
  @Security("jwt")
  public async getConversations(
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<{ conversations: ConversationResponse[]; total: number }>> {
    const userId = request.user?.userId;
    const result = await this.chatService.getConversations(userId!, page, pageSize);
    return {
      code: 0,
      message: "Success",
      data: { conversations: result.conversations.map((c) => ({ ...c, messageCount: 0 })), total: result.total },
    };
  }

  @Get("conversations/{conversationId}")
  @Security("jwt")
  public async getConversation(
    @Path() conversationId: string,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<ConversationResponse>> {
    const userId = request.user?.userId;
    const conversation = await this.chatService.getConversation(conversationId, userId!);
    return { code: 0, message: "Success", data: { ...conversation, messageCount: 0 } };
  }

  @Put("conversations/{conversationId}")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  public async updateConversation(
    @Path() conversationId: string,
    @Body() body: UpdateConversationRequest,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<ConversationResponse>> {
    const userId = request.user?.userId;
    const conversation = await this.chatService.updateConversation(conversationId, userId!, body);
    return { code: 0, message: "Success", data: { ...conversation, messageCount: 0 } };
  }

  @Delete("conversations/{conversationId}")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  public async deleteConversation(
    @Path() conversationId: string,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<void>> {
    const userId = request.user?.userId;
    await this.chatService.deleteConversation(conversationId, userId!);
    return { code: 0, message: "Success" };
  }

  @Get("conversations/{conversationId}/messages")
  @Security("jwt")
  public async getMessages(
    @Path() conversationId: string,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<MessageResponse[]>> {
    const userId = request.user?.userId;
    const messages = await this.chatService.getMessages(conversationId, userId!);
    return {
      code: 0,
      message: "Success",
      data: messages.map((m) => ({ ...m, cost: m.cost ? Number(m.cost) : undefined })),
    };
  }

  @Delete("messages/{messageId}")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  public async deleteMessage(
    @Path() messageId: string,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<void>> {
    const userId = request.user?.userId;
    await this.chatService.deleteMessage(messageId, userId!);
    return { code: 0, message: "Success" };
  }

  @Get("tokens")
  @Security("jwt")
  public async getAvailableTokens(@Request() request: TypedRequest): Promise<SuccessResponse<ChatTokenResponse[]>> {
    const userId = request.user?.userId;
    const tokens = await this.chatService.getAvailableTokens(userId!);
    return { code: 0, message: "Success", data: tokens };
  }

  @Post("conversations/{conversationId}/messages")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  public async sendMessage(
    @Path() conversationId: string,
    @Body() body: SendMessageRequest,
    @Request() req: TypedRequest,
  ): Promise<void> {
    const userId = req.user?.userId;
    const res = req.res!;
    const abortController = new AbortController();
    const abortIfClientDisconnected = () => {
      if (!res.writableEnded) abortController.abort();
    };
    const canWrite = () => !abortController.signal.aborted && !res.writableEnded && !res.destroyed;

    skipResponseWrapper(req);
    this.sseService.initStream(res);
    req.once("aborted", abortIfClientDisconnected);
    res.once("close", abortIfClientDisconnected);

    try {
      for await (const chunk of this.chatService.sendMessage(
        conversationId,
        userId!,
        body.content,
        body.model,
        body.relayTokenId,
        {
          path: req.path,
          method: req.method,
          ipAddress: req.ip || req.connection?.remoteAddress || "unknown",
          requestId: String(req.headers["x-request-id"] || "").trim() || undefined,
          signal: abortController.signal,
        },
        body.replaceMessageId,
      ))
        if (canWrite()) this.sseService.sendChunk(res, chunk);

      if (canWrite()) {
        this.sseService.sendChunk<Extract<ChatStreamEvent, { type: "done" }>>(res, { type: "done", done: true });
        this.sseService.sendDone(res);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Chat stream failed";
      if (canWrite()) this.sseService.sendError(res, message);
    } finally {
      req.off("aborted", abortIfClientDisconnected);
      res.off("close", abortIfClientDisconnected);
      if (!res.writableEnded && !res.destroyed) this.sseService.endStream(res);
    }
  }
}
