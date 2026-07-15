import { Decimal } from "@prisma/client/runtime/library";
import { BadRequestError, NotFoundError, UnauthorizedError } from "@/util/errors";
import { BalanceService } from "@/services/billing/balance.service";
import { AnthropicUpstreamClient } from "@/util/anthropic-upstream.client";
import { OJAPIKeyRepository } from "@/store/oj-submitter/oj-apikey.repository";
import { OJModelPricingRepository } from "@/store/oj-submitter/oj-model-pricing.repository";
import { OJUsageRepository } from "@/store/oj-submitter/oj-usage.repository";
import type { OJAPIKeyStore } from "@/store/oj-submitter/oj-apikey.store";
import type { OJModelPricingStore } from "@/store/oj-submitter/oj-model-pricing.store";
import type { OJUsageStore } from "@/store/oj-submitter/oj-usage.store";
import { TOKEN_PRICE_DIVISOR } from "@/constant/pricing";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";
import { parseRelayChannelAllowedModelNames, supportsRelayRequestFormat } from "@/util/relay-model-availability.util";
import type { RelayChannel } from "@prisma/client";

export class OJQAService {
  private static instance: OJQAService;

  private constructor(
    private readonly ojApiKeyRepository: OJAPIKeyStore = OJAPIKeyRepository.getInstance(),
    private readonly ojModelPricingRepository: OJModelPricingStore = OJModelPricingRepository.getInstance(),
    private readonly ojUsageRepository: OJUsageStore = OJUsageRepository.getInstance(),
    private readonly balanceService: BalanceService = BalanceService.getInstance(),
    private readonly relayPoolResolver: RelayPoolResolverService = RelayPoolResolverService.getInstance(),
  ) {}

  static getInstance() {
    if (!this.instance) this.instance = new OJQAService();
    return this.instance;
  }

  /**
   * 验证API密钥并返回用户ID和渠道信息
   */
  async validateAPIKey(apiKey: string): Promise<{ userId: string; keyId: string; channel: RelayChannel | null }> {
    const key = await this.ojApiKeyRepository.findActiveByKey(apiKey);

    if (!key) throw new UnauthorizedError("Invalid API key");

    if (key.expiresAt && key.expiresAt < new Date()) throw new UnauthorizedError("API key has expired");

    return { userId: key.userId, keyId: key.id, channel: key.channel };
  }

  /**
   * 获取模型定价
   */
  async getModelPricing(model: string) {
    const pricing = await this.ojModelPricingRepository.findActiveByModel(model);

    if (!pricing) throw new NotFoundError(`Pricing not found for model: ${model}`);

    return pricing;
  }

  /**
   * 计算费用
   */
  calculateCost(
    inputTokens: number,
    outputTokens: number,
    cacheCreationTokens: number,
    cacheReadTokens: number,
    pricing: {
      inputPrice: Decimal;
      outputPrice: Decimal;
      multiplier: Decimal;
      cacheCreationMultiplier: Decimal;
      cacheReadMultiplier: Decimal;
    },
  ): number {
    const inputRate = Number(pricing.inputPrice) / TOKEN_PRICE_DIVISOR; // 价格是每百万token
    const outputRate = Number(pricing.outputPrice) / TOKEN_PRICE_DIVISOR;
    const multiplier = Number(pricing.multiplier);
    const cacheCreationMult = Number(pricing.cacheCreationMultiplier);
    const cacheReadMult = Number(pricing.cacheReadMultiplier);

    const baseCost = inputTokens * inputRate * multiplier + outputTokens * outputRate * multiplier;
    const cacheCost = cacheCreationTokens * inputRate * cacheCreationMult + cacheReadTokens * inputRate * cacheReadMult;

    return Math.floor((baseCost + cacheCost) * 10000) / 10000; // 保留4位小数
  }

  /**
   * 调用AI模型进行问答
   */
  async askQuestion(
    apiKey: string,
    question: string,
    model: string,
    maxTokens: number = 4096,
    ipAddress: string,
  ): Promise<{
    answer: string;
    tokensUsed: number;
    cost: number;
  }> {
    const startTime = Date.now();

    // 1. 验证API密钥
    const { userId, keyId, channel } = await this.validateAPIKey(apiKey);

    // 2. 检查余额
    const balanceAccount = await this.balanceService.getBalance(userId);
    if (Number(balanceAccount.balance) <= 0) throw new BadRequestError("Insufficient balance");

    // 3. 获取定价（使用客户端指定的模型，默认claude-3-haiku）
    const pricing = await this.getModelPricing(model);

    // 4. Resolve path-qualified leaves so pool restrictions and mappings remain correlated.
    const leaves = channel ? await this.relayPoolResolver.resolveActiveLeaves([channel]) : [null];
    const eligibleLeaves = leaves.filter((leaf) => {
      if (!leaf) return true;
      if (!supportsRelayRequestFormat(leaf.allowedFormats, "anthropic")) return false;
      const allowedModels = parseRelayChannelAllowedModelNames(leaf);
      return allowedModels === null || allowedModels.includes(model);
    });
    if (eligibleLeaves.length === 0)
      throw new BadRequestError(`Model '${model}' is not available on the assigned channel`);

    let answer = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;

    try {
      let data: Awaited<ReturnType<AnthropicUpstreamClient["messages"]>> | undefined;
      let lastError: unknown;
      for (const leaf of eligibleLeaves) {
        const anthropic = new AnthropicUpstreamClient(
          leaf ? { baseUrl: leaf.anthropicUpstreamUrl, apiKey: leaf.anthropicUpstreamApiKey } : undefined,
        );
        const mapping = (leaf?.modelMapping as Record<string, string> | null) ?? {};
        try {
          data = await anthropic.messages({
            model: mapping[model] || model,
            max_tokens: maxTokens,
            messages: [{ role: "user", content: question }],
          });
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!data) throw lastError ?? new BadRequestError("No Anthropic upstream is available");

      // 提取回答
      const content = data.content?.[0];
      if (content?.type === "text") answer = content.text ?? "";

      // 提取token使用情况
      inputTokens = data.usage?.input_tokens || 0;
      outputTokens = data.usage?.output_tokens || 0;
      cacheCreationTokens = data.usage?.cache_creation_input_tokens || 0;
      cacheReadTokens = data.usage?.cache_read_input_tokens || 0;
    } catch (error: any) {
      if (error instanceof BadRequestError) throw error;
      throw new BadRequestError(`AI service error: ${error.message}`);
    }

    const totalTokens = inputTokens + outputTokens;
    const responseTime = Date.now() - startTime;

    // 5. 计算费用
    const cost = this.calculateCost(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, pricing);

    // 6. 扣费并记录使用
    const charged = await this.ojUsageRepository.chargeAndRecordUsage({
      userId,
      keyId,
      model,
      question,
      answer,
      inputTokens,
      outputTokens,
      totalTokens,
      cacheCreationTokens,
      cacheReadTokens,
      cost,
      ipAddress,
      responseTime,
      inputRate: Number(pricing.inputPrice) / TOKEN_PRICE_DIVISOR,
      outputRate: Number(pricing.outputPrice) / TOKEN_PRICE_DIVISOR,
      multiplier: pricing.multiplier,
      cacheCreationMultiplier: pricing.cacheCreationMultiplier,
      cacheReadMultiplier: pricing.cacheReadMultiplier,
    });

    if (!charged) throw new BadRequestError("Insufficient balance for this request");

    return {
      answer,
      tokensUsed: totalTokens,
      cost,
    };
  }

  /**
   * 获取使用统计
   */
  async getUsageStats(userId: string, page = 1, pageSize = 20, startTime?: Date, endTime?: Date) {
    const { total, records, totalTokens, totalCost, requestCount } = await this.ojUsageRepository.queryUsageStats(
      userId,
      page,
      pageSize,
      startTime,
      endTime,
    );

    return {
      total,
      records,
      page,
      pageSize,
      totalTokens,
      totalCost,
      requestCount,
      avgTokensPerRequest: requestCount > 0 ? Math.round(totalTokens / requestCount) : 0,
      avgCostPerRequest: requestCount > 0 ? totalCost / requestCount : 0,
    };
  }
}
