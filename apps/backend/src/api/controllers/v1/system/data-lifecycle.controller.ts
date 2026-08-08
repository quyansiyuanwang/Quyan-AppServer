import {
  Body,
  Controller,
  Get,
  Middlewares,
  Path,
  Post,
  Put,
  Query,
  Request,
  Route,
  Security,
  Tags,
} from "@tsoa/runtime";
import type {
  ArchiveDownloadResponse,
  DataLifecyclePolicyDTO,
  DataLifecyclePreviewResponse,
  DataLifecycleRunListResponse,
  DataLifecycleRunResultResponse,
  UpdateDataLifecyclePolicyRequest,
} from "@/api/dto/system/data-lifecycle.dto";
import { DataLifecycleService } from "@/services/system/data-lifecycle.service";
import { Permission } from "@/constant/permission";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import {
  lifecycleArtifactParamsSchema,
  lifecycleDatasetParamsSchema,
  lifecycleRunsQuerySchema,
  updateLifecyclePolicyBodySchema,
} from "@/api/schema/system/data-lifecycle.schema";
import type { TypedRequest } from "@/types/express";

@Route("v1/data-lifecycle")
@Tags("DataLifecycle")
export class DataLifecycleController extends Controller {
  private readonly service = DataLifecycleService.getInstance();

  @Get("policies")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_DATA_LIFECYCLE_MANAGE)
  public async listPolicies(): Promise<DataLifecyclePolicyDTO[]> {
    return this.service.listPolicies();
  }

  @Put("policies/{dataset}")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_DATA_LIFECYCLE_MANAGE)
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(lifecycleDatasetParamsSchema),
    validateBody(updateLifecyclePolicyBodySchema),
  )
  public async updatePolicy(
    @Path() dataset: string,
    @Body() body: UpdateDataLifecyclePolicyRequest,
  ): Promise<DataLifecyclePolicyDTO> {
    return this.service.updatePolicy(dataset, body.enabled, body.hotRetentionDays);
  }

  @Get("policies/{dataset}/preview")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_DATA_LIFECYCLE_MANAGE)
  @Middlewares(validateParams(lifecycleDatasetParamsSchema))
  public async preview(@Path() dataset: string): Promise<DataLifecyclePreviewResponse> {
    return this.service.preview(dataset);
  }

  @Post("policies/{dataset}/run")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_DATA_LIFECYCLE_MANAGE)
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(lifecycleDatasetParamsSchema),
  )
  public async run(@Request() request: TypedRequest, @Path() dataset: string): Promise<DataLifecycleRunResultResponse> {
    const result = await this.service.runPolicy(dataset, "manual", request.user?.userId);
    if (!result) return { runId: "", candidateCount: 0, archivedCount: 0, deletedCount: 0 };
    return {
      runId: result.runId,
      candidateCount: result.candidateCount,
      archivedCount: result.archivedCount,
      deletedCount: result.deletedCount,
      artifactId: result.artifact?.id,
    };
  }

  @Get("runs")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_DATA_LIFECYCLE_MANAGE)
  @Middlewares(validateQuery(lifecycleRunsQuerySchema))
  public async listRuns(
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
  ): Promise<DataLifecycleRunListResponse> {
    const result = await this.service.listRuns(page, pageSize);
    return {
      ...result,
      page,
      pageSize,
      items: result.items.map((run) => ({
        ...run,
        artifacts: run.artifacts.map((artifact) => ({ ...artifact, byteSize: artifact.byteSize.toString() })),
      })),
    };
  }

  @Post("artifacts/{artifactId}/download")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_DATA_LIFECYCLE_MANAGE)
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(lifecycleArtifactParamsSchema),
  )
  public async download(@Path() artifactId: string): Promise<ArchiveDownloadResponse> {
    return { url: await this.service.getArchiveDownloadUrl(artifactId), expiresInSeconds: 300 };
  }
}
