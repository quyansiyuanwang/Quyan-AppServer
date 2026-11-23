import { withContentSafetyGenerator, resetContentSafetyAttempt } from "@/services/system/content-safety-attempt";
import { getAIResourceConfig } from "@/services/infrastructure/ai-resource-config.service";
import { CHAT_ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS, CHAT_MESSAGE_STORAGE_LIMIT_BYTES } from "@/constant/chat";
import { aiContentTooLarge } from "@/util/streaming/bounded-text";
import { withAIGenerator } from "@/services/infrastructure/ai-resource.service";
import { ConversationRepository } from "@/store/chat/conversation.repository";
import { MessageRepository } from "@/store/chat/message.repository";
import type { ConversationStore } from "@/store/chat/conversation.store";
import type { MessageStore } from "@/store/chat/message.store";
import { AIProviderService } from "./ai-provider.service";
import { NotFoundError, ForbiddenError, BadRequestError, PayloadTooLargeError } from "@/util/errors";
import { Decimal } from "@prisma/client/runtime/library";
import type { ModelPricing } from "@prisma/client";
import { RelayTokenRepository } from "@/store/relay/relay-token.repository";
import { RelayUsageRepository } from "@/store/relay/relay-usage.repository";
import { ModelPricingRepository } from "@/store/relay/model-pricing.repository";
import { RelayConfigRepository } from "@/store/relay/relay-config.repository";
import type { RelayTokenStore, RelayTokenWithChannel } from "@/store/relay/relay-token.store";
import type { RelayUsageStore } from "@/store/relay/relay-usage.store";
import type { ModelPricingStore } from "@/store/relay/model-pricing.store";
import type { RelayConfigStore } from "@/store/relay/relay-config.store";
import type { Message as PrismaMessage, RelayChannel } from "@prisma/client";
import type { ChatStreamEvent, ChatStreamMessage } from "@quyan/shared";
import { RELAY_REQUEST_FORMATS } from "@quyan/shared";
import { TOKEN_PRICE_DIVISOR } from "@/constant/pricing";
import { resolveModelId } from "@/util/model-resolution.util";
import { requireRelayChannelForFormat, type RelayConfiguredRequestFormat, type RelayRequestFormat } from "@/util/relay";
import { resolveRelayModelRoute } from "@/services/relay/utils/relay-model-route.util";
import { UsageChargeService } from "@/services/billing/usage-charge.service";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";
import { RelayProxyService, type RelayAttemptPlan } from "@/services/relay/relay-proxy.service";
import { randomUUID } from "crypto";
import { shouldRetryRelayUpstreamFailure } from "@/util/relay";
import { ContentSafetyService } from "@/services/system/content-safety.service";
import { ContentSafetyBlockedError } from "@/util/errors";
import { RelayChannelHealthService } from "@/services/relay/relay-channel-health.service";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { BoundedByteFrames } from "@/util/streaming/bounded-byte-frames";
import { extractTokenUsageMetrics } from "@/util/token-usage.util";
import { convertRelayRequest } from "@/services/relay/relay-request-format-transform.service";
import { relayConvertedRequestPath } from "@/services/relay/utils/relay-request-format.util";
import { setAIRequestLogContext } from "@/util/ai-request-log-context";

interface ChatRequestMeta {
  path?: string;
  method?: string;
  ipAddress?: string;
  requestId?: string;
  signal?: AbortSignal;
}

export interface ChatTextGenerationOptions extends ChatRequestMeta {
  maxOutputCharacters: number;
}
type ModelCompletionEvent =
  | Extract<ChatStreamEvent, { type: "delta" | "complete" }>
  | { type: "generation-complete"; done: true };

interface ChatRouteCandidate {
  channel: RelayChannel;
  displayChannel: RelayChannel;
  requestFormat: RelayRequestFormat;
  upstreamUrl: string;
  upstreamApiKey: string;
  modelPricing: ModelPricing;
}

/** HTTP response surface used by the relay, backed by a bounded, backpressured in-process stream. */
class ChatRelayResponse extends PassThrough {
  headersSent = false;
  statusCode = 200;
  locals = {};
  private readonly headers = new Map<string, unknown>();
  setHeader(name: string, value: unknown) {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }
  getHeader(name: string) {
    return this.headers.get(name.toLowerCase());
  }
  writeHead(status: number, headers: Record<string, unknown> = {}) {
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    this.headersSent = true;
    return this;
  }
  status(status: number) {
    this.statusCode = status;
    return this;
  }
  json(data: unknown) {
    this.writeHead(this.statusCode, { "content-type": "application/json" });
    this.end(JSON.stringify(data));
    return this;
  }
}

export class ChatService {
  private static instance: ChatService;

  private constructor(
    private readonly conversationRepo: ConversationStore = ConversationRepository.getInstance(),
    private readonly messageRepo: MessageStore = MessageRepository.getInstance(),
    private readonly aiProvider: AIProviderService = AIProviderService.getInstance(),
    private readonly relayTokenRepository: RelayTokenStore = RelayTokenRepository.getInstance(),
    private readonly relayUsageRepository: RelayUsageStore = RelayUsageRepository.getInstance(),
    private readonly modelPricingRepository: ModelPricingStore = ModelPricingRepository.getInstance(),
    private readonly relayConfigRepository: RelayConfigStore = RelayConfigRepository.getInstance(),
    private readonly usageChargeService: UsageChargeService = UsageChargeService.getInstance(),
    private readonly relayPoolResolver: RelayPoolResolverService = RelayPoolResolverService.getInstance(),
    private readonly relayProxyService: RelayProxyService = RelayProxyService.getInstance(),
    private readonly contentSafetyService: ContentSafetyService = ContentSafetyService.getInstance(),
    private readonly relayChannelHealthService: RelayChannelHealthService = RelayChannelHealthService.getInstance(),
  ) {}

  static getInstance() {
    if (!this.instance) this.instance = new ChatService();
    return this.instance;
  }

  private getPreferredRequestFormatOrder(modelId: string): RelayConfiguredRequestFormat[] {
    const preferredFormat = this.aiProvider.getProvider(modelId);
    const fallbackOrder: RelayConfiguredRequestFormat[] = [
      preferredFormat === "openai" ? "openai-chat-completions" : preferredFormat,
      ...RELAY_REQUEST_FORMATS,
    ];
    return fallbackOrder.filter((format, index) => fallbackOrder.indexOf(format) === index);
  }

  private getUpstreamConfigForFormat(
    token: RelayTokenWithChannel,
    channel: RelayChannel | null,
    requestFormat: RelayRequestFormat,
  ): { upstreamUrl?: string | null; upstreamApiKey?: string | null } {
    if (requestFormat.startsWith("openai-"))
      return {
        upstreamUrl: token.upstreamUrl || channel?.openaiUpstreamUrl,
        upstreamApiKey: token.upstreamApiKey || channel?.openaiUpstreamApiKey,
      };

    if (requestFormat === "anthropic")
      return {
        upstreamUrl: channel?.anthropicUpstreamUrl || token.upstreamUrl,
        upstreamApiKey: channel?.anthropicUpstreamApiKey || token.upstreamApiKey,
      };

    return {
      upstreamUrl: channel?.geminiUpstreamUrl || token.upstreamUrl,
      upstreamApiKey: channel?.geminiUpstreamApiKey || token.upstreamApiKey,
    };
  }

  private async resolveChatRouteCandidates(
    token: RelayTokenWithChannel,
    modelPricings: ModelPricing[],
    requestedModel: string,
  ): Promise<{ candidates: ChatRouteCandidate[]; attemptPlan: RelayAttemptPlan }> {
    const attemptPlan = await this.relayProxyService.getChatAttemptPlan(token);
    const candidateChannels = attemptPlan.channels;

    if (candidateChannels.length === 0)
      throw new BadRequestError(
        "No relay channel assigned to this relay token. Please assign a channel before using chat.",
        undefined,
        { messageKey: "chat.noChannelAssigned" },
      );

    const candidates: ChatRouteCandidate[] = [];
    const unavailableReasons = new Set<string>();
    for (const candidate of candidateChannels) {
      const channel = candidate.resolvedChannel;
      for (const requestFormat of this.getPreferredRequestFormatOrder(requestedModel)) {
        const route = resolveRelayModelRoute({
          requestedModel,
          requestFormat,
          tokens: [token],
          channel,
          channelPathIds: candidate.routingChannelIds,
          modelCatalog: modelPricings,
        });
        if (!route.modelConfig) {
          unavailableReasons.add(route.reason);
          continue;
        }
        const config = this.getUpstreamConfigForFormat(token, channel, route.requestFormat);
        const upstreamUrl = config.upstreamUrl?.trim();
        const upstreamApiKey = config.upstreamApiKey?.trim();
        if (upstreamUrl && upstreamApiKey) {
          candidates.push({
            channel,
            displayChannel: candidate.displayChannel,
            requestFormat: route.requestFormat,
            upstreamUrl,
            upstreamApiKey,
            modelPricing: route.modelConfig,
          });
          break;
        }
      }
    }

    if (candidates.length) return { candidates, attemptPlan };

    if (unavailableReasons.has("model-not-allowed"))
      throw new BadRequestError(`Relay token does not allow model ${requestedModel}`, undefined, {
        messageKey: "relayProxy.tokenModelNotAllowed",
      });
    throw new BadRequestError(`Model ID ${requestedModel} is not configured with a compatible upstream`, undefined, {
      messageKey: "chat.modelNoCompatibleUpstream",
    });
  }

  private isAborted(error: unknown, signal?: AbortSignal): boolean {
    if (signal?.aborted) return true;
    const candidate = error as { code?: string; name?: string } | undefined;
    return candidate?.code === "ERR_CANCELED" || candidate?.name === "AbortError";
  }

  private async recordChannelAttempt(
    relayTokenId: string,
    candidate: ChatRouteCandidate,
    success: boolean,
    requestId: string,
    latencyMs?: number,
  ): Promise<void> {
    try {
      await this.relayTokenRepository.updateChannelConfigUsage({
        relayTokenId,
        channelId: candidate.channel.id,
        success,
      });
    } catch {
      // Channel statistics must not change the request outcome.
    }
    const trackingMode =
      (candidate.channel.routingConfig as { healthTrackingMode?: string } | null | undefined)?.healthTrackingMode ??
      "automatic";
    if (trackingMode !== "automatic") return;
    void this.relayChannelHealthService
      .recordAttempt({
        channelId: candidate.channel.id,
        requestId,
        success,
        latencyMs,
        statusCode: 200,
      })
      .catch(() => undefined);
  }

  private toStreamMessage(message: PrismaMessage): ChatStreamMessage {
    return {
      id: message.id,
      conversationId: message.conversationId,
      role: message.role,
      content: message.content,
      model: message.model,
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
      totalTokens: message.totalTokens,
      cost: message.cost == null ? null : Number(message.cost),
      completionStatus: message.completionStatus,
      createTime: message.createTime.toISOString(),
    };
  }

  private async *streamCompositeCompletion(
    token: RelayTokenWithChannel,
    requestedModel: string,
    content: string,
    conversationId?: string,
    requestMeta?: ChatRequestMeta,
    replaceMessageId?: string,
    generation?: { maxOutputCharacters: number },
  ): AsyncGenerator<ModelCompletionEvent> {
    // Include the concrete request seed so wildcard aliases need no independent catalog row.
    let format: RelayConfiguredRequestFormat | undefined;
    for (const candidate of this.getPreferredRequestFormatOrder(requestedModel)) {
      const routes = await this.relayProxyService.getCompositeCatalog(token.id, candidate, undefined, [requestedModel]);
      if (routes.some((route) => route.model === requestedModel)) {
        format = candidate;
        break;
      }
    }
    if (!format)
      throw new BadRequestError("No compatible composite chat route", undefined, {
        messageKey: "chat.modelNoCompatibleUpstream",
      });
    if (requestMeta?.signal?.aborted) return;
    if (conversationId) await this.assertContextBudget(conversationId, token.userId, content, replaceMessageId);
    if (conversationId && replaceMessageId) {
      const message = await this.messageRepo.findById(replaceMessageId);
      if (!message || message.conversationId !== conversationId || message.role !== "user")
        throw new BadRequestError("The message to replace must be a user message in this conversation", undefined, {
          messageKey: "chat.replaceTargetInvalid",
        });
      await this.messageRepo.replaceFrom(replaceMessageId, content);
    } else if (conversationId) await this.messageRepo.create({ conversationId, role: "user", content });
    const limits = getAIResourceConfig().chat.resourceLimits;
    const history = conversationId
      ? await this.messageRepo.findContext(conversationId, limits.contextMaxMessages)
      : [{ role: "user", content }];
    const historyBytes = history.reduce((sum, message) => sum + Buffer.byteLength(message.content), 0);
    if (
      (limits.contextMaxMessages > 0 && history.length > limits.contextMaxMessages) ||
      historyBytes > limits.contextLimitBytes
    )
      throw aiContentTooLarge();
    const messages = history.map(({ role, content }) => ({ role, content }));
    const usage = { inputTokens: 0, outputTokens: 0 };
    let answer = "";
    let answerBytes = 0;
    let failure: unknown;
    let stopped = false;
    let completed = false;
    let message: PrismaMessage | undefined;
    try {
      for await (const delta of this.streamCompositeRelay(
        token,
        requestedModel,
        messages,
        format,
        usage,
        requestMeta,
      )) {
        const nextBytes = answerBytes + Buffer.byteLength(delta);
        if (
          nextBytes > limits.outputLimitBytes ||
          nextBytes > CHAT_MESSAGE_STORAGE_LIMIT_BYTES ||
          historyBytes + nextBytes > limits.contextLimitBytes ||
          (limits.contextMaxMessages > 0 && history.length + 1 > limits.contextMaxMessages)
        )
          throw aiContentTooLarge();
        if (generation && answer.length + delta.length > generation.maxOutputCharacters)
          throw new BadRequestError("Generation output exceeds the limit", undefined, {
            messageKey: "chat.generationOutputTooLarge",
          });
        answerBytes = nextBytes;
        answer += delta;
        yield { type: "delta", content: delta, done: false };
      }
      if (!answer)
        throw new BadRequestError("Upstream completed without a visible response", undefined, {
          messageKey: "chat.upstreamNoVisibleResponse",
        });
      completed = true;
    } catch (error) {
      stopped = this.isAborted(error, requestMeta?.signal);
      if (!stopped) failure = error;
    } finally {
      stopped ||= Boolean(requestMeta?.signal?.aborted) || (!completed && !failure);
      // Proxy owns physical pricing, usage records and every token's settlement. Chat never charges again.
      // Protocol usage has no settled price, so preserve unknown cost rather than inventing a price.
      if (conversationId && answer)
        message = await this.messageRepo.create({
          conversationId,
          role: "assistant",
          content: answer,
          model: requestedModel,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.inputTokens + usage.outputTokens,
          completionStatus: stopped ? "stopped" : failure ? "failed" : "completed",
        });
    }
    if (failure) throw failure;
    if (stopped || requestMeta?.signal?.aborted) return;
    if (message) yield { type: "complete", done: true, message: this.toStreamMessage(message) };
    else yield { type: "generation-complete", done: true };
  }

  private async *streamCompositeRelay(
    token: RelayTokenWithChannel,
    requestedModel: string,
    messages: Array<{ role: string; content: string }>,
    format: RelayConfiguredRequestFormat,
    usage: { inputTokens: number; outputTokens: number },
    meta?: ChatRequestMeta,
  ): AsyncGenerator<string> {
    const response = new ChatRelayResponse({
      highWaterMark: getAIResourceConfig().aiResources.streaming.frameLimitBytes,
    });
    const request = Object.assign(new EventEmitter(), {
      method: "POST",
      path:
        format === "gemini"
          ? `/relay/proxy/v1beta/models/${encodeURIComponent(requestedModel)}:streamGenerateContent`
          : `/relay/proxy${relayConvertedRequestPath(format)}`,
      headers: { "content-type": "application/json" },
      query: format === "gemini" ? { alt: "sse" } : {},
      ip: meta?.ipAddress || "unknown",
      aborted: false,
      res: response,
      body:
        format === "gemini"
          ? {
              contents: messages.map((message) => ({
                role: message.role === "assistant" ? "model" : "user",
                parts: [{ text: message.content }],
              })),
            }
          : convertRelayRequest(
              // A nested composite member may convert to Anthropic, which requires a cap.
              // Preserve Chat's existing Anthropic default independently of byte limits.
              { model: requestedModel, messages, stream: true, max_tokens: CHAT_ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS },
              "openai-chat-completions",
              format,
            ),
    });
    setAIRequestLogContext(response as unknown as Parameters<typeof setAIRequestLogContext>[0], {
      requestId: meta?.requestId || randomUUID(),
    });
    const abort = () => {
      request.aborted = true;
      request.emit("aborted");
      response.destroy(Object.assign(new Error("Chat request aborted"), { name: "AbortError" }));
    };
    // Attach an error observer before forwarding, including an already-aborted request.
    response.on("error", () => {});
    meta?.signal?.addEventListener("abort", abort, { once: true });
    if (meta?.signal?.aborted) abort();
    let forwardingError: unknown;
    const forwarding = Promise.resolve()
      .then(async () => {
        if (request.aborted) return;
        const result = await this.relayProxyService.forwardRequest(token, request, response);
        if (!response.headersSent && !response.destroyed) response.status(result.status).json(result.data);
      })
      .catch((error: unknown) => {
        forwardingError = error;
        response.destroy(error instanceof Error ? error : new Error("Composite relay failed"));
      });
    const frames = new BoundedByteFrames(
      getAIResourceConfig().aiResources.streaming.frameLimitBytes,
      format === "gemini" ? "gemini" : "sse",
    );
    let hasText = false;
    const parseFrame = (frame: Buffer): string => {
      const raw = frame.toString("utf8").trim();
      if (!raw) return "";
      const data =
        raw.startsWith("{") || raw.startsWith("[")
          ? raw
          : raw
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
      if (!data || data === "[DONE]") return "";
      const payload = JSON.parse(data);
      if (response.statusCode >= 400 || payload.error || payload.type === "response.failed") {
        const error = payload.error ?? payload.response?.error;
        if (error?.type === "content_safety_blocked") throw new ContentSafetyBlockedError();
        if (response.statusCode === 413 || Number(error?.code) === 413) throw aiContentTooLarge();
        throw new BadRequestError("Composite upstream stream failed", undefined, {
          messageKey: "chat.upstreamNoVisibleResponse",
        });
      }
      const metrics = extractTokenUsageMetrics(
        payload.usage ?? payload.message?.usage ?? payload.response?.usage ?? payload.usageMetadata,
      );
      usage.inputTokens = Math.max(usage.inputTokens, metrics.inputTokens);
      usage.outputTokens = Math.max(usage.outputTokens, metrics.outputTokens);
      let text = "";
      if (format === "gemini")
        text = (payload.candidates?.[0]?.content?.parts ?? [])
          .map((part: { text?: string }) => part.text ?? "")
          .join("");
      else if (format === "anthropic") {
        if (payload.type === "content_block_delta" && payload.delta?.type === "text_delta") text = payload.delta.text;
        else if (payload.type === "content_block_start" && payload.content_block?.type === "text")
          text = payload.content_block.text;
        else if (!payload.type || payload.type === "message")
          text = (payload.content ?? [])
            .filter((part: { type: string }) => part.type === "text")
            .map((part: { text: string }) => part.text)
            .join("");
      } else if (format === "openai-responses") {
        if (payload.type === "response.output_text.delta") text = payload.delta;
        else if (!hasText && (payload.type === "response.completed" || payload.object === "response"))
          text = (payload.response?.output ?? payload.output ?? [])
            .flatMap((item: { content?: Array<{ text?: string }> }) => item.content ?? [])
            .map((item: { text?: string }) => item.text ?? "")
            .join("");
      } else text = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content ?? "";
      if (typeof text !== "string") return "";
      hasText ||= text.length > 0;
      return text;
    };
    try {
      for await (const chunk of response)
        for (const frame of frames.feed(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))) {
          const text = parseFrame(frame);
          if (text) yield text;
        }
      const tail = frames.finish();
      if (tail) {
        const text = parseFrame(tail);
        if (text) yield text;
      }
      await forwarding;
      if (forwardingError) throw forwardingError;
      if (meta?.signal?.aborted) throw Object.assign(new Error("Chat request aborted"), { name: "AbortError" });
    } finally {
      if (!response.readableEnded) abort();
      response.destroy();
      meta?.signal?.removeEventListener("abort", abort);
      frames.clear();
      await forwarding;
    }
  }

  async createConversation(userId: string, title?: string, relayTokenId?: string) {
    if (relayTokenId) {
      const token = await this.relayTokenRepository.findById(relayTokenId);
      if (!token || token.userId !== userId)
        throw new ForbiddenError("Invalid relay token", undefined, { messageKey: "relayToken.invalid" });
    }
    return this.conversationRepo.create(userId, title, relayTokenId);
  }

  async getConversations(userId: string, page: number, pageSize: number) {
    return this.conversationRepo.findByUserId(userId, page, pageSize);
  }

  async getConversation(conversationId: string, userId: string) {
    const conversation = await this.conversationRepo.findById(conversationId);
    if (!conversation)
      throw new NotFoundError("Conversation not found", undefined, { messageKey: "agent.conversationNotFound" });
    if (conversation.userId !== userId)
      throw new ForbiddenError("Access denied", undefined, { messageKey: "chat.accessDenied" });
    return conversation;
  }

  async updateConversation(conversationId: string, userId: string, data: { title?: string; relayTokenId?: string }) {
    await this.getConversation(conversationId, userId);
    if (data.relayTokenId) {
      const token = await this.relayTokenRepository.findById(data.relayTokenId);
      if (!token || token.userId !== userId)
        throw new ForbiddenError("Invalid relay token", undefined, { messageKey: "relayToken.invalid" });
    }
    return this.conversationRepo.update(conversationId, data);
  }

  async deleteConversation(conversationId: string, userId: string) {
    await this.getConversation(conversationId, userId);
    await this.conversationRepo.delete(conversationId);
  }

  async getMessages(conversationId: string, userId: string) {
    await this.getConversation(conversationId, userId);
    return this.messageRepo.findByConversationId(conversationId);
  }

  async deleteMessage(messageId: string, userId: string) {
    const message = await this.messageRepo.findById(messageId);
    if (!message) throw new NotFoundError("Message not found", undefined, { messageKey: "chat.messageNotFound" });
    const conversation = await this.conversationRepo.findById(message.conversationId);
    if (!conversation || conversation.userId !== userId)
      throw new ForbiddenError("Access denied", undefined, { messageKey: "chat.accessDenied" });
    await this.messageRepo.deleteFrom(messageId);
  }

  public async assertContextBudget(
    conversationId: string,
    userId: string,
    content: string,
    replaceMessageId?: string,
  ): Promise<void> {
    await this.getConversation(conversationId, userId);
    const limits = getAIResourceConfig().chat.resourceLimits;
    const bytes = Buffer.byteLength(content);
    if (bytes > limits.inputLimitBytes || bytes > CHAT_MESSAGE_STORAGE_LIMIT_BYTES) throw aiContentTooLarge();
    let before: PrismaMessage | undefined;
    if (replaceMessageId) {
      const target = await this.messageRepo.findById(replaceMessageId);
      if (!target || target.conversationId !== conversationId || target.role !== "user")
        throw new BadRequestError("Invalid replacement target", undefined, { messageKey: "chat.replaceTargetInvalid" });
      before = target;
    }
    const size = await this.messageRepo.getContextSize(conversationId, before);
    if (
      (limits.contextMaxMessages > 0 && size.count + 1 > limits.contextMaxMessages) ||
      size.bytes + bytes > limits.contextLimitBytes
    )
      throw aiContentTooLarge();
  }

  /** Completes a bounded user-funded request without storing a conversation or prompt. */
  async generateTextForUser(
    userId: string,
    content: string,
    model: string,
    relayTokenId: string,
    options: ChatTextGenerationOptions,
  ): Promise<string> {
    if (!Number.isSafeInteger(options.maxOutputCharacters) || options.maxOutputCharacters <= 0)
      throw new BadRequestError("Invalid generation limit", undefined, {
        messageKey: "validation.fieldInvalidValue",
        messageParams: { field: "generationLimit" },
      });
    if (options.signal?.aborted)
      throw new BadRequestError("Generation was aborted", undefined, { messageKey: "chat.upstreamNoVisibleResponse" });
    let text = "",
      completed = false;
    for await (const event of this.streamModelCompletion(
      undefined,
      userId,
      content,
      model,
      relayTokenId,
      options,
      undefined,
      options,
    )) {
      if (event.type === "delta") text += event.content;
      if (event.type === "generation-complete") completed = true;
    }
    if (!completed || options.signal?.aborted)
      throw new BadRequestError("Generation did not complete", undefined, {
        messageKey: "chat.upstreamNoVisibleResponse",
      });
    return text;
  }
  async *sendMessage(
    conversationId: string,
    userId: string,
    content: string,
    model: string,
    relayTokenId?: string,
    requestMeta?: ChatRequestMeta,
    replaceMessageId?: string,
  ): AsyncGenerator<Extract<ChatStreamEvent, { type: "delta" | "complete" }>> {
    for await (const event of this.streamModelCompletion(
      conversationId,
      userId,
      content,
      model,
      relayTokenId,
      requestMeta,
      replaceMessageId,
    )) {
      if (event.type !== "generation-complete") yield event;
    }
  }

  private async *streamModelCompletion(
    conversationId: string | undefined,
    userId: string,
    content: string,
    model: string,
    relayTokenId?: string,
    requestMeta?: ChatRequestMeta,
    replaceMessageId?: string,
    generation?: { maxOutputCharacters: number },
  ): AsyncGenerator<ModelCompletionEvent> {
    yield* withAIGenerator(
      (signal) =>
        withContentSafetyGenerator(() =>
          this.streamModelCompletionInternal(
            conversationId,
            userId,
            content,
            model,
            relayTokenId,
            { ...requestMeta, signal },
            replaceMessageId,
            generation,
          ),
        ),
      requestMeta?.signal,
    );
  }

  private async *streamModelCompletionInternal(
    conversationId: string | undefined,
    userId: string,
    content: string,
    model: string,
    relayTokenId?: string,
    requestMeta?: ChatRequestMeta,
    replaceMessageId?: string,
    generation?: { maxOutputCharacters: number },
  ): AsyncGenerator<ModelCompletionEvent> {
    const limits = getAIResourceConfig().chat.resourceLimits;
    const contentBytes = Buffer.byteLength(content);
    if (contentBytes > limits.inputLimitBytes || contentBytes > CHAT_MESSAGE_STORAGE_LIMIT_BYTES)
      throw aiContentTooLarge();
    if (conversationId) await this.assertContextBudget(conversationId, userId, content, replaceMessageId);
    const conversation = conversationId ? await this.getConversation(conversationId, userId) : undefined;

    const tokenId = relayTokenId || conversation?.relayTokenId;
    if (!tokenId) throw new BadRequestError("No relay token specified", undefined, { messageKey: "chat.noRelayToken" });

    const token = await this.relayTokenRepository.findByIdWithChannel(tokenId);
    if (!token || token.userId !== userId)
      throw new ForbiddenError("Invalid relay token", undefined, { messageKey: "relayToken.invalid" });
    if (generation && (token.status !== 1 || (token.expiresAt && token.expiresAt.getTime() <= Date.now())))
      throw new ForbiddenError("Inactive generation token", undefined, { messageKey: "relayToken.invalid" });

    const requestedModel = model.trim();
    if (!requestedModel)
      throw new BadRequestError("Model is required", undefined, { messageKey: "chat.modelRequired" });

    if (token.routingMode === "composite") {
      if (token.status !== 1 || (token.expiresAt && token.expiresAt.getTime() <= Date.now()))
        throw new ForbiddenError("Inactive composite token", undefined, { messageKey: "relayToken.invalid" });
      yield* this.streamCompositeCompletion(
        token,
        requestedModel,
        content,
        conversationId,
        requestMeta,
        replaceMessageId,
        generation,
      );
      return;
    }

    if (typeof this.contentSafetyService.prepareAttempt === "function")
      await this.contentSafetyService.prepareAttempt({ userId, tokenConfig: token.contentSafetyConfig as any });
    const requestSafety = await this.contentSafetyService.evaluate("request", content, {
      userId,
      tokenConfig: token.contentSafetyConfig as any,
    });
    let auditInputTokens = requestSafety.auditInputTokens;
    let auditOutputTokens = requestSafety.auditOutputTokens;
    let auditCost = requestSafety.auditCost;
    let auditDurationMs = requestSafety.auditDurationMs;
    if (requestSafety.matched) {
      await this.contentSafetyService.recordIncident({
        userId,
        relayTokenId: tokenId,
        requestId: requestMeta?.requestId,
        direction: "request",
        evaluation: requestSafety,
        model: requestedModel,
      });
      if (requestSafety.action === "unreachable") throw new ContentSafetyBlockedError();
      content = requestSafety.text;
    }
    let effectiveSafety =
      typeof (this.contentSafetyService as any).getEffectivePolicy === "function"
        ? await this.contentSafetyService.getEffectivePolicy(userId, token.contentSafetyConfig as any)
        : await this.contentSafetyService.getPublicConfig();
    let auditResponse = Boolean(effectiveSafety.responseEnabled && effectiveSafety.responseAiEnabled);

    const configuredModels = await this.modelPricingRepository.listActiveOrderedByModel();

    const { candidates, attemptPlan } = await this.resolveChatRouteCandidates(token, configuredModels, requestedModel);
    let resolvedPricing = candidates[0]!.modelPricing;
    let selectedModelId = resolveModelId(resolvedPricing);
    let selectedModelName = resolvedPricing.model.trim();

    if (conversationId) await this.assertContextBudget(conversationId, userId, content, replaceMessageId);
    if (conversationId && replaceMessageId) {
      const message = await this.messageRepo.findById(replaceMessageId);
      if (!message || message.conversationId !== conversationId || message.role !== "user")
        throw new BadRequestError("The message to replace must be a user message in this conversation", undefined, {
          messageKey: "chat.replaceTargetInvalid",
        });
      await this.messageRepo.replaceFrom(replaceMessageId, content);
    } else if (conversationId) await this.messageRepo.create({ conversationId, role: "user", content });

    const history = conversationId
      ? await this.messageRepo.findContext(conversationId, getAIResourceConfig().chat.resourceLimits.contextMaxMessages)
      : [{ role: "user", content }];
    if (
      (getAIResourceConfig().chat.resourceLimits.contextMaxMessages > 0 &&
        history.length > getAIResourceConfig().chat.resourceLimits.contextMaxMessages) ||
      history.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0) >
        getAIResourceConfig().chat.resourceLimits.contextLimitBytes
    )
      throw aiContentTooLarge();
    const messages = history.map((m) => ({ role: m.role, content: m.content }));
    const historyBytes = history.reduce((bytes, message) => bytes + Buffer.byteLength(message.content), 0);
    const assertAnswerBudget = (bytes: number) => {
      const limits = getAIResourceConfig().chat.resourceLimits;
      if (
        bytes > limits.outputLimitBytes ||
        bytes > CHAT_MESSAGE_STORAGE_LIMIT_BYTES ||
        (limits.contextMaxMessages > 0 && history.length + 1 > limits.contextMaxMessages) ||
        historyBytes + bytes > limits.contextLimitBytes
      )
        throw aiContentTooLarge();
    };

    let assistantContent = "";
    let assistantBytes = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let totalOutputTime = 0;
    let timeToFirstByte = 0;
    let isStreaming = true;
    const streamStartAt = Date.now();
    let firstChunkAt: number | null = null;
    const usagePath = requestMeta?.path || "/chat/conversations/:conversationId/messages";
    const usageMethod = requestMeta?.method || "POST";
    const usageIpAddress = requestMeta?.ipAddress || "unknown";
    const usageRequestId = requestMeta?.requestId || randomUUID();

    const maxAttempts = attemptPlan.failoverConfig.enabled
      ? Math.max(1, Math.min(candidates.length, attemptPlan.failoverConfig.maxRetries + 1))
      : 1;
    const attemptCandidates = candidates.slice(0, maxAttempts);
    const monthlyPassCoverageAt = new Date();
    let effectiveCandidate: ChatRouteCandidate | null = null;
    let stopped = false;
    let failed = false;
    let lastError: unknown;

    for (let attemptIndex = 0; attemptIndex < attemptCandidates.length; attemptIndex += 1) {
      const candidate = attemptCandidates[attemptIndex];
      if (!candidate) continue;
      resolvedPricing = candidate.modelPricing;
      selectedModelId = resolveModelId(resolvedPricing);
      selectedModelName = resolvedPricing.model.trim();
      if (token.routingMode === "automatic-pool")
        this.relayProxyService.assertRelayChannelMultiplierAccepted(candidate.channel, attemptPlan.failoverConfig);
      requireRelayChannelForFormat({ ...token, channel: candidate.channel }, candidate.requestFormat);

      const hasChargeCoverage = await this.usageChargeService.hasCoverageOrPositiveBalance({
        category: "chat",
        userId,
        modelName: selectedModelName,
        channelId: candidate.channel.id,
        at: monthlyPassCoverageAt,
      });
      if (!hasChargeCoverage) {
        lastError = new BadRequestError("Insufficient balance", undefined, {
          messageKey: "billing.insufficientBalance",
        });
        continue;
      }

      effectiveCandidate = candidate;
      try {
        if (attemptIndex > 0) {
          resetContentSafetyAttempt();
          effectiveSafety =
            typeof this.contentSafetyService.prepareAttempt === "function"
              ? await this.contentSafetyService.prepareAttempt({
                  userId,
                  tokenConfig: token.contentSafetyConfig as any,
                })
              : typeof this.contentSafetyService.getEffectivePolicy === "function"
                ? await this.contentSafetyService.getEffectivePolicy(userId, token.contentSafetyConfig as any)
                : await this.contentSafetyService.getPublicConfig();
          auditResponse = Boolean(effectiveSafety.responseEnabled && effectiveSafety.responseAiEnabled);
          const safety = await this.contentSafetyService.evaluate("request", content, {
            userId,
            tokenConfig: token.contentSafetyConfig as any,
          });
          auditInputTokens += safety.auditInputTokens;
          auditOutputTokens += safety.auditOutputTokens;
          auditCost += safety.auditCost;
          auditDurationMs += safety.auditDurationMs;
          if (safety.matched) {
            await this.contentSafetyService.recordIncident({
              userId,
              relayTokenId: token.id,
              requestId: usageRequestId,
              direction: "request",
              evaluation: safety,
              model: selectedModelName,
              channelId: candidate.channel.id,
            });
            if (safety.action === "unreachable") throw new ContentSafetyBlockedError();
            messages[messages.length - 1] = { ...messages[messages.length - 1]!, content: safety.text };
          }
        }
        const streamRequestFormat =
          candidate.requestFormat === "openai-chat-completions" ? "openai" : candidate.requestFormat;
        const stream = requestMeta?.signal
          ? this.aiProvider.streamChat(
              messages,
              selectedModelId,
              candidate.upstreamApiKey,
              candidate.upstreamUrl,
              streamRequestFormat,
              requestMeta.signal,
            )
          : this.aiProvider.streamChat(
              messages,
              selectedModelId,
              candidate.upstreamApiKey,
              candidate.upstreamUrl,
              streamRequestFormat,
            );
        for await (const chunk of stream) {
          if (
            !chunk.done &&
            typeof chunk.content === "string" &&
            (generation ? chunk.content.length > 0 : chunk.content.trim())
          ) {
            if (!firstChunkAt) firstChunkAt = Date.now();
            const responseSafety = await this.contentSafetyService.evaluateLocal("response", chunk.content, {
              userId,
              tokenConfig: token.contentSafetyConfig as any,
            });
            if (responseSafety.matched) {
              await this.contentSafetyService.recordIncident({
                userId,
                relayTokenId: token.id,
                requestId: usageRequestId,
                direction: "response",
                evaluation: responseSafety,
                model: selectedModelName,
                channelId: candidate.channel.id,
              });
              if (responseSafety.action === "unreachable") throw new ContentSafetyBlockedError();
              chunk.content = responseSafety.text;
            }
            const nextBytes = assistantBytes + Buffer.byteLength(chunk.content);
            assertAnswerBudget(nextBytes);
            assistantBytes = nextBytes;
            if (generation && assistantContent.length + chunk.content.length > generation.maxOutputCharacters)
              throw new BadRequestError("Generation output exceeds the limit", undefined, {
                messageKey: "chat.generationOutputTooLarge",
              });
            assistantContent += chunk.content;
            if (!auditResponse) yield { type: "delta", content: chunk.content, done: false };
          }
          if (chunk.done) {
            inputTokens = chunk.inputTokens || 0;
            outputTokens = chunk.outputTokens || 0;
            cacheCreationTokens = chunk.cacheCreationTokens || 0;
            cacheReadTokens = chunk.cacheReadTokens || 0;
            totalOutputTime = chunk.totalOutputTime || 0;
            timeToFirstByte = chunk.timeToFirstByte || 0;
            isStreaming = chunk.isStreaming ?? true;
          }
        }
        if (!firstChunkAt) {
          lastError = new BadRequestError("Upstream completed without a visible response", undefined, {
            messageKey: "chat.upstreamNoVisibleResponse",
          });
          await this.recordChannelAttempt(token.id, candidate, false, usageRequestId);
          effectiveCandidate = attemptIndex === attemptCandidates.length - 1 ? candidate : null;
          failed = attemptIndex === attemptCandidates.length - 1;
          if (attemptIndex < attemptCandidates.length - 1) continue;
        }
        if (auditResponse && assistantContent) {
          const audited = await this.contentSafetyService.evaluate("response", assistantContent, {
            userId,
            tokenConfig: token.contentSafetyConfig as any,
          });
          auditInputTokens += audited.auditInputTokens;
          auditOutputTokens += audited.auditOutputTokens;
          auditCost += audited.auditCost;
          auditDurationMs += audited.auditDurationMs;
          if (audited.matched) {
            await this.contentSafetyService.recordIncident({
              userId,
              relayTokenId: token.id,
              requestId: usageRequestId,
              direction: "response",
              evaluation: audited,
              model: selectedModelName,
              channelId: candidate.channel.id,
            });
            if (audited.action === "unreachable") throw new ContentSafetyBlockedError();
            assertAnswerBudget(Buffer.byteLength(audited.text));
            if (generation && audited.text.length > generation.maxOutputCharacters)
              throw new BadRequestError("Generation output exceeds the limit", undefined, {
                messageKey: "chat.generationOutputTooLarge",
              });
            assistantContent = audited.text;
            assistantBytes = Buffer.byteLength(assistantContent);
          }
          yield { type: "delta", content: assistantContent, done: false };
        }
        totalOutputTime = Math.max(0, totalOutputTime - auditDurationMs);
        timeToFirstByte = Math.max(0, timeToFirstByte - auditDurationMs);
        if (firstChunkAt)
          await this.recordChannelAttempt(token.id, candidate, true, usageRequestId, firstChunkAt - streamStartAt);
        break;
      } catch (error) {
        if (this.isAborted(error, requestMeta?.signal)) {
          stopped = true;
          break;
        }
        lastError = error;
        if (firstChunkAt) {
          await this.recordChannelAttempt(token.id, candidate, false, usageRequestId, firstChunkAt - streamStartAt);
          failed = true;
          break;
        }
        await this.recordChannelAttempt(token.id, candidate, false, usageRequestId);
        effectiveCandidate = null;
        const response = (error as { response?: { status?: unknown; data?: unknown } })?.response;
        const statusCode = response?.status;
        const shouldRetry =
          typeof statusCode !== "number" ||
          shouldRetryRelayUpstreamFailure(statusCode, response?.data, attemptPlan.failoverConfig.retryStatusCodes);
        if (!shouldRetry || attemptIndex === attemptCandidates.length - 1) break;
      }
    }

    if (!effectiveCandidate && !stopped) {
      const error =
        lastError ||
        new BadRequestError("No compatible relay channel is currently available", undefined, {
          messageKey: "chat.noCompatibleChannel",
        });
      const fallbackTotalOutputTime = Math.max(0, Date.now() - streamStartAt);
      const fallbackTimeToFirstByte = Math.max(0, (firstChunkAt || Date.now()) - streamStartAt);
      const errorStatusCode =
        typeof (error as { response?: { status?: number } })?.response?.status === "number"
          ? (error as { response?: { status?: number } }).response!.status!
          : error instanceof PayloadTooLargeError
            ? 413
            : 500;

      await this.relayUsageRepository
        .create({
          relayTokenId: token.id,
          executionChannelId: null,
          displayChannelId: null,
          displayChannelName: null,
          requestTokens: inputTokens,
          responseTokens: outputTokens,
          totalTokens: inputTokens + outputTokens,
          cacheCreationTokens,
          cacheReadTokens,
          path: usagePath,
          method: usageMethod,
          statusCode: errorStatusCode,
          ipAddress: usageIpAddress,
          totalOutputTime: totalOutputTime > 0 ? totalOutputTime : fallbackTotalOutputTime,
          timeToFirstByte: timeToFirstByte > 0 ? timeToFirstByte : fallbackTimeToFirstByte,
          isStreaming,
        })
        .catch(() => undefined);

      throw error;
    }

    if (!effectiveCandidate && stopped) effectiveCandidate = attemptCandidates[0] || null;
    if (!effectiveCandidate)
      throw new BadRequestError("No compatible relay channel is currently available", undefined, {
        messageKey: "chat.noCompatibleChannel",
      });
    const effectiveChannel = effectiveCandidate.channel;
    const displayChannel = effectiveCandidate.displayChannel;

    if (totalOutputTime <= 0) totalOutputTime = Math.max(0, Date.now() - streamStartAt);
    if (timeToFirstByte <= 0) timeToFirstByte = Math.max(0, (firstChunkAt || Date.now()) - streamStartAt);

    if ((failed || stopped) && assistantContent) {
      if (!inputTokens) inputTokens = Math.ceil(messages.reduce((sum, message) => sum + message.content.length, 0) / 4);
      if (!outputTokens) outputTokens = Math.ceil(assistantContent.length / 4);
    }
    const totalTokens = inputTokens + outputTokens;
    const relayConfig = await this.relayConfigRepository.findLatestActive();

    const inputRate = Number(resolvedPricing.inputPrice) / TOKEN_PRICE_DIVISOR;
    const outputRate = Number(resolvedPricing.outputPrice) / TOKEN_PRICE_DIVISOR;
    const cacheCreationMultiplier = Number(resolvedPricing.cacheCreationMultiplier);
    const cacheReadMultiplier = Number(resolvedPricing.cacheReadMultiplier);
    const channelMultiplier = effectiveChannel.multiplier ? Number(effectiveChannel.multiplier) : 1;
    const globalMultiplier = relayConfig ? Number(relayConfig.globalMultiplier) : 1;
    const modelMultiplier = 1;
    const combinedMultiplier = modelMultiplier * channelMultiplier * globalMultiplier;

    const isPerRequest = resolvedPricing.pricingType === "per-request";
    const fixedPrice = resolvedPricing.fixedPrice ? Number(resolvedPricing.fixedPrice) : 0;

    let cost = 0;
    if (isPerRequest) {
      const rawCost = fixedPrice * combinedMultiplier;
      cost = Math.max(0, Math.ceil(rawCost * 10000) / 10000);
    } else {
      const rawCost =
        (inputTokens * inputRate +
          cacheCreationTokens * inputRate * cacheCreationMultiplier +
          cacheReadTokens * inputRate * cacheReadMultiplier +
          outputTokens * outputRate) *
        combinedMultiplier;
      cost = Math.max(0, Math.ceil(rawCost * 10000) / 10000);
    }
    cost += auditCost;
    const capacityFailure = failed && lastError instanceof PayloadTooLargeError;
    if (capacityFailure) cost = 0;

    const message = conversationId
      ? await this.messageRepo.create({
          conversationId,
          role: "assistant",
          content: assistantContent,
          model: selectedModelName,
          inputTokens,
          outputTokens,
          totalTokens,
          cost: new Decimal(cost),
          completionStatus: stopped ? "stopped" : failed ? "failed" : "completed",
        })
      : undefined;

    if (capacityFailure) {
      await this.relayUsageRepository
        .create({
          relayTokenId: token.id,
          executionChannelId: effectiveChannel.id,
          displayChannelId: displayChannel.id,
          displayChannelName: displayChannel.name || null,
          requestTokens: inputTokens,
          responseTokens: outputTokens,
          totalTokens,
          cacheCreationTokens,
          cacheReadTokens,
          path: usagePath,
          method: usageMethod,
          statusCode: 413,
          ipAddress: usageIpAddress,
          totalOutputTime,
          timeToFirstByte,
          isStreaming,
        })
        .catch(() => undefined);
      throw lastError;
    }

    const finalizeResult = await this.usageChargeService.chargeUsage({
      userId,
      relayTokenId: token.id,
      requestId: usageRequestId,
      requestTokens: inputTokens,
      responseTokens: outputTokens,
      totalTokens,
      cacheCreationTokens,
      cacheReadTokens,
      path: usagePath,
      method: usageMethod,
      statusCode: 200,
      ipAddress: usageIpAddress,
      totalOutputTime,
      timeToFirstByte,
      isStreaming,
      cost,
      modelName: selectedModelName,
      modelId: selectedModelId,
      executionChannelId: effectiveChannel.id,
      displayChannelId: displayChannel.id,
      displayChannelName: displayChannel.name || null,
      channelId: effectiveChannel.id,
      monthlyPassCoverageAt,
      inputRate,
      outputRate,
      multiplier: modelMultiplier,
      cacheCreationMultiplier,
      cacheReadMultiplier,
      channelMultiplier,
      globalMultiplier,
      balanceChargeMode: "allow-negative",
      pricingType:
        resolvedPricing.pricingType === "per-request" || resolvedPricing.pricingType === "token-based"
          ? resolvedPricing.pricingType
          : undefined,
      fixedPrice: resolvedPricing.fixedPrice ? Number(resolvedPricing.fixedPrice) : undefined,
      auditInputTokens,
      auditOutputTokens,
      auditTotalTokens: auditInputTokens + auditOutputTokens,
      auditCost,
      auditDurationMs,
    });

    if (!finalizeResult.applied)
      throw new BadRequestError("Insufficient balance", undefined, { messageKey: "billing.insufficientBalance" });
    if (stopped) return;
    if (failed) {
      if (lastError instanceof Error) throw lastError;
      throw new Error("Upstream stream failed after producing output");
    }

    if (message) yield { type: "complete", done: true, message: this.toStreamMessage(message) };
    else yield { type: "generation-complete", done: true };
  }

  async getAvailableTokens(userId: string) {
    const tokens = await this.relayTokenRepository.findByUserIdWithRelations(userId);

    return Promise.all(
      tokens.map(async (token) => {
        const available = await this.relayProxyService.getAvailableModelMapForToken(token);
        const allowedModels = Array.from(
          new Set([...available.openai, ...available.anthropic, ...available.gemini]),
        ).sort((left, right) => left.localeCompare(right));

        return {
          id: token.id,
          name: token.name,
          allowedModels: allowedModels.join(","),
        };
      }),
    );
  }
}
