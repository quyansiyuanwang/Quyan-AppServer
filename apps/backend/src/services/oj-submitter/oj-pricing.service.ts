import { PlatformOjPricingReadIamService } from "./platform-oj-pricing-read-iam.service";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { PermissionService } from "@/services/users/permission.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { OJModelPricing } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { NotFoundError, BadRequestError } from "@/util/errors";
import { OJModelPricingRepository } from "@/store/oj-submitter/oj-model-pricing.repository";
import type { OJModelPricingStore } from "@/store/oj-submitter/oj-model-pricing.store";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { DEFAULT_CACHE_CREATION_MULTIPLIER, DEFAULT_CACHE_READ_MULTIPLIER } from "@/constant/pricing";
import type { Request } from "express";

export class OJPricingService {
  private static instance: OJPricingService;

  private constructor(
    private readonly ojModelPricingRepository: OJModelPricingStore = OJModelPricingRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly iamReads = PlatformOjPricingReadIamService.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
  ) {}

  static getInstance() {
    if (!this.instance) this.instance = new OJPricingService();
    return this.instance;
  }

  private pricingDto(p: OJModelPricing) {
    return {
      id: p.id,
      model: p.model,
      inputPrice: Number(p.inputPrice),
      outputPrice: Number(p.outputPrice),
      multiplier: Number(p.multiplier),
      cacheCreationMultiplier: Number(p.cacheCreationMultiplier),
      cacheReadMultiplier: Number(p.cacheReadMultiplier),
      provider: p.provider,
      createTime: p.createTime,
      updateTime: p.updateTime,
    };
  }
  private async legacyReadPermission(request: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      !["legacy", "shadow"].includes(env.security.iamAuthorizationMode) ||
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, [Permission.OJ_PRICING_READ], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
  }
  async listManagedPricing(request: TypedRequest) {
    const project = (rows: OJModelPricing[]) => rows.map((row) => this.pricingDto(row));
    if (env.security.iamAuthorizationMode === "enforce") {
      const result = await this.iamReads.list(request, project);
      if (!result) throw iamAccountDenied();
      return result;
    }
    await this.legacyReadPermission(request);
    if (env.security.iamAuthorizationMode === "shadow") {
      try {
        await this.iamReads.list(request, project, false);
      } catch {
        getLogger("OJPricing", LogCategory.SECURITY).warn("OJ pricing list shadow evaluation failed", {
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    }
    return this.listPricing();
  }
  async getManagedPricing(model: string, request: TypedRequest) {
    const project = (row: OJModelPricing) => this.pricingDto(row);
    if (env.security.iamAuthorizationMode === "enforce") {
      const result = await this.iamReads.detail(model, request, project);
      if (!result) throw iamAccountDenied();
      return result;
    }
    await this.legacyReadPermission(request);
    if (env.security.iamAuthorizationMode === "shadow") {
      try {
        await this.iamReads.detail(model, request, project, false);
      } catch {
        getLogger("OJPricing", LogCategory.SECURITY).warn("OJ pricing detail shadow evaluation failed", {
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    }
    return this.getPricing(model);
  }
  /**
   * 获取所有定价
   */
  async listPricing() {
    const pricings = await this.ojModelPricingRepository.listActive();

    return pricings.map((p) => this.pricingDto(p));
  }

  /**
   * 获取单个模型定价
   */
  async getPricing(model: string) {
    const pricing = await this.ojModelPricingRepository.findActiveByModel(model);

    if (!pricing)
      throw new NotFoundError(`Pricing not found for model: ${model}`, undefined, {
        messageKey: "ojSubmitter.pricingNotFound",
        messageParams: { model },
      });

    return this.pricingDto(pricing);
  }

  /**
   * 创建定价
   */
  async createPricing(
    data: {
      model: string;
      inputPrice: number;
      outputPrice: number;
      multiplier?: number;
      cacheCreationMultiplier?: number;
      cacheReadMultiplier?: number;
      provider?: string;
    },
    actorUserId: string,
    request?: Request,
  ) {
    // 检查是否已存在
    const existing = await this.ojModelPricingRepository.findByModel(data.model);

    if (existing)
      throw new BadRequestError(`Pricing already exists for model: ${data.model}`, undefined, {
        messageKey: "ojSubmitter.pricingAlreadyExists",
        messageParams: { model: data.model },
      });

    const pricing = await this.ojModelPricingRepository.create({
      model: data.model,
      inputPrice: new Decimal(data.inputPrice),
      outputPrice: new Decimal(data.outputPrice),
      multiplier: new Decimal(data.multiplier ?? 1.0),
      cacheCreationMultiplier: new Decimal(data.cacheCreationMultiplier ?? DEFAULT_CACHE_CREATION_MULTIPLIER),
      cacheReadMultiplier: new Decimal(data.cacheReadMultiplier ?? DEFAULT_CACHE_READ_MULTIPLIER),
      provider: data.provider,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.OJ_PRICING_CREATE,
      operationCategory: OperationCategory.OJ_SUBMITTER,
      actorUserId,
      targetResourceId: pricing.id,
      targetResourceType: "OJ_MODEL_PRICING",
      description: `创建了 OJ 模型定价 '${pricing.model}'`,
      changes: data,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return {
      id: pricing.id,
      model: pricing.model,
      inputPrice: Number(pricing.inputPrice),
      outputPrice: Number(pricing.outputPrice),
      multiplier: Number(pricing.multiplier),
      cacheCreationMultiplier: Number(pricing.cacheCreationMultiplier),
      cacheReadMultiplier: Number(pricing.cacheReadMultiplier),
      provider: pricing.provider,
      createTime: pricing.createTime,
      updateTime: pricing.updateTime,
    };
  }

  /**
   * 更新定价
   */
  async updatePricing(
    model: string,
    data: {
      inputPrice?: number;
      outputPrice?: number;
      multiplier?: number;
      cacheCreationMultiplier?: number;
      cacheReadMultiplier?: number;
      provider?: string;
    },
    actorUserId: string,
    request?: Request,
  ) {
    const existing = await this.ojModelPricingRepository.findActiveByModel(model);

    if (!existing)
      throw new NotFoundError(`Pricing not found for model: ${model}`, undefined, {
        messageKey: "ojSubmitter.pricingNotFound",
        messageParams: { model },
      });

    const updateData: any = {};
    if (data.inputPrice !== undefined) updateData.inputPrice = new Decimal(data.inputPrice);
    if (data.outputPrice !== undefined) updateData.outputPrice = new Decimal(data.outputPrice);
    if (data.multiplier !== undefined) updateData.multiplier = new Decimal(data.multiplier);
    if (data.cacheCreationMultiplier !== undefined)
      updateData.cacheCreationMultiplier = new Decimal(data.cacheCreationMultiplier);
    if (data.cacheReadMultiplier !== undefined) updateData.cacheReadMultiplier = new Decimal(data.cacheReadMultiplier);
    if (data.provider !== undefined) updateData.provider = data.provider;

    const pricing = await this.ojModelPricingRepository.updateByModel(model, updateData);

    await this.businessLogService.logOperation({
      operationType: OperationType.OJ_PRICING_UPDATE,
      operationCategory: OperationCategory.OJ_SUBMITTER,
      actorUserId,
      targetResourceId: pricing.id,
      targetResourceType: "OJ_MODEL_PRICING",
      description: `更新了 OJ 模型定价 '${pricing.model}'`,
      changes: data,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return {
      id: pricing.id,
      model: pricing.model,
      inputPrice: Number(pricing.inputPrice),
      outputPrice: Number(pricing.outputPrice),
      multiplier: Number(pricing.multiplier),
      cacheCreationMultiplier: Number(pricing.cacheCreationMultiplier),
      cacheReadMultiplier: Number(pricing.cacheReadMultiplier),
      provider: pricing.provider,
      createTime: pricing.createTime,
      updateTime: pricing.updateTime,
    };
  }

  /**
   * 删除定价
   */
  async deletePricing(model: string, actorUserId: string, request?: Request) {
    const existing = await this.ojModelPricingRepository.findActiveByModel(model);

    if (!existing)
      throw new NotFoundError(`Pricing not found for model: ${model}`, undefined, {
        messageKey: "ojSubmitter.pricingNotFound",
        messageParams: { model },
      });

    await this.ojModelPricingRepository.softDeleteByModel(model);

    await this.businessLogService.logOperation({
      operationType: OperationType.OJ_PRICING_DELETE,
      operationCategory: OperationCategory.OJ_SUBMITTER,
      actorUserId,
      targetResourceId: existing.id,
      targetResourceType: "OJ_MODEL_PRICING",
      description: `删除了 OJ 模型定价 '${existing.model}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return { success: true };
  }
}
