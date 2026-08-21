import { ConversationRepository } from "@/store/chat/conversation.repository";
import { MessageRepository } from "@/store/chat/message.repository";
import type { ConversationStore } from "@/store/chat/conversation.store";
import type { MessageStore } from "@/store/chat/message.store";
import { AIProviderService } from "./ai-provider.service";
import { NotFoundError, ForbiddenError, BadRequestError } from "@/util/errors";
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
import type { ChatStreamEvent, ChatStreamMessage } from "@appserver/shared";
import { ALL_RELAY_REQUEST_FORMATS } from "@appserver/shared";
import { TOKEN_PRICE_DIVISOR } from "@/constant/pricing";
import { isModelIdAllowed, isModelNameAllowed, resolveModelId } from "@/util/model-resolution.util";
import {
  parseRelayRequestFormats,
  parseRelayChannelAllowedModelNames,
  parseRelayTokenAllowedModelIds,
  requireRelayChannelForFormat,
  type RelayConfiguredRequestFormat,
  type RelayRequestFormat,
  supportsRelayRequestFormat,
} from "@/util/relay-model-availability.util";
import { UsageChargeService } from "@/services/billing/usage-charge.service";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";
import { RelayProxyService, type RelayAttemptPlan } from "@/services/relay/relay-proxy.service";
import { randomUUID } from "crypto";
import { shouldRetryRelayUpstreamFailure } from "@/util/relay-failover-status-rule.util";

interface ChatRequestMeta {
  path?: string;
  method?: string;
  ipAddress?: string;
  requestId?: string;
  signal?: AbortSignal;
}

interface ChatRouteCandidate {
  channel: RelayChannel;
  displayChannel: RelayChannel;
  requestFormat: RelayRequestFormat;
  upstreamUrl: string;
  upstreamApiKey: string;
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
  ) {}

  static getInstance() {
    if (!this.instance) this.instance = new ChatService();
    return this.instance;
  }

  private resolveRequestedPricing(pricingList: ModelPricing[], requestedModel: string): ModelPricing | null {
    const normalizedRequestedModel = requestedModel.trim();
    if (!normalizedRequestedModel) return null;

    // Public relay/chat model selections are model IDs. Keep the model name as
    // a compatibility fallback for older clients, but always derive the
    // upstream request from resolveModelId below.
    const idMatches = pricingList.filter((pricing) => resolveModelId(pricing) === normalizedRequestedModel);
    if (idMatches.length === 1) return idMatches[0] || null;
    return pricingList.find((pricing) => pricing.model.trim() === normalizedRequestedModel) || null;
  }

  private getPreferredRequestFormatOrder(
    modelId: string,
    supportedFormats?: string | null,
  ): RelayConfiguredRequestFormat[] {
    const preferredFormat = this.aiProvider.getProvider(modelId);
    const supported = parseRelayRequestFormats(supportedFormats);
    const fallbackOrder: RelayConfiguredRequestFormat[] = [
      preferredFormat === "openai" ? "openai-chat-completions" : preferredFormat,
      ...ALL_RELAY_REQUEST_FORMATS,
    ];
    return fallbackOrder.filter(
      (format, index) => supported.includes(format) && fallbackOrder.indexOf(format) === index,
    );
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
    modelPricing: ModelPricing,
    selectedModelId: string,
  ): Promise<{ candidates: ChatRouteCandidate[]; attemptPlan: RelayAttemptPlan }> {
    const orderedFormats = this.getPreferredRequestFormatOrder(selectedModelId, modelPricing.supportedFormats);
    const attemptPlan = await this.relayProxyService.getChatAttemptPlan(token);
    const candidateChannels = attemptPlan.channels;

    if (candidateChannels.length === 0)
      throw new BadRequestError(
        "No relay channel assigned to this relay token. Please assign a channel before using chat.",
      );

    const candidates: ChatRouteCandidate[] = [];
    for (const candidate of candidateChannels) {
      for (const requestFormat of orderedFormats) {
        const channel = candidate.resolvedChannel;
        const channelAllowedFormats = channel.allowedFormats ?? "openai-chat-completions,anthropic,gemini";
        if (!supportsRelayRequestFormat(channelAllowedFormats, requestFormat)) continue;

        const channelAllowedModels = parseRelayChannelAllowedModelNames(channel);
        if (
          !isModelNameAllowed(channelAllowedModels, modelPricing.model.trim()) &&
          !isModelNameAllowed(channelAllowedModels, resolveModelId(modelPricing))
        )
          continue;

        const config = this.getUpstreamConfigForFormat(token, channel, requestFormat);
        const upstreamUrl = config.upstreamUrl?.trim();
        const upstreamApiKey = config.upstreamApiKey?.trim();
        if (upstreamUrl && upstreamApiKey) {
          candidates.push({
            channel,
            displayChannel: candidate.displayChannel,
            requestFormat,
            upstreamUrl,
            upstreamApiKey,
          });
          break;
        }
      }
    }

    if (candidates.length) return { candidates, attemptPlan };

    throw new BadRequestError(
      `Model ${modelPricing.model.trim()} has no compatible upstream configuration. Supported formats: ${
        modelPricing.supportedFormats || "openai-chat-completions,anthropic,gemini"
      }`,
    );
  }

  private isAborted(error: unknown, signal?: AbortSignal): boolean {
    if (signal?.aborted) return true;
    const candidate = error as { code?: string; name?: string } | undefined;
    return candidate?.code === "ERR_CANCELED" || candidate?.name === "AbortError";
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

  async createConversation(userId: string, title?: string, relayTokenId?: string) {
    if (relayTokenId) {
      const token = await this.relayTokenRepository.findById(relayTokenId);
      if (!token || token.userId !== userId) throw new ForbiddenError("Invalid relay token");
    }
    return this.conversationRepo.create(userId, title, relayTokenId);
  }

  async getConversations(userId: string, page: number, pageSize: number) {
    return this.conversationRepo.findByUserId(userId, page, pageSize);
  }

  async getConversation(conversationId: string, userId: string) {
    const conversation = await this.conversationRepo.findById(conversationId);
    if (!conversation) throw new NotFoundError("Conversation not found");
    if (conversation.userId !== userId) throw new ForbiddenError("Access denied");
    return conversation;
  }

  async updateConversation(conversationId: string, userId: string, data: { title?: string; relayTokenId?: string }) {
    await this.getConversation(conversationId, userId);
    if (data.relayTokenId) {
      const token = await this.relayTokenRepository.findById(data.relayTokenId);
      if (!token || token.userId !== userId) throw new ForbiddenError("Invalid relay token");
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
    if (!message) throw new NotFoundError("Message not found");
    const conversation = await this.conversationRepo.findById(message.conversationId);
    if (!conversation || conversation.userId !== userId) throw new ForbiddenError("Access denied");
    await this.messageRepo.deleteFrom(messageId);
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
    const conversation = await this.getConversation(conversationId, userId);

    const tokenId = relayTokenId || conversation.relayTokenId;
    if (!tokenId) throw new BadRequestError("No relay token specified");

    const token = await this.relayTokenRepository.findByIdWithChannel(tokenId);
    if (!token || token.userId !== userId) throw new ForbiddenError("Invalid relay token");

    const requestedModel = model.trim();
    if (!requestedModel) throw new BadRequestError("Model is required");

    const configuredModels = await this.modelPricingRepository.listActiveOrderedByModel();

    const resolvedPricing = this.resolveRequestedPricing(configuredModels, requestedModel);
    if (!resolvedPricing) throw new BadRequestError(`Model '${requestedModel}' is not configured`);

    const selectedModelName = resolvedPricing.model.trim();
    const selectedModelId = resolveModelId(resolvedPricing);
    const { candidates, attemptPlan } = await this.resolveChatRouteCandidates(token, resolvedPricing, selectedModelId);

    const tokenAllowedModelIds = parseRelayTokenAllowedModelIds(token.allowedModels);
    if (tokenAllowedModelIds.length > 0 && !isModelIdAllowed(tokenAllowedModelIds, resolvedPricing))
      throw new BadRequestError(`Relay token does not allow model ${requestedModel}`);

    if (replaceMessageId) {
      const message = await this.messageRepo.findById(replaceMessageId);
      if (!message || message.conversationId !== conversationId || message.role !== "user")
        throw new BadRequestError("The message to replace must be a user message in this conversation");
      await this.messageRepo.replaceFrom(replaceMessageId, content);
    } else await this.messageRepo.create({ conversationId, role: "user", content });

    const history = await this.messageRepo.findByConversationId(conversationId);
    const messages = history.map((m) => ({ role: m.role, content: m.content }));

    let assistantContent = "";
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
      if (token.routingMode === "automatic-pool")
        this.relayProxyService.assertRelayChannelMultiplierAccepted(candidate.channel, attemptPlan.failoverConfig);
      requireRelayChannelForFormat({ ...token, channel: candidate.channel }, candidate.requestFormat);

      const hasChargeCoverage = await this.usageChargeService.hasCoverageOrPositiveBalance({
        userId,
        modelName: selectedModelName,
        channelId: candidate.channel.id,
        at: monthlyPassCoverageAt,
      });
      if (!hasChargeCoverage) {
        lastError = new BadRequestError("Insufficient balance");
        continue;
      }

      effectiveCandidate = candidate;
      try {
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
          if (!chunk.done && chunk.content) {
            if (!firstChunkAt) firstChunkAt = Date.now();
            assistantContent += chunk.content;
            yield { type: "delta", content: chunk.content, done: false };
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
          lastError = new BadRequestError("Upstream completed without a visible response");
          effectiveCandidate = null;
          if (attemptIndex < attemptCandidates.length - 1) continue;
        }
        break;
      } catch (error) {
        if (this.isAborted(error, requestMeta?.signal)) {
          stopped = true;
          break;
        }
        lastError = error;
        if (firstChunkAt) {
          failed = true;
          break;
        }
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
      const error = lastError || new BadRequestError("No compatible relay channel is currently available");
      const fallbackTotalOutputTime = Math.max(0, Date.now() - streamStartAt);
      const fallbackTimeToFirstByte = Math.max(0, (firstChunkAt || Date.now()) - streamStartAt);
      const errorStatusCode =
        typeof (error as { response?: { status?: number } })?.response?.status === "number"
          ? (error as { response?: { status?: number } }).response!.status!
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
    if (!effectiveCandidate) throw new BadRequestError("No compatible relay channel is currently available");
    const effectiveChannel = effectiveCandidate.channel;
    const displayChannel = effectiveCandidate.displayChannel;

    if (totalOutputTime <= 0) totalOutputTime = Math.max(0, Date.now() - streamStartAt);
    if (timeToFirstByte <= 0) timeToFirstByte = Math.max(0, (firstChunkAt || Date.now()) - streamStartAt);

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

    const message = await this.messageRepo.create({
      conversationId,
      role: "assistant",
      content: assistantContent,
      model: selectedModelName,
      inputTokens,
      outputTokens,
      totalTokens,
      cost: new Decimal(cost),
      completionStatus: stopped ? "stopped" : failed ? "failed" : "completed",
    });

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
    });

    if (!finalizeResult.applied) throw new BadRequestError("Insufficient balance");
    if (stopped) return;
    if (failed) {
      if (lastError instanceof Error) throw lastError;
      throw new Error("Upstream stream failed after producing output");
    }

    yield { type: "complete", done: true, message: this.toStreamMessage(message) };
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
