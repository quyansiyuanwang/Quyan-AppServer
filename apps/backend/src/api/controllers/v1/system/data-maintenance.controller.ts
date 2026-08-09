import { Body, Consumes, Controller, Get, Middlewares, Path, Post, Query, Request, Route, Security, Tags } from "@tsoa/runtime";
import type {
  DataMaintenanceImportPreviewResponse,
  DataMaintenanceRunDTO,
  DataMaintenanceRunListResponse,
  OptimizePreviewResponse,
  OptimizeRequest,
} from "@/api/dto/system/data-maintenance.dto";
import { DataMaintenanceService } from "@/services/system/data-maintenance.service";
import { Permission } from "@/constant/permission";
import { RequirePermission } from "@/util/permission/permission-decorator";
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
import { BadRequestError } from "@/util/errors";

@Route("v1/data-maintenance")
@Tags("DataMaintenance")
export class DataMaintenanceController extends Controller {
  private readonly service = DataMaintenanceService.getInstance();

  @Post("optimize/preview")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_DATA_MAINTENANCE_MANAGE)
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @CaptchaProtected({ action: "data_maintenance_optimize_preview", requireExplicitToken: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    captchaMiddleware({ action: "data_maintenance_optimize_preview", requireExplicitToken: true }),
    validateBody(optimizePreviewBodySchema),
  )
  public async optimizePreview(@Body() body: Pick<OptimizeRequest, "datasets" | "captchaToken">): Promise<OptimizePreviewResponse> {
    return this.service.optimizePreview(body.datasets);
  }

  @Post("optimize")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_DATA_MAINTENANCE_MANAGE)
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @CaptchaProtected({ action: "data_maintenance_optimize", requireExplicitToken: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    captchaMiddleware({ action: "data_maintenance_optimize", requireExplicitToken: true }),
    validateBody(optimizeBodySchema),
  )
  public async optimize(@Request() request: TypedRequest, @Body() body: OptimizeRequest): Promise<DataMaintenanceRunDTO> {
    const confirmation = body.confirmation;
    if (confirmation !== "OPTIMIZE") throw new BadRequestError("Confirmation phrase is invalid");
    return this.service.createOptimizeRun(body.datasets, request.user?.userId, request.headers["x-request-id"] as string | undefined) as any;
  }

  @Post("imports/preview/{dataset}")
  @Consumes("application/gzip")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_DATA_MAINTENANCE_MANAGE)
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @CaptchaProtected({ action: "data_maintenance_import_preview", requireExplicitToken: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    captchaMiddleware({ action: "data_maintenance_import_preview", requireExplicitToken: true }),
    validateParams(importPreviewQuerySchema),
  )
  public async importPreview(@Request() request: TypedRequest, @Path() dataset: string, @Body() _body: Record<string, unknown>): Promise<DataMaintenanceImportPreviewResponse> {
    const result = await this.service.previewImport(dataset, Buffer.isBuffer(request.body) ? request.body : Buffer.from([]));
    const { rows: _rows, ...response } = result;
    return response;
  }

  @Post("imports/{dataset}")
  @Consumes("application/gzip")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_DATA_MAINTENANCE_MANAGE)
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @CaptchaProtected({ action: "data_maintenance_import", requireExplicitToken: true })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    captchaMiddleware({ action: "data_maintenance_import", requireExplicitToken: true }),
    validateParams(importPreviewQuerySchema),
  )
  public async createImport(@Request() request: TypedRequest, @Path() dataset: string, @Body() _body: Record<string, unknown>): Promise<DataMaintenanceRunDTO> {
    const confirmation = request.headers["x-maintenance-confirmation"];
    if (confirmation !== "IMPORT") throw new BadRequestError("Confirmation phrase is invalid");
    return this.service.createImportRun(
      dataset,
      Buffer.isBuffer(request.body) ? request.body : Buffer.from([]),
      request.user?.userId,
      request.headers["x-request-id"] as string | undefined,
    ) as any;
  }

  @Get("runs")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_DATA_MAINTENANCE_MANAGE)
  @Middlewares(validateQuery(maintenanceRunsQuerySchema))
  public async listRuns(
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Query() operation?: string,
    @Query() runStatus?: string,
  ): Promise<DataMaintenanceRunListResponse> {
    const result = await this.service.listRuns(page, pageSize, { operation, runStatus });
    return { ...result, page, pageSize } as DataMaintenanceRunListResponse;
  }

  @Get("runs/{runId}")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_DATA_MAINTENANCE_MANAGE)
  @Middlewares(validateParams(maintenanceRunParamsSchema))
  public async getRun(@Path() runId: string): Promise<DataMaintenanceRunDTO> {
    return (await this.service.getRun(runId)) as any;
  }
}
