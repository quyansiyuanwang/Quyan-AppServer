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
import type { RelayChannel } from "@prisma/client";
import { TOKEN_PRICE_DIVISOR } from "@/constant/pricing";
import { isModelIdAllowed, isModelNameAllowed, resolveModelId } from "@/util/model-resolution.util";
import {
  getAccessibleRelayModelNamesForToken,
  parseRelayRequestFormats,
  parseRelayChannelAllowedModelNames,
  parseRelayTokenAllowedModelIds,
  requireRelayChannelForFormat,
  type RelayRequestFormat,
  supportsRelayRequestFormat,
} from "@/util/relay-model-availability.util";
import { UsageChargeService } from "@/services/billing/usage-charge.service";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";

interface ChatRequestMeta {
  path?: string;
  method?: string;
  ipAddress?: string;
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
  ) {}

  static getInstance() {
    if (!this.instance) this.instance = new ChatService();
    return this.instance;
  }

  private resolveRequestedPricing(pricingList: ModelPricing[], requestedModel: string): ModelPricing | null {
    const normalizedRequestedModel = requestedModel.trim();
    if (!normalizedRequestedModel) return null;

    return pricingList.find((pricing) => pricing.model.trim() === normalizedRequestedModel) || null;
  }

  private getPreferredRequestFormatOrder(modelId: string, supportedFormats?: string | null): RelayRequestFormat[] {
    const preferredFormat = this.aiProvider.getProvider(modelId);
    const supported = parseRelayRequestFormats(supportedFormats);
    const fallbackOrder: RelayRequestFormat[] = [preferredFormat, "openai", "anthropic", "gemini"];
    return fallbackOrder.filter(
      (format, index) => supported.includes(format) && fallbackOrder.indexOf(format) === index,
    );
  }

  private getUpstreamConfigForFormat(
    token: RelayTokenWithChannel,
    channel: RelayChannel | null,
    requestFormat: RelayRequestFormat,
  ): { upstreamUrl?: string | null; upstreamApiKey?: string | null } {
    if (requestFormat === "openai")
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

  private async getCandidateChatChannels(token: RelayTokenWithChannel): Promise<RelayChannel[]> {
    const assignedChannel = token.channel;
    if (!assignedChannel) return [];
    return this.relayPoolResolver.resolveActiveLeaves([assignedChannel]);
  }

  private async resolveChatRequestFormat(
    token: RelayTokenWithChannel,
    modelPricing: ModelPricing,
    selectedModelId: string,
    configuredModels: ModelPricing[],
  ): Promise<{
    channel: RelayChannel;
    requestFormat: RelayRequestFormat;
    upstreamUrl: string;
    upstreamApiKey: string;
  }> {
    const orderedFormats = this.getPreferredRequestFormatOrder(selectedModelId, modelPricing.supportedFormats);
    const candidateChannels = await this.getCandidateChatChannels(token);

    if (candidateChannels.length === 0)
      throw new BadRequestError(
        "No relay channel assigned to this relay token. Please assign a channel before using chat.",
      );

    for (const requestFormat of orderedFormats) {
      for (const channel of candidateChannels) {
        const channelAllowedFormats = channel.allowedFormats || "all";
        if (!supportsRelayRequestFormat(channelAllowedFormats, requestFormat)) continue;

        const channelAllowedModels = parseRelayChannelAllowedModelNames(channel, configuredModels);
        if (!isModelNameAllowed(channelAllowedModels, modelPricing.model.trim())) continue;

        const config = this.getUpstreamConfigForFormat(token, channel, requestFormat);
        const upstreamUrl = config.upstreamUrl?.trim();
        const upstreamApiKey = config.upstreamApiKey?.trim();
        if (upstreamUrl && upstreamApiKey) return { channel, requestFormat, upstreamUrl, upstreamApiKey };
      }
    }

    throw new BadRequestError(
      `Model ${modelPricing.model.trim()} has no compatible upstream configuration. Supported formats: ${
        modelPricing.supportedFormats || "all"
      }`,
    );
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
    await this.messageRepo.delete(messageId);
  }

  async *sendMessage(
    conversationId: string,
    userId: string,
    content: string,
    model: string,
    relayTokenId?: string,
    requestMeta?: ChatRequestMeta,
  ) {
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
    const {
      channel: effectiveChannel,
      requestFormat,
      upstreamUrl,
      upstreamApiKey: apiKey,
    } = await this.resolveChatRequestFormat(token, resolvedPricing, selectedModelId, configuredModels);
    requireRelayChannelForFormat({ ...token, channel: effectiveChannel }, requestFormat);

    const channelAllowedModels = parseRelayChannelAllowedModelNames(effectiveChannel, configuredModels);
    if (!isModelNameAllowed(channelAllowedModels, selectedModelName))
      throw new BadRequestError(`Channel does not support model ${requestedModel}`);

    const tokenAllowedModelIds = parseRelayTokenAllowedModelIds(token.allowedModels);
    if (tokenAllowedModelIds.length > 0 && !isModelIdAllowed(tokenAllowedModelIds, resolvedPricing))
      throw new BadRequestError(`Relay token does not allow model ${requestedModel}`);

    const monthlyPassCoverageAt = new Date();
    const hasChargeCoverage = await this.usageChargeService.hasCoverageOrPositiveBalance({
      userId,
      modelName: selectedModelName,
      channelId: effectiveChannel.id,
      at: monthlyPassCoverageAt,
    });

    if (!hasChargeCoverage) throw new BadRequestError("Insufficient balance");

    await this.messageRepo.create({ conversationId, role: "user", content });

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

    try {
      for await (const chunk of this.aiProvider.streamChat(
        messages,
        selectedModelId,
        apiKey,
        upstreamUrl,
        requestFormat,
      )) {
        if (!firstChunkAt) firstChunkAt = Date.now();

        if (chunk.content) {
          assistantContent += chunk.content;
          yield { content: chunk.content, done: false };
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
    } catch (error) {
      const fallbackTotalOutputTime = Math.max(0, Date.now() - streamStartAt);
      const fallbackTimeToFirstByte = Math.max(0, (firstChunkAt || Date.now()) - streamStartAt);
      const errorStatusCode =
        typeof (error as { response?: { status?: number } })?.response?.status === "number"
          ? (error as { response?: { status?: number } }).response!.status!
          : 500;

      await this.relayUsageRepository
        .create({
          relayTokenId: token.id,
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
    });

    const finalizeResult = await this.usageChargeService.chargeUsage({
      userId,
      relayTokenId: token.id,
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
      channelId: effectiveChannel.id,
      monthlyPassCoverageAt,
      inputRate,
      outputRate,
      multiplier: modelMultiplier,
      cacheCreationMultiplier,
      cacheReadMultiplier,
      channelName: effectiveChannel.name || null,
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

    yield { done: true, message };
  }

  async getAvailableTokens(userId: string) {
    const [tokens, configuredModels] = await Promise.all([
      this.relayTokenRepository.findByUserIdWithChannel(userId),
      this.modelPricingRepository.listActiveOrderedByModel(),
    ]);

    return tokens.map((token) => {
      const effectiveModels = new Set<string>();
      const candidateFormats = parseRelayRequestFormats(token.channel?.allowedFormats);

      for (const requestFormat of candidateFormats)
        try {
          for (const modelId of getAccessibleRelayModelNamesForToken(token, configuredModels, requestFormat))
            effectiveModels.add(modelId);
        } catch {
          continue;
        }

      return {
        id: token.id,
        name: token.name,
        token: token.token,
        allowedModels: Array.from(effectiveModels).join(","),
      };
    });
  }
}
