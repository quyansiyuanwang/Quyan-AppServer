import {
  platformModelPricingCreateResource,
  platformModelPricingWriteResource,
} from "@/iam/request/platform-model-pricing-resource-resolvers";
import { iamCollectionAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import {
  Body,
  Controller,
  Delete,
  Get,
  Path,
  Post,
  Put,
  Request,
  Route,
  Security,
  Tags,
  Middlewares,
} from "@tsoa/runtime";
import { ModelPricingService } from "@/services/relay/model-pricing.service";
import type {
  CreateModelPricingRequest,
  CreateModelPricingResponse,
  DeleteModelPricingResponse,
  ModelPricingListResponse,
  ModelPricingDto,
  UpdateModelPricingRequest,
  UpdateModelPricingResponse,
} from "@/api/dto/relay/model-pricing.dto";
import { CheckPermission, PermissionCheckMode, RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import {
  createModelPricingBodySchema,
  importModelPricingBodySchema,
  modelPricingIdParamsSchema,
  updateModelPricingBodySchema,
} from "@/api/schema/relay/model-pricing.schema";
import { validateBody, validateParams } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import type { TypedRequest } from "@/types/express";

interface ModelPricingExportData {
  models: ModelPricingDto[];
}

interface ModelPricingImportRequest {
  models: CreateModelPricingRequest[];
}

interface ModelPricingImportResponse {
  code: number;
  message: string;
  created: number;
  updated: number;
  total: number;
}

@Route("v1/model-pricing")
@Tags("Model Pricing")
export class ModelPricingController extends Controller {
  private modelPricingService = ModelPricingService.getInstance();

  @Get()
  public async getModelPricing(): Promise<ModelPricingListResponse> {
    const models = await this.modelPricingService.getModelPricing();
    return { models };
  }

  @Get("export")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:model_pricing:ExportModels",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  public async exportModelPricing(@Request() request: TypedRequest): Promise<ModelPricingExportData> {
    const models = await this.modelPricingService.exportManagedModelPricing(request);
    return { models };
  }

  @Post("import")
  @Security("jwt")
  @RequirePermission(Permission.MODEL_PRICING_UPDATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(importModelPricingBodySchema),
  )
  public async importModelPricing(
    @Body() body: ModelPricingImportRequest,
    @Request() request: TypedRequest,
  ): Promise<ModelPricingImportResponse> {
    const result = await this.modelPricingService.importModelPricing(body.models, request.user!.userId, request);
    return { code: 0, message: "success", ...result };
  }

  @Post()
  @Security("jwt")
  @CheckPermission(Permission.MODEL_PRICING_UPDATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:model_pricing:CreatePricing",
    resourceKind: "collection",
    resource: platformModelPricingCreateResource,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createModelPricingBodySchema),
  )
  public async createModelPricing(
    @Body() body: CreateModelPricingRequest,
    @Request() request: TypedRequest,
  ): Promise<CreateModelPricingResponse> {
    const model = await this.modelPricingService.createManagedModelPricing(body, request.user!.userId, request);
    return { code: 0, message: "success", data: model };
  }

  @Put("{id}")
  @Security("jwt")
  @CheckPermission(Permission.MODEL_PRICING_UPDATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:model_pricing:UpdatePricing",
    resourceKind: "single-resource",
    resource: platformModelPricingWriteResource,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(modelPricingIdParamsSchema),
    validateBody(updateModelPricingBodySchema),
  )
  public async updateModelPricing(
    @Path() id: string,
    @Body() body: UpdateModelPricingRequest,
    @Request() request: TypedRequest,
  ): Promise<UpdateModelPricingResponse> {
    const model = await this.modelPricingService.updateManagedModelPricing(id, body, request.user!.userId, request);
    return { code: 0, message: "success", data: model };
  }

  @Delete("{id}")
  @Security("jwt")
  @CheckPermission(Permission.MODEL_PRICING_UPDATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:model_pricing:DeletePricing",
    resourceKind: "single-resource",
    resource: platformModelPricingWriteResource,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(modelPricingIdParamsSchema),
  )
  public async deleteModelPricing(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<DeleteModelPricingResponse> {
    await this.modelPricingService.deleteManagedModelPricing(id, request.user!.userId, request);
    return { code: 0, message: "success" };
  }
}
