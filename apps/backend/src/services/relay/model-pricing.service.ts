import type {
  ModelPricingDto,
  CreateModelPricingRequest,
  UpdateModelPricingRequest,
} from "@/api/dto/relay/model-pricing.dto";
import type { ModelPricing } from "@prisma/client";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { ModelPricingRepository } from "@/store/relay/model-pricing.repository";
import type { ModelPricingStore } from "@/store/relay/model-pricing.store";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { NotFoundError } from "@/util/errors";
import { maskSensitiveData } from "@/util/mask-sensitive-data";
import { DEFAULT_CACHE_CREATION_MULTIPLIER, DEFAULT_CACHE_READ_MULTIPLIER } from "@/constant/pricing";
import { RECORD_STATUS } from "@/constant/status";
import type { Request } from "express";

export class ModelPricingService {
  private static instance: ModelPricingService;

  private constructor(
    private readonly modelPricingRepository: ModelPricingStore = ModelPricingRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
  ) {}

  static getInstance() {
    if (!this.instance) this.instance = new ModelPricingService();
    return this.instance;
  }

  private toDto(model: ModelPricing): ModelPricingDto {
    return {
      id: model.id,
      model: model.model,
      pricingType: model.pricingType as "token-based" | "per-request",
      inputPrice: Number(model.inputPrice),
      outputPrice: Number(model.outputPrice),
      fixedPrice: model.fixedPrice != null ? Number(model.fixedPrice) : undefined,
      provider: model.provider || undefined,
      cacheCreationMultiplier: Number(model.cacheCreationMultiplier),
      cacheReadMultiplier: Number(model.cacheReadMultiplier),
      supportedFormats: model.supportedFormats || undefined,
    };
  }

  async getModelPricing(): Promise<ModelPricingDto[]> {
    const models = await this.modelPricingRepository.listActiveOrderedByModel();

    return models.map((m) => {
      if (!m.pricingType || (m.pricingType !== "token-based" && m.pricingType !== "per-request"))
        throw new Error(`Invalid pricingType '${m.pricingType}' for model ${m.model}`);

      return this.toDto(m);
    });
  }

  async createModelPricing(
    data: CreateModelPricingRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<ModelPricingDto> {
    // Validate model name
    if (!data.model || !data.model.trim()) throw new Error("model is required and cannot be empty");

    // Validate supportedFormats - can be single format, comma-separated formats, or "all"
    if (data.supportedFormats) {
      if (data.supportedFormats === "both") throw new Error("supportedFormats 'both' is deprecated, use 'all' instead");

      if (data.supportedFormats !== "all") {
        const formats = data.supportedFormats.split(",").map((f) => f.trim());
        const validFormats = ["openai", "anthropic", "gemini"];
        for (const format of formats)
          if (!validFormats.includes(format))
            throw new Error(
              `Invalid format '${format}' in supportedFormats. Must be 'openai', 'anthropic', 'gemini', or 'all'`,
            );
      }
    }

    // Validate pricingType - must be explicitly provided
    if (!data.pricingType) throw new Error("pricingType is required");
    if (data.pricingType !== "token-based" && data.pricingType !== "per-request")
      throw new Error("pricingType must be 'token-based' or 'per-request'");

    // Validate pricing fields based on pricingType
    if (data.pricingType === "per-request") {
      // Per-request pricing validation
      if (data.fixedPrice == null || data.fixedPrice < 0)
        throw new Error("fixedPrice is required and must be greater or equal to 0 for per-request pricing");
    } else {
      // Token-based pricing validation
      if (data.inputPrice == null || data.inputPrice < 0)
        throw new Error("inputPrice is required and must be >= 0 for token-based pricing");

      if (data.outputPrice == null || data.outputPrice < 0)
        throw new Error("outputPrice is required and must be >= 0 for token-based pricing");

      if (data.cacheCreationMultiplier != null && data.cacheCreationMultiplier < 0)
        throw new Error("cacheCreationMultiplier must be >= 0");

      if (data.cacheReadMultiplier != null && data.cacheReadMultiplier < 0)
        throw new Error("cacheReadMultiplier must be >= 0");
    }

    const normalizedModelName = data.model.trim();
    const writeData = {
      model: normalizedModelName,
      pricingType: data.pricingType,
      inputPrice: data.inputPrice ?? 0,
      outputPrice: data.outputPrice ?? 0,
      fixedPrice: data.fixedPrice,
      provider: data.provider,
      cacheCreationMultiplier: data.cacheCreationMultiplier ?? DEFAULT_CACHE_CREATION_MULTIPLIER,
      cacheReadMultiplier: data.cacheReadMultiplier ?? DEFAULT_CACHE_READ_MULTIPLIER,
      supportedFormats: data.supportedFormats || "all",
    };

    const existingModel = await this.modelPricingRepository.findByModel(normalizedModelName);
    if (existingModel?.status === RECORD_STATUS.ACTIVE)
      throw new Error(`Model '${normalizedModelName}' already exists`);

    let model: ModelPricing;
    if (existingModel)
      model = await this.modelPricingRepository.updateById(existingModel.id, {
        ...writeData,
        status: RECORD_STATUS.ACTIVE,
      });
    else
      model = await this.modelPricingRepository.create({
        ...writeData,
        status: RECORD_STATUS.ACTIVE,
      });

    await this.businessLogService.logOperation({
      operationType: OperationType.MODEL_PRICING_CREATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceId: model.id,
      targetResourceType: "MODEL_PRICING",
      description: `创建了模型定价 '${model.model}'`,
      changes: maskSensitiveData(writeData),
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toDto(model);
  }

  async updateModelPricing(
    id: string,
    data: UpdateModelPricingRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<ModelPricingDto> {
    const existing = await this.modelPricingRepository.findActiveById(id);

    if (!existing) throw new NotFoundError("Model pricing not found");

    // Validate model name if provided
    if (data.model !== undefined && (!data.model || !data.model.trim())) throw new Error("model cannot be empty");

    // Validate supportedFormats - can be single format, comma-separated formats, or "all"
    if (data.supportedFormats) {
      if (data.supportedFormats === "both") throw new Error("supportedFormats 'both' is deprecated, use 'all' instead");

      if (data.supportedFormats !== "all") {
        const formats = data.supportedFormats.split(",").map((f) => f.trim());
        const validFormats = ["openai", "anthropic", "gemini"];
        for (const format of formats)
          if (!validFormats.includes(format))
            throw new Error(
              `Invalid format '${format}' in supportedFormats. Must be 'openai', 'anthropic', 'gemini', or 'all'`,
            );
      }
    }

    // Validate pricingType if provided
    if (data.pricingType && data.pricingType !== "token-based" && data.pricingType !== "per-request")
      throw new Error("pricingType must be 'token-based' or 'per-request'");

    // Determine final pricingType
    const finalPricingType = data.pricingType || existing.pricingType;

    // Validate pricing fields based on final pricingType
    if (finalPricingType === "per-request") {
      const finalFixedPrice = data.fixedPrice !== undefined ? data.fixedPrice : existing.fixedPrice;
      if (!finalFixedPrice || Number(finalFixedPrice) < 0)
        throw new Error("fixedPrice is required and must be greater or equal to 0 for per-request pricing");
    } else {
      // Token-based pricing validation
      const finalInputPrice = data.inputPrice !== undefined ? data.inputPrice : existing.inputPrice;
      const finalOutputPrice = data.outputPrice !== undefined ? data.outputPrice : existing.outputPrice;

      if (finalInputPrice == null || Number(finalInputPrice) < 0)
        throw new Error("inputPrice must be >= 0 for token-based pricing");

      if (finalOutputPrice == null || Number(finalOutputPrice) < 0)
        throw new Error("outputPrice must be >= 0 for token-based pricing");

      if (data.cacheCreationMultiplier != null && data.cacheCreationMultiplier < 0)
        throw new Error("cacheCreationMultiplier must be >= 0");

      if (data.cacheReadMultiplier != null && data.cacheReadMultiplier < 0)
        throw new Error("cacheReadMultiplier must be >= 0");
    }

    const model = await this.modelPricingRepository.updateById(id, {
      model: data.model?.trim(),
      pricingType: data.pricingType,
      inputPrice: data.inputPrice,
      outputPrice: data.outputPrice,
      fixedPrice: data.fixedPrice,
      provider: data.provider,
      cacheCreationMultiplier: data.cacheCreationMultiplier,
      cacheReadMultiplier: data.cacheReadMultiplier,
      supportedFormats: data.supportedFormats,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.MODEL_PRICING_UPDATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceId: model.id,
      targetResourceType: "MODEL_PRICING",
      description: `更新了模型定价 '${model.model}'`,
      changes: maskSensitiveData(data),
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toDto(model);
  }

  async deleteModelPricing(id: string, actorUserId: string, request?: Request): Promise<void> {
    const existing = await this.modelPricingRepository.findActiveById(id);

    if (!existing) throw new NotFoundError("Model pricing not found");

    await this.modelPricingRepository.softDeleteById(id);

    await this.businessLogService.logOperation({
      operationType: OperationType.MODEL_PRICING_DELETE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceId: existing.id,
      targetResourceType: "MODEL_PRICING",
      description: `删除了模型定价 '${existing.model}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  async importModelPricing(
    models: {
      model: string;
      inputPrice: number;
      outputPrice: number;
      provider?: string;
      cacheCreationMultiplier?: number;
      cacheReadMultiplier?: number;
    }[],
    actorUserId: string,
    request?: Request,
  ): Promise<{ created: number; updated: number; total: number }> {
    const result = await this.modelPricingRepository.importModels(models);
    const modelNames = models.map((item) => item.model.trim()).filter(Boolean);

    await this.businessLogService.logOperation({
      operationType: OperationType.MODEL_PRICING_IMPORT,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceId: "batch",
      targetResourceType: "MODEL_PRICING",
      description: `导入了 ${result.total} 条模型定价`,
      changes: maskSensitiveData({
        created: result.created,
        updated: result.updated,
        total: result.total,
        models: modelNames.slice(0, 20),
        truncated: modelNames.length > 20,
      }),
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return result;
  }
}
