import {
  Body,
  Consumes,
  Controller,
  Get,
  Middlewares,
  Path,
  Post,
  Query,
  Request,
  Route,
  Security,
  Tags,
} from "@tsoa/runtime";
import type {
  DataMaintenanceImportPreviewResponse,
  DataMaintenanceRunDTO,
  DataMaintenanceRunListResponse,
  OptimizePreviewResponse,
  OptimizeRequest,
} from "@/api/dto/system/data-maintenance.dto";
import { DataMaintenanceService } from "@/services/system/data-maintenance.service";
import { CaptchaProtected, captchaMiddleware } from "@/util/captcha-protected-decorator";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import {
  importPreviewQuerySchema,
  maintenanceRunParamsSchema,
  maintenanceRunsQuerySchema,
  optimizeBodySchema,
  optimizePreviewBodySchema,
} from "@/api/schema/system/data-maintenance.schema";
import type { TypedRequest } from "@/types/express";
import {
  iamAuthenticatedAuthorizationMiddleware,
  iamCollectionAuthorizationMiddleware,
} from "@/iam/middleware/iam-authorization.middleware";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import {
  platformMaintenanceRunResourceResolver,
  platformMaintenanceDatasetResourceResolver,
  platformMaintenanceDatasetBatchResourceResolver,
  platformMaintenanceOptimizeBatchResourceResolver,
} from "@/iam/request/platform-maintenance-resource-resolvers";
import { BadRequestError } from "@/util/errors";

@Route("v1/data-maintenance")
@Tags("DataMaintenance")
export class DataMaintenanceController extends Controller {
  private readonly service = DataMaintenanceService.getInstance();

  @Post("optimize/preview")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:data_maintenance:PreviewOptimize",
      resourceKind: "batch",
      resource: platformMaintenanceDatasetBatchResourceResolver,
    }),
  )
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @CaptchaProtected({ action: "data_maintenance_optimize_preview", requireExplicitToken: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    captchaMiddleware({ action: "data_maintenance_optimize_preview", requireExplicitToken: true }),
    validateBody(optimizePreviewBodySchema),
  )
  public async optimizePreview(
    @Body() body: Pick<OptimizeRequest, "datasets" | "captchaToken">,
    @Request() request: TypedRequest,
  ): Promise<OptimizePreviewResponse> {
    return this.service.previewOptimizeRequest(body.datasets, request);
  }

  @Post("optimize")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:data_maintenance:CreateOptimizeRun",
      resourceKind: "batch",
      resource: platformMaintenanceOptimizeBatchResourceResolver,
    }),
  )
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @CaptchaProtected({ action: "data_maintenance_optimize", requireExplicitToken: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    captchaMiddleware({ action: "data_maintenance_optimize", requireExplicitToken: true }),
    validateBody(optimizeBodySchema),
  )
  public async optimize(
    @Request() request: TypedRequest,
    @Body() body: OptimizeRequest,
  ): Promise<DataMaintenanceRunDTO> {
    const confirmation = body.confirmation;
    if (confirmation !== "OPTIMIZE")
      throw new BadRequestError("Confirmation phrase is invalid", undefined, {
        messageKey: "system.invalidConfirmationPhrase",
      });
    return this.service.createOptimizeRequest(body, request) as any;
  }

  @Post("imports/preview/{dataset}")
  @Consumes("application/gzip")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:data_maintenance:PreviewImport",
      resourceKind: "single-resource",
      resource: platformMaintenanceDatasetResourceResolver,
    }),
  )
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @CaptchaProtected({ action: "data_maintenance_import_preview", requireExplicitToken: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    captchaMiddleware({ action: "data_maintenance_import_preview", requireExplicitToken: true }),
    validateParams(importPreviewQuerySchema),
  )
  public async importPreview(
    @Request() request: TypedRequest,
    @Path() dataset: string,
    @Body() _body: Record<string, unknown>,
  ): Promise<DataMaintenanceImportPreviewResponse> {
    return this.service.previewImportRequest(
      dataset,
      Buffer.isBuffer(request.body) ? request.body : Buffer.from([]),
      request,
    );
  }

  @Post("imports/{dataset}")
  @Consumes("application/gzip")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:data_maintenance:CreateImportRun",
      resourceKind: "single-resource",
      resource: platformMaintenanceDatasetResourceResolver,
    }),
  )
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @CaptchaProtected({ action: "data_maintenance_import", requireExplicitToken: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    captchaMiddleware({ action: "data_maintenance_import", requireExplicitToken: true }),
    validateParams(importPreviewQuerySchema),
  )
  public async createImport(
    @Request() request: TypedRequest,
    @Path() dataset: string,
    @Body() _body: Record<string, unknown>,
  ): Promise<DataMaintenanceRunDTO> {
    const confirmation = request.headers["x-maintenance-confirmation"];
    if (confirmation !== "IMPORT")
      throw new BadRequestError("Confirmation phrase is invalid", undefined, {
        messageKey: "system.invalidConfirmationPhrase",
      });
    return this.service.createImportRequest(
      dataset,
      Buffer.isBuffer(request.body) ? request.body : Buffer.from([]),
      request,
    ) as any;
  }

  @Get("runs")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:system:data_maintenance:ListRuns",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @Middlewares(validateQuery(maintenanceRunsQuerySchema))
  public async listRuns(
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Query() operation?: string,
    @Query() runStatus?: string,
    @Request() request?: TypedRequest,
  ): Promise<DataMaintenanceRunListResponse> {
    const result = await this.service.listRuns(page, pageSize, { operation, runStatus }, request);
    return { ...result, page, pageSize } as DataMaintenanceRunListResponse;
  }

  @Get("runs/{runId}")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:data_maintenance:GetRun",
      resourceKind: "single-resource",
      resource: platformMaintenanceRunResourceResolver,
    }),
  )
  @Middlewares(validateParams(maintenanceRunParamsSchema))
  public async getRun(@Path() runId: string, @Request() request: TypedRequest): Promise<DataMaintenanceRunDTO> {
    return (await this.service.getRun(runId, request)) as any;
  }
}
