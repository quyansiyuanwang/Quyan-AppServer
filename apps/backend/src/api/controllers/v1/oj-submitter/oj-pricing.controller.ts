import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Route,
  Security,
  Body,
  Path,
  Request,
  Tags,
  Middlewares,
} from "@tsoa/runtime";
import { OJPricingService } from "@/services/oj-submitter/oj-pricing.service";
import type {
  OJModelPricingDto,
  CreateOJModelPricingRequest,
  UpdateOJModelPricingRequest,
} from "@/api/dto/oj-submitter/oj-qa.dto";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import {
  createOJModelPricingBodySchema,
  ojPricingModelParamsSchema,
  updateOJModelPricingBodySchema,
} from "@/api/schema/oj-submitter/oj-submitter.schema";
import { validateBody, validateParams } from "@/middleware/validation";
import type { TypedRequest } from "@/types/express";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";

@Route("v1/products/oj-submitter/pricing")
@Tags("OJSubmitter")
export class OJPricingController extends Controller {
  private ojPricingService = OJPricingService.getInstance();

  /**
   * 获取所有模型定价
   */
  @Get()
  @Security("jwt")
  @RequirePermission(Permission.OJ_PRICING_READ)
  public async listPricing(): Promise<OJModelPricingDto[]> {
    const pricings = await this.ojPricingService.listPricing();

    return pricings.map((p) => ({
      id: p.id,
      model: p.model,
      inputPrice: p.inputPrice,
      outputPrice: p.outputPrice,
      multiplier: p.multiplier,
      cacheCreationMultiplier: p.cacheCreationMultiplier,
      cacheReadMultiplier: p.cacheReadMultiplier,
      provider: p.provider || undefined,
      createTime: p.createTime,
      updateTime: p.updateTime,
    }));
  }

  /**
   * 获取单个模型定价
   */
  @Get("{model}")
  @Security("jwt")
  @RequirePermission(Permission.OJ_PRICING_READ)
  @Middlewares(validateParams(ojPricingModelParamsSchema))
  public async getPricing(@Path() model: string): Promise<OJModelPricingDto> {
    const pricing = await this.ojPricingService.getPricing(model);

    return {
      id: pricing.id,
      model: pricing.model,
      inputPrice: pricing.inputPrice,
      outputPrice: pricing.outputPrice,
      multiplier: pricing.multiplier,
      cacheCreationMultiplier: pricing.cacheCreationMultiplier,
      cacheReadMultiplier: pricing.cacheReadMultiplier,
      provider: pricing.provider || undefined,
      createTime: pricing.createTime,
      updateTime: pricing.updateTime,
    };
  }

  /**
   * 创建模型定价
   */
  @Post()
  @Security("jwt")
  @RequirePermission(Permission.OJ_PRICING_UPDATE)
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(createOJModelPricingBodySchema))
  public async createPricing(
    @Body() body: CreateOJModelPricingRequest,
    @Request() request: TypedRequest,
  ): Promise<OJModelPricingDto> {
    const pricing = await this.ojPricingService.createPricing(body, request.user!.userId, request);

    return {
      id: pricing.id,
      model: pricing.model,
      inputPrice: pricing.inputPrice,
      outputPrice: pricing.outputPrice,
      multiplier: pricing.multiplier,
      cacheCreationMultiplier: pricing.cacheCreationMultiplier,
      cacheReadMultiplier: pricing.cacheReadMultiplier,
      provider: pricing.provider || undefined,
      createTime: pricing.createTime,
      updateTime: pricing.updateTime,
    };
  }

  /**
   * 更新模型定价
   */
  @Put("{model}")
  @Security("jwt")
  @RequirePermission(Permission.OJ_PRICING_UPDATE)
  @ReplayProtected()
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(ojPricingModelParamsSchema),
    validateBody(updateOJModelPricingBodySchema),
  )
  public async updatePricing(
    @Path() model: string,
    @Body() body: UpdateOJModelPricingRequest,
    @Request() request: TypedRequest,
  ): Promise<OJModelPricingDto> {
    const pricing = await this.ojPricingService.updatePricing(model, body, request.user!.userId, request);

    return {
      id: pricing.id,
      model: pricing.model,
      inputPrice: pricing.inputPrice,
      outputPrice: pricing.outputPrice,
      multiplier: pricing.multiplier,
      cacheCreationMultiplier: pricing.cacheCreationMultiplier,
      cacheReadMultiplier: pricing.cacheReadMultiplier,
      provider: pricing.provider || undefined,
      createTime: pricing.createTime,
      updateTime: pricing.updateTime,
    };
  }

  /**
   * 删除模型定价
   */
  @Delete("{model}")
  @Security("jwt")
  @RequirePermission(Permission.OJ_PRICING_UPDATE)
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateParams(ojPricingModelParamsSchema))
  public async deletePricing(@Path() model: string, @Request() request: TypedRequest): Promise<{ success: boolean }> {
    await this.ojPricingService.deletePricing(model, request.user!.userId, request);

    return { success: true };
  }
}
