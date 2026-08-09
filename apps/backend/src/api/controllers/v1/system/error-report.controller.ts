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
  errorGroupIdParamsSchema,
  errorGroupsQuerySchema,
  errorOccurrencesQuerySchema,
  updateErrorGroupStatusBodySchema,
} from "@/api/schema/system/error-report.schema";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";
import type { TypedRequest } from "@/types/express";
import { NotFoundError } from "@/util/errors";

@Route("v1/error-reports")
@Tags("ErrorReport")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "Invalid request")
export class ErrorReportController extends Controller {
  private readonly service = ErrorReportService.getInstance();

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

  @Get("")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_ERROR_REPORT_READ)
  @Middlewares(validateQuery(errorGroupsQuerySchema))
  public async listGroups(
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Query() resolutionStatus?: string,
    @Query() source?: string,
    @Query() search?: string,
    @Query() startDate?: string,
    @Query() endDate?: string,
  ): Promise<ErrorGroupListResponse> {
    const result = await this.service.getGroups({
      page,
      pageSize,
      resolutionStatus,
      source,
      search,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
    return { ...result, page, pageSize };
  }

  @Get("{id}")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_ERROR_REPORT_READ)
  @Middlewares(validateParams(errorGroupIdParamsSchema))
  public async getGroup(@Path() id: string) {
    const group = await this.service.getGroup(id);
    if (!group) throw new NotFoundError("Error group not found");
    return group;
  }

  @Get("{id}/occurrences")
  @Security("jwt")
  @RequirePermission(Permission.SYSTEM_ERROR_REPORT_READ)
  @Middlewares(validateParams(errorGroupIdParamsSchema), validateQuery(errorOccurrencesQuerySchema))
  public async listOccurrences(
    @Path() id: string,
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
  ): Promise<ErrorOccurrenceListResponse> {
    const result = await this.service.getOccurrences(id, page, pageSize);
    return { ...result, page, pageSize };
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
    if (!group) throw new NotFoundError("Error group not found");
    return this.service.updateGroupStatus(id, body.resolutionStatus);
  }
}
