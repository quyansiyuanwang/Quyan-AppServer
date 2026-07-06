import {
  Body,
  Controller,
  Delete,
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
  CreateTicketCommentDto,
  CreateTicketDto,
  CreateTicketReviewCommentDto,
  TicketDetailDto,
  TicketListResponseDto,
  TicketReviewAssignmentConfigDto,
  ReviewTicketDto,
  SetTicketReviewAssignmentConfigDto,
  UpdateMyTicketDto,
} from "@/api/dto/ticket/ticket.dto";
import type { ErrorResponse } from "@/api/response";
import { Permission } from "@/constant/permission";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { TicketService } from "@/services/ticket/ticket.service";
import type { TypedRequest } from "@/types/express";
import { RequirePermission } from "@/util/permission/permission-decorator";
import {
  createTicketBodySchema,
  createTicketCommentBodySchema,
  createTicketReviewCommentBodySchema,
  ticketIdParamsSchema,
  ticketListQuerySchema,
  ticketReviewListQuerySchema,
  setTicketAssignmentConfigBodySchema,
  reviewTicketBodySchema,
  updateMyTicketBodySchema,
} from "@/api/schema/ticket/ticket.schema";

@Route("v1/tickets")
@Tags("Ticket")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class TicketController extends Controller {
  private readonly service = TicketService.getInstance();

  @Post("")
  @Security("jwt")
  @RequirePermission(Permission.TICKET_SUBMIT)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "提交失败")
  @Middlewares(replayProtectionMiddleware, validateBody(createTicketBodySchema))
  public async createTicket(
    @Body() body: CreateTicketDto,
    @Request() request: TypedRequest,
  ): Promise<TicketDetailDto> {
    return this.service.createTicket(request.user!.userId, body, request);
  }

  @Get("my")
  @Security("jwt")
  @RequirePermission(Permission.TICKET_SELF_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(validateQuery(ticketListQuerySchema))
  public async listMyTickets(
    @Query() page: number = 1,
    @Query() pageSize: number = 10,
    @Query() keyword?: string,
    @Query() workflowStatus?: "pending" | "processing" | "accepted" | "rejected" | "completed",
    @Query() type?: "suggestion" | "bug" | "other",
    @Request() request?: TypedRequest,
  ): Promise<TicketListResponseDto> {
    return this.service.listMyTickets(request!.user!.userId, { page, pageSize, keyword, workflowStatus, type });
  }

  @Get("my/{id}")
  @Security("jwt")
  @RequirePermission(Permission.TICKET_SELF_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "工单不存在")
  @Middlewares(validateParams(ticketIdParamsSchema))
  public async getMyTicketDetail(@Path() id: string, @Request() request: TypedRequest): Promise<TicketDetailDto> {
    return this.service.getMyTicketDetail(id, request.user!.userId);
  }

  @Put("my/{id}")
  @Security("jwt")
  @RequirePermission(Permission.TICKET_SELF_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "工单不存在")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(ticketIdParamsSchema),
    validateBody(updateMyTicketBodySchema),
  )
  public async updateMyTicket(
    @Path() id: string,
    @Body() body: UpdateMyTicketDto,
    @Request() request: TypedRequest,
  ): Promise<TicketDetailDto> {
    return this.service.updateMyTicket(id, request.user!.userId, body, request);
  }

  @Post("my/{id}/comments")
  @Security("jwt")
  @RequirePermission(Permission.TICKET_COMMENT)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "工单不存在")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(ticketIdParamsSchema),
    validateBody(createTicketCommentBodySchema),
  )
  public async addMyComment(
    @Path() id: string,
    @Body() body: CreateTicketCommentDto,
    @Request() request: TypedRequest,
  ) {
    return this.service.addMyComment(id, request.user!.userId, body, request);
  }

  @Get("review")
  @Security("jwt")
  @RequirePermission(Permission.TICKET_REVIEW_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(validateQuery(ticketReviewListQuerySchema))
  public async listReviewTickets(
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Query() keyword?: string,
    @Query() workflowStatus?: "pending" | "processing" | "accepted" | "rejected" | "completed",
    @Query() type?: "suggestion" | "bug" | "other",
    @Query() priority?: "low" | "medium" | "high" | "urgent",
    @Query() assigneeUserId?: string,
    @Query() userId?: string,
    @Query() startTime?: string,
    @Query() endTime?: string,
  ): Promise<TicketListResponseDto> {
    return this.service.listReviewTickets({
      page,
      pageSize,
      keyword,
      workflowStatus,
      type,
      priority,
      assigneeUserId,
      userId,
      startTime,
      endTime,
    });
  }

  @Get("review/assignment-rules")
  @Security("jwt")
  @RequirePermission(Permission.TICKET_REVIEW_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async getReviewAssignmentRules(): Promise<TicketReviewAssignmentConfigDto> {
    return this.service.getAssignmentConfig();
  }

  @Put("review/assignment-rules")
  @Security("jwt")
  @RequirePermission(Permission.TICKET_REVIEW_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(replayProtectionMiddleware, validateBody(setTicketAssignmentConfigBodySchema))
  public async setReviewAssignmentRules(
    @Body() body: SetTicketReviewAssignmentConfigDto,
    @Request() request: TypedRequest,
  ): Promise<TicketReviewAssignmentConfigDto> {
    return this.service.updateAssignmentConfig(body, request.user!.userId, request);
  }

  @Get("review/{id}")
  @Security("jwt")
  @RequirePermission(Permission.TICKET_REVIEW_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "工单不存在")
  @Middlewares(validateParams(ticketIdParamsSchema))
  public async getReviewTicketDetail(@Path() id: string): Promise<TicketDetailDto> {
    return this.service.getReviewTicketDetail(id);
  }

  @Put("review/{id}")
  @Security("jwt")
  @RequirePermission(Permission.TICKET_REVIEW_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "工单不存在")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(ticketIdParamsSchema),
    validateBody(reviewTicketBodySchema),
  )
  public async reviewTicket(
    @Path() id: string,
    @Body() body: ReviewTicketDto,
    @Request() request: TypedRequest,
  ): Promise<TicketDetailDto> {
    return this.service.reviewTicket(id, request.user!.userId, body, request);
  }

  @Post("review/{id}/comments")
  @Security("jwt")
  @RequirePermission(Permission.TICKET_REVIEW_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "工单不存在")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(ticketIdParamsSchema),
    validateBody(createTicketReviewCommentBodySchema),
  )
  public async addReviewComment(
    @Path() id: string,
    @Body() body: CreateTicketReviewCommentDto,
    @Request() request: TypedRequest,
  ) {
    return this.service.addReviewComment(id, request.user!.userId, body, request);
  }

  @Delete("review/{id}")
  @Security("jwt")
  @RequirePermission(Permission.TICKET_REVIEW_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "工单不存在")
  @Middlewares(replayProtectionMiddleware, validateParams(ticketIdParamsSchema))
  public async deleteTicket(@Path() id: string, @Request() request: TypedRequest): Promise<boolean> {
    await this.service.deleteTicket(id, request.user!.userId, request);
    return true;
  }
}
