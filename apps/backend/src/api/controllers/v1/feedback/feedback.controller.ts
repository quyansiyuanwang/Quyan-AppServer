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
  CreateFeedbackCommentDto,
  CreateFeedbackDto,
  CreateFeedbackReviewCommentDto,
  FeedbackDetailDto,
  FeedbackListResponseDto,
  FeedbackReviewAssignmentConfigDto,
  ReviewFeedbackDto,
  SetFeedbackReviewAssignmentConfigDto,
  UpdateMyFeedbackDto,
} from "@/api/dto/feedback/feedback.dto";
import type { ErrorResponse } from "@/api/response";
import { Permission } from "@/constant/permission";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { FeedbackService } from "@/services/feedback/feedback.service";
import type { TypedRequest } from "@/types/express";
import { RequirePermission } from "@/util/permission/permission-decorator";
import {
  createFeedbackBodySchema,
  createFeedbackCommentBodySchema,
  createFeedbackReviewCommentBodySchema,
  feedbackIdParamsSchema,
  feedbackListQuerySchema,
  feedbackReviewListQuerySchema,
  setFeedbackAssignmentConfigBodySchema,
  reviewFeedbackBodySchema,
  updateMyFeedbackBodySchema,
} from "@/api/schema/feedback/feedback.schema";

@Route("v1/feedback")
@Tags("Feedback")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class FeedbackController extends Controller {
  private readonly service = FeedbackService.getInstance();

  @Post("")
  @Security("jwt")
  @RequirePermission(Permission.FEEDBACK_SUBMIT)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "提交失败")
  @Middlewares(replayProtectionMiddleware, validateBody(createFeedbackBodySchema))
  public async createFeedback(
    @Body() body: CreateFeedbackDto,
    @Request() request: TypedRequest,
  ): Promise<FeedbackDetailDto> {
    return this.service.createFeedback(request.user!.userId, body, request);
  }

  @Get("my")
  @Security("jwt")
  @RequirePermission(Permission.FEEDBACK_SELF_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(validateQuery(feedbackListQuerySchema))
  public async listMyFeedback(
    @Query() page: number = 1,
    @Query() pageSize: number = 10,
    @Query() keyword?: string,
    @Query() workflowStatus?: "pending" | "processing" | "accepted" | "rejected" | "completed",
    @Query() type?: "suggestion" | "bug" | "other",
    @Request() request?: TypedRequest,
  ): Promise<FeedbackListResponseDto> {
    return this.service.listMyFeedback(request!.user!.userId, { page, pageSize, keyword, workflowStatus, type });
  }

  @Get("my/{id}")
  @Security("jwt")
  @RequirePermission(Permission.FEEDBACK_SELF_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "反馈不存在")
  @Middlewares(validateParams(feedbackIdParamsSchema))
  public async getMyFeedbackDetail(@Path() id: string, @Request() request: TypedRequest): Promise<FeedbackDetailDto> {
    return this.service.getMyFeedbackDetail(id, request.user!.userId);
  }

  @Put("my/{id}")
  @Security("jwt")
  @RequirePermission(Permission.FEEDBACK_SELF_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "反馈不存在")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(feedbackIdParamsSchema),
    validateBody(updateMyFeedbackBodySchema),
  )
  public async updateMyFeedback(
    @Path() id: string,
    @Body() body: UpdateMyFeedbackDto,
    @Request() request: TypedRequest,
  ): Promise<FeedbackDetailDto> {
    return this.service.updateMyFeedback(id, request.user!.userId, body, request);
  }

  @Post("my/{id}/comments")
  @Security("jwt")
  @RequirePermission(Permission.FEEDBACK_COMMENT)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "反馈不存在")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(feedbackIdParamsSchema),
    validateBody(createFeedbackCommentBodySchema),
  )
  public async addMyComment(
    @Path() id: string,
    @Body() body: CreateFeedbackCommentDto,
    @Request() request: TypedRequest,
  ) {
    return this.service.addMyComment(id, request.user!.userId, body, request);
  }

  @Get("review")
  @Security("jwt")
  @RequirePermission(Permission.FEEDBACK_REVIEW_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(validateQuery(feedbackReviewListQuerySchema))
  public async listReviewFeedback(
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
  ): Promise<FeedbackListResponseDto> {
    return this.service.listReviewFeedback({
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

  @Get("review/{id}")
  @Security("jwt")
  @RequirePermission(Permission.FEEDBACK_REVIEW_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "反馈不存在")
  @Middlewares(validateParams(feedbackIdParamsSchema))
  public async getReviewFeedbackDetail(@Path() id: string): Promise<FeedbackDetailDto> {
    return this.service.getReviewFeedbackDetail(id);
  }

  @Put("review/{id}")
  @Security("jwt")
  @RequirePermission(Permission.FEEDBACK_REVIEW_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "反馈不存在")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(feedbackIdParamsSchema),
    validateBody(reviewFeedbackBodySchema),
  )
  public async reviewFeedback(
    @Path() id: string,
    @Body() body: ReviewFeedbackDto,
    @Request() request: TypedRequest,
  ): Promise<FeedbackDetailDto> {
    return this.service.reviewFeedback(id, request.user!.userId, body, request);
  }

  @Post("review/{id}/comments")
  @Security("jwt")
  @RequirePermission(Permission.FEEDBACK_REVIEW_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "反馈不存在")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(feedbackIdParamsSchema),
    validateBody(createFeedbackReviewCommentBodySchema),
  )
  public async addReviewComment(
    @Path() id: string,
    @Body() body: CreateFeedbackReviewCommentDto,
    @Request() request: TypedRequest,
  ) {
    return this.service.addReviewComment(id, request.user!.userId, body, request);
  }

  @Delete("review/{id}")
  @Security("jwt")
  @RequirePermission(Permission.FEEDBACK_REVIEW_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "反馈不存在")
  @Middlewares(replayProtectionMiddleware, validateParams(feedbackIdParamsSchema))
  public async deleteFeedback(@Path() id: string, @Request() request: TypedRequest): Promise<boolean> {
    await this.service.deleteFeedback(id, request.user!.userId, request);
    return true;
  }

  @Get("review/assignment-rules")
  @Security("jwt")
  @RequirePermission(Permission.FEEDBACK_REVIEW_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async getReviewAssignmentRules(): Promise<FeedbackReviewAssignmentConfigDto> {
    return this.service.getAssignmentConfig();
  }

  @Put("review/assignment-rules")
  @Security("jwt")
  @RequirePermission(Permission.FEEDBACK_REVIEW_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(replayProtectionMiddleware, validateBody(setFeedbackAssignmentConfigBodySchema))
  public async setReviewAssignmentRules(
    @Body() body: SetFeedbackReviewAssignmentConfigDto,
    @Request() request: TypedRequest,
  ): Promise<FeedbackReviewAssignmentConfigDto> {
    return this.service.updateAssignmentConfig(body, request.user!.userId, request);
  }
}
