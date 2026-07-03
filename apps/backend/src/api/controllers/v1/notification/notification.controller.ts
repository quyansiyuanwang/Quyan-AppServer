import {
  Controller,
  Route,
  Tags,
  Get,
  Post,
  Put,
  Delete,
  Path,
  Body,
  Request,
  Security,
  Middlewares,
  Query,
} from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express";
import { NotificationManagementService } from "@/services/notification/notification-management.service";
import type {
  UpdateNotificationPreferenceDto,
  CreateNotificationWebhookDto,
  UpdateNotificationWebhookDto,
  NotificationPreferenceDto,
  NotificationWebhookDto,
  NotificationLogListDto,
  NotificationEventInfoDto,
} from "@/api/dto/notification/notification.dto";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation/index";
import {
  updateNotificationPreferenceBodySchema,
  createNotificationWebhookBodySchema,
  updateNotificationWebhookBodySchema,
  webhookIdParamsSchema,
  notificationLogsQuerySchema,
} from "@/api/schema/notification/notification.schema";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { ReplayProtected } from "@/util/replay-protected-decorator";
import { Permission } from "@/constant/permission";

@Route("v1/notification")
@Tags("Notification / Event Center")
@Security("jwt")
export class NotificationController extends Controller {
  private service = NotificationManagementService.getInstance();

  /** Get the current user's notification preferences */
  @Get("preferences")
  @Security("jwt")
  @RequirePermission(Permission.NOTIFICATION_MANAGE)
  public async getPreferences(@Request() request: TypedRequest): Promise<NotificationPreferenceDto> {
    return this.service.getPreference(request.user!.userId);
  }

  /** Update notification preferences (email, subscribed events, thresholds, cooldown) */
  @Put("preferences")
  @Security("jwt")
  @RequirePermission(Permission.NOTIFICATION_MANAGE)
  @Middlewares(replayProtectionMiddleware, validateBody(updateNotificationPreferenceBodySchema))
  public async updatePreferences(
    @Body() body: UpdateNotificationPreferenceDto,
    @Request() request: TypedRequest,
  ): Promise<NotificationPreferenceDto> {
    return this.service.updatePreference(request.user!.userId, body, request);
  }

  /** List all webhooks for the current user */
  @Get("webhooks")
  @Security("jwt")
  @RequirePermission(Permission.NOTIFICATION_MANAGE)
  public async listWebhooks(@Request() request: TypedRequest): Promise<NotificationWebhookDto[]> {
    return this.service.listWebhooks(request.user!.userId);
  }

  /** Create a new webhook */
  @Post("webhooks")
  @Security("jwt")
  @RequirePermission(Permission.NOTIFICATION_MANAGE)
  @Middlewares(replayProtectionMiddleware, validateBody(createNotificationWebhookBodySchema))
  public async createWebhook(
    @Body() body: CreateNotificationWebhookDto,
    @Request() request: TypedRequest,
  ): Promise<NotificationWebhookDto> {
    return this.service.createWebhook(request.user!.userId, body, request);
  }

  /** Update an existing webhook */
  @Put("webhooks/{id}")
  @Security("jwt")
  @RequirePermission(Permission.NOTIFICATION_MANAGE)
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(webhookIdParamsSchema),
    validateBody(updateNotificationWebhookBodySchema),
  )
  public async updateWebhook(
    @Path() id: string,
    @Body() body: UpdateNotificationWebhookDto,
    @Request() request: TypedRequest,
  ): Promise<NotificationWebhookDto> {
    return this.service.updateWebhook(id, request.user!.userId, body, request);
  }

  /** Delete a webhook */
  @Delete("webhooks/{id}")
  @Security("jwt")
  @RequirePermission(Permission.NOTIFICATION_MANAGE)
  @Middlewares(replayProtectionMiddleware, validateParams(webhookIdParamsSchema))
  public async deleteWebhook(@Path() id: string, @Request() request: TypedRequest): Promise<{ success: boolean }> {
    await this.service.deleteWebhook(id, request.user!.userId, request);
    return { success: true };
  }

  /** Send a test notification to a webhook */
  @Post("webhooks/{id}/test")
  @Security("jwt")
  @RequirePermission(Permission.NOTIFICATION_MANAGE)
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateParams(webhookIdParamsSchema))
  public async testWebhook(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: boolean; error?: string }> {
    return this.service.testWebhook(id, request.user!.userId);
  }

  /** Send a test notification to the user's configured email address */
  @Post("email/test")
  @Security("jwt")
  @RequirePermission(Permission.NOTIFICATION_MANAGE)
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  public async testEmail(@Request() request: TypedRequest): Promise<{ success: boolean; error?: string }> {
    return this.service.testEmail(request.user!.userId);
  }

  /** Get notification delivery history (paginated) */
  @Get("logs")
  @Security("jwt")
  @RequirePermission(Permission.NOTIFICATION_MANAGE)
  @Middlewares(validateQuery(notificationLogsQuerySchema))
  public async getLogs(
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Request() request: TypedRequest,
  ): Promise<NotificationLogListDto> {
    return this.service.getLogs(request.user!.userId, page, pageSize);
  }

  /** Get the list of subscribable event types */
  @Get("events")
  @Security("jwt")
  public async getEventList(): Promise<NotificationEventInfoDto[]> {
    return this.service.getEventList();
  }
}
