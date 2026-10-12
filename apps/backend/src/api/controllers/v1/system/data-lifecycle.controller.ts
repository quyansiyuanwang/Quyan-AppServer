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
  ArchiveArtifactListResponse,
  BatchDataLifecycleRunRequest,
  BatchDataLifecycleRunResponse,
  DataLifecycleCandidateListResponse,
  DataLifecyclePolicyDTO,
  DataLifecyclePreviewResponse,
  DataLifecycleScheduleDTO,
  DataLifecycleRunListResponse,
  DataLifecycleRunResultResponse,
  UpdateDataLifecyclePolicyRequest,
  UpdateDataLifecycleScheduleRequest,
} from "@/api/dto/system/data-lifecycle.dto";
import { DataLifecycleService } from "@/services/system/data-lifecycle.service";
import { DataLifecycleSchedulerService } from "@/services/system/data-lifecycle-scheduler.service";
import { Permission } from "@/constant/permission";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import {
  lifecycleArtifactParamsSchema,
  batchLifecycleRunBodySchema,
  lifecycleArtifactsQuerySchema,
  lifecycleCandidatesQuerySchema,
  lifecycleDatasetParamsSchema,
  lifecycleRunParamsSchema,
  lifecycleRunsQuerySchema,
  updateLifecyclePolicyBodySchema,
  updateLifecycleScheduleBodySchema,
} from "@/api/schema/system/data-lifecycle.schema";
import type { TypedRequest } from "@/types/express";
import {
  iamAuthenticatedAuthorizationMiddleware,
  iamCollectionAuthorizationMiddleware,
} from "@/iam/middleware/iam-authorization.middleware";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import {
  platformLifecycleDatasetResourceResolver,
  platformLifecycleScheduleResourceResolver,
  platformLifecycleRunResourceResolver,
  platformLifecycleArtifactResourceResolver,
} from "@/iam/request/platform-lifecycle-resource-resolvers";

@Route("v1/data-lifecycle")
@Tags("DataLifecycle")
export class DataLifecycleController extends Controller {
  private readonly service = DataLifecycleService.getInstance();
  private readonly scheduler = DataLifecycleSchedulerService.getInstance();

  @Get("policies")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:system:data_lifecycle:ListPolicies",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  public async listPolicies(@Request() request: TypedRequest): Promise<DataLifecyclePolicyDTO[]> {
    return await this.service.listPoliciesRequest(request);
  }

  @Get("schedule")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:data_lifecycle:GetSchedule",
      resourceKind: "single-resource",
      resource: platformLifecycleScheduleResourceResolver,
    }),
  )
  public async getSchedule(@Request() request: TypedRequest): Promise<DataLifecycleScheduleDTO> {
    return this.service.getScheduleRequest(request);
  }

  @Put("schedule")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:data_lifecycle:UpdateSchedule",
      resourceKind: "single-resource",
      resource: platformLifecycleScheduleResourceResolver,
    }),
  )
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(updateLifecycleScheduleBodySchema),
  )
  public async updateSchedule(
    @Request() request: TypedRequest,
    @Body() body: UpdateDataLifecycleScheduleRequest,
  ): Promise<DataLifecycleScheduleDTO> {
    const schedule = await this.service.updateScheduleRequest(body, request);
    await this.scheduler.refreshSchedule();
    return schedule;
  }

  @Put("policies/{dataset}")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:data_lifecycle:UpdatePolicy",
      resourceKind: "single-resource",
      resource: platformLifecycleDatasetResourceResolver,
    }),
  )
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(lifecycleDatasetParamsSchema),
    validateBody(updateLifecyclePolicyBodySchema),
  )
  public async updatePolicy(
    @Request() request: TypedRequest,
    @Path() dataset: string,
    @Body() body: UpdateDataLifecyclePolicyRequest,
  ): Promise<DataLifecyclePolicyDTO> {
    return this.service.updatePolicyRequest(dataset, body, request);
  }

  @Get("policies/{dataset}/preview")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:data_lifecycle:PreviewPolicy",
      resourceKind: "single-resource",
      resource: platformLifecycleDatasetResourceResolver,
    }),
  )
  @Middlewares(validateParams(lifecycleDatasetParamsSchema))
  public async preview(
    @Request() request: TypedRequest,
    @Path() dataset: string,
  ): Promise<DataLifecyclePreviewResponse> {
    return this.service.previewRequest(dataset, request);
  }

  @Get("policies/{dataset}/candidates")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:data_lifecycle:ListCandidates",
      resourceKind: "single-resource",
      resource: platformLifecycleDatasetResourceResolver,
    }),
  )
  @Middlewares(validateParams(lifecycleDatasetParamsSchema), validateQuery(lifecycleCandidatesQuerySchema))
  public async listCandidates(
    @Request() request: TypedRequest,
    @Path() dataset: string,
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
  ): Promise<DataLifecycleCandidateListResponse> {
    const result = await this.service.listCandidatesRequest(dataset, page, pageSize, request);
    return { ...result, page, pageSize };
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

  @Post("batch/run")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_DATA_LIFECYCLE_MANAGE)
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(batchLifecycleRunBodySchema),
  )
  public async runBatch(
    @Request() request: TypedRequest,
    @Body() body: BatchDataLifecycleRunRequest,
  ): Promise<BatchDataLifecycleRunResponse> {
    const result = await this.scheduler.runManualBatch(body.datasets ?? [], request.user?.userId);
    return (
      result ?? {
        items: [],
        completedCount: 0,
        failedCount: 0,
        skippedCount: 0,
      }
    );
  }

  @Get("runs")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:system:data_lifecycle:ListRuns",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @Middlewares(validateQuery(lifecycleRunsQuerySchema))
  public async listRuns(
    @Request() request: TypedRequest,
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
  ): Promise<DataLifecycleRunListResponse> {
    const result = await this.service.listRunsRequest(page, pageSize, request);
    return {
      ...result,
      page,
      pageSize,
      items: result.items.map(({ _count, ...run }) => ({ ...run, artifactCount: _count.artifacts })),
    };
  }

  @Get("runs/{runId}/artifacts")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:data_lifecycle:ListArtifacts",
      resourceKind: "single-resource",
      resource: platformLifecycleRunResourceResolver,
    }),
  )
  @Middlewares(validateParams(lifecycleRunParamsSchema), validateQuery(lifecycleArtifactsQuerySchema))
  public async listArtifacts(
    @Request() request: TypedRequest,
    @Path() runId: string,
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
  ): Promise<ArchiveArtifactListResponse> {
    const result = await this.service.listArtifactsRequest(runId, page, pageSize, request);
    return {
      ...result,
      page,
      pageSize,
      items: result.items.map((artifact) => ({ ...artifact, byteSize: artifact.byteSize.toString() })),
    };
  }

  @Post("artifacts/{artifactId}/download")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:data_lifecycle:DownloadArtifact",
      resourceKind: "single-resource",
      resource: platformLifecycleArtifactResourceResolver,
    }),
  )
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(lifecycleArtifactParamsSchema),
  )
  public async download(
    @Request() request: TypedRequest,
    @Path() artifactId: string,
  ): Promise<ArchiveDownloadResponse> {
    return this.service.getArchiveDownloadRequest(artifactId, request);
  }
}
