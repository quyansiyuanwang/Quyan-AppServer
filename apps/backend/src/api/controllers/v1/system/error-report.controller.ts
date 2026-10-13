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
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type {
  ClientErrorReportRequest,
  ClientErrorReportBatchRequest,
  ErrorGroupListResponse,
  ErrorOccurrenceListResponse,
  UpdateErrorGroupStatusRequest,
} from "@/api/dto/system/error-report.dto";
import { ErrorReportService } from "@/services/system/error-report.service";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import {
  clientErrorReportBodySchema,
  clientErrorReportBatchBodySchema,
  errorGroupIdParamsSchema,
  errorGroupsQuerySchema,
  errorOccurrencesQuerySchema,
  updateErrorGroupStatusBodySchema,
} from "@/api/schema/system/error-report.schema";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";
import type { TypedRequest } from "@/types/express";
import { PlatformErrorGroupListIamService } from "@/services/system/platform-error-group-list-iam.service";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import { PlatformErrorGroupReadIamService } from "@/services/system/platform-error-group-read-iam.service";
import {
  iamAuthenticatedAuthorizationMiddleware,
  iamCollectionAuthorizationMiddleware,
} from "@/iam/middleware/iam-authorization.middleware";
import { platformErrorGroupResourceResolver } from "@/iam/request/platform-error-group-resource-resolvers";
import { NotFoundError } from "@/util/errors";

@Route("v1/error-reports")
@Tags("ErrorReport")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "Invalid request")
export class ErrorReportController extends Controller {
  private readonly service = ErrorReportService.getInstance();
  private readonly iamReads = PlatformErrorGroupReadIamService.getInstance();
  private readonly iamLists = PlatformErrorGroupListIamService.getInstance();

  @Post("client")
  @SuccessResponse(HttpStatusCode.Accepted, "Accepted")
  @Middlewares(validateBody(clientErrorReportBodySchema))
  public async reportClientError(
    @Request() request: TypedRequest,
    @Body() body: ClientErrorReportRequest,
  ): Promise<{ accepted: boolean }> {
    await this.service.reportClientError(request, { ...body, source: "frontend" });
    this.setStatus(HttpStatusCode.Accepted);
    return { accepted: true };
  }

  @Post("client/batch")
  @SuccessResponse(HttpStatusCode.Accepted, "Accepted")
  @Middlewares(validateBody(clientErrorReportBatchBodySchema))
  public async reportClientErrorBatch(
    @Request() request: TypedRequest,
    @Body() body: ClientErrorReportBatchRequest,
  ): Promise<{ accepted: number }> {
    await this.service.reportClientErrors(
      request,
      body.reports.map((report) => ({ ...report, source: "frontend" })),
    );
    this.setStatus(HttpStatusCode.Accepted);
    return { accepted: body.reports.length };
  }

  @Get("")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:system:error_report:ListErrorGroups",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
    validateQuery(errorGroupsQuerySchema),
  )
  public async listGroups(
    @Request() request: TypedRequest,
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Query() resolutionStatus?: string,
    @Query() source?: string,
    @Query() search?: string,
    @Query() startDate?: string,
    @Query() endDate?: string,
  ): Promise<ErrorGroupListResponse> {
    const result = await this.iamLists.list(
      {
        page,
        pageSize,
        resolutionStatus,
        source,
        search,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      },
      request,
    );
    return { ...result, page, pageSize };
  }

  @Get("{id}")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:error_report:GetErrorGroup",
      resourceKind: "single-resource",
      resource: platformErrorGroupResourceResolver,
    }),
    validateParams(errorGroupIdParamsSchema),
  )
  public async getGroup(@Path() id: string, @Request() request: TypedRequest) {
    return this.iamReads.read("quyan:system:error_report:GetErrorGroup", id, request, async () => {
      const group = await this.service.getGroup(id);
      if (!group)
        throw new NotFoundError("Error group not found", undefined, { messageKey: "system.errorGroupNotFound" });
      return group;
    });
  }

  @Get("{id}/occurrences")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:error_report:ListErrorOccurrences",
      resourceKind: "single-resource",
      resource: platformErrorGroupResourceResolver,
    }),
    validateParams(errorGroupIdParamsSchema),
    validateQuery(errorOccurrencesQuerySchema),
  )
  public async listOccurrences(
    @Path() id: string,
    @Request() request: TypedRequest,
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
  ): Promise<ErrorOccurrenceListResponse> {
    return this.iamReads.read("quyan:system:error_report:ListErrorOccurrences", id, request, async (native) => {
      const result = await this.service.getOccurrences(id, page, pageSize, native);
      return { ...result, page, pageSize };
    });
  }

  @Put("{id}/status")
  @Security("jwt")
  @ReplayProtected()
  @RequirePermission(Permission.SYSTEM_ERROR_REPORT_UPDATE)
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(errorGroupIdParamsSchema),
    validateBody(updateErrorGroupStatusBodySchema),
  )
  public async updateStatus(@Path() id: string, @Body() body: UpdateErrorGroupStatusRequest) {
    const group = await this.service.getGroup(id);
    if (!group)
      throw new NotFoundError("Error group not found", undefined, { messageKey: "system.errorGroupNotFound" });
    return this.service.updateGroupStatus(id, body.resolutionStatus);
  }
}
