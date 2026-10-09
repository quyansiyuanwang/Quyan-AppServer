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
  NotificationInboxListDto,
  MarkNotificationInboxReadDto,
} from "@/api/dto/notification/notification.dto";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation/index";
import {
  updateNotificationPreferenceBodySchema,
  createNotificationWebhookBodySchema,
  updateNotificationWebhookBodySchema,
  webhookIdParamsSchema,
  notificationLogsQuerySchema,
  notificationInboxQuerySchema,
  markNotificationInboxReadBodySchema,
} from "@/api/schema/notification/notification.schema";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { ReplayProtected } from "@/util/replay-protected-decorator";
import { Permission } from "@/constant/permission";
import { CheckPermission, PermissionCheckMode } from "@/util/permission/permission-decorator";
import {
  iamAuthenticatedAuthorizationMiddleware,
  iamCollectionAuthorizationMiddleware,
} from "@/iam/middleware/iam-authorization.middleware";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";

import { notificationWebhookResourceResolver } from "@/iam/request/notification-resource-resolvers";

@Route("v1/notification")
@Tags("Notification / Event Center")
@Security("jwt")
export class NotificationController extends Controller {
  private service = NotificationManagementService.getInstance();

  /** Get the current user's notification preferences */
  @Get("preferences")
  @Security("jwt")
  @CheckPermission(Permission.NOTIFICATION_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:notification:GetPreferences",
    resourceKind: "single-resource",
    resource: iamAuthenticatedUserResourceResolver,
  })
  public async getPreferences(@Request() request: TypedRequest): Promise<NotificationPreferenceDto> {
    return this.service.getPreference(request.user!.userId, request);
  }

  /** Update notification preferences (email, subscribed events, thresholds, cooldown) */
  @Put("preferences")
  @Security("jwt")
  @CheckPermission(Permission.NOTIFICATION_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:notification:UpdatePreferences",
    resourceKind: "single-resource",
    resource: iamAuthenticatedUserResourceResolver,
  })
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
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:notification:ListWebhooks",
      resourceKind: "collection",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  public async listWebhooks(@Request() request: TypedRequest): Promise<NotificationWebhookDto[]> {
    return this.service.listWebhooks(request.user!.userId, request);
  }

  /** Create a new webhook */
  @Post("webhooks")
  @Security("jwt")
  @CheckPermission(Permission.NOTIFICATION_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:notification:CreateWebhook",
    resourceKind: "single-resource",
    resource: iamAuthenticatedUserResourceResolver,
  })
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
  @CheckPermission(Permission.NOTIFICATION_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:notification:UpdateWebhook",
    resourceKind: "single-resource",
    resource: notificationWebhookResourceResolver,
  })
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
  @CheckPermission(Permission.NOTIFICATION_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:notification:DeleteWebhook",
    resourceKind: "single-resource",
    resource: notificationWebhookResourceResolver,
  })
  @Middlewares(replayProtectionMiddleware, validateParams(webhookIdParamsSchema))
  public async deleteWebhook(@Path() id: string, @Request() request: TypedRequest): Promise<{ success: boolean }> {
    await this.service.deleteWebhook(id, request.user!.userId, request);
    return { success: true };
  }

  /** Send a test notification to a webhook */
  @Post("webhooks/{id}/test")
  @Security("jwt")
  @CheckPermission(Permission.NOTIFICATION_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:notification:TestWebhook",
    resourceKind: "single-resource",
    resource: notificationWebhookResourceResolver,
  })
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateParams(webhookIdParamsSchema))
  public async testWebhook(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: boolean; error?: string }> {
    return this.service.testWebhook(id, request.user!.userId, request);
  }

  /** Send a test notification to the user's configured email address */
  @Post("email/test")
  @Security("jwt")
  @CheckPermission(Permission.NOTIFICATION_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:notification:TestEmail",
    resourceKind: "single-resource",
    resource: iamAuthenticatedUserResourceResolver,
  })
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  public async testEmail(@Request() request: TypedRequest): Promise<{ success: boolean; error?: string }> {
    return this.service.testEmail(request.user!.userId, request);
  }

  /** Get notification delivery history (paginated) */
  @Get("logs")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:notification:ListDeliveryLogs",
      resourceKind: "collection",
      resource: iamAuthenticatedUserResourceResolver,
    }),
    validateQuery(notificationLogsQuerySchema),
  )
  public async getLogs(
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Request() request: TypedRequest,
  ): Promise<NotificationLogListDto> {
    return this.service.getLogs(request.user!.userId, page, pageSize, request);
  }

  /** Get in-app inbox notifications */
  @Get("inbox")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:notification:ListInbox",
      resourceKind: "collection",
      resource: iamAuthenticatedUserResourceResolver,
    }),
    validateQuery(notificationInboxQuerySchema),
  )
  public async getInbox(
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Query() unreadOnly: boolean = false,
    @Request() request: TypedRequest,
  ): Promise<NotificationInboxListDto> {
    return this.service.getInbox(request.user!.userId, page, pageSize, unreadOnly, request);
  }

  /** Mark inbox notifications as read */
  @Post("inbox/read")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:notification:MarkInboxRead",
      resourceKind: "collection",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  @Middlewares(replayProtectionMiddleware, validateBody(markNotificationInboxReadBodySchema))
  public async markInboxRead(
    @Body() body: MarkNotificationInboxReadDto,
    @Request() request: TypedRequest,
  ): Promise<{ success: boolean; count: number }> {
    return this.service.markInboxRead(request.user!.userId, body, request);
  }

  /** Confirm as read all unread inbox items whose email tracking pixel has been opened */
  @Post("inbox/confirm-pixel-read")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:notification:ConfirmPixelOpenedInboxRead",
      resourceKind: "collection",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  @Middlewares(replayProtectionMiddleware)
  public async confirmPixelOpenedRead(@Request() request: TypedRequest): Promise<{ success: boolean; count: number }> {
    return this.service.confirmPixelOpenedRead(request.user!.userId, request);
  }

  /** Get the list of subscribable event types */
  @Get("events")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:notification:ListEvents",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  public async getEventList(@Request() request: TypedRequest): Promise<NotificationEventInfoDto[]> {
    return this.service.getAuthorizedEventList(request.user!.userId, request);
  }
}
