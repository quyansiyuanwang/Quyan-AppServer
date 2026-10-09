import type { Request } from "express";
import { extractClientIp } from "@/util/ip-extractor";
import {
  NotificationPreferenceRepository,
  type NotificationWebhookCreateInput,
  type NotificationWebhookUpdateInput,
} from "@/store/notification/notification-preference.repository";
import {
  NotificationPreferenceDto,
  NotificationWebhookDto,
  NotificationLogListDto,
  NotificationEventInfoDto,
  NotificationInboxListDto,
  NotificationInboxItemDto,
} from "@/api/dto/notification/notification.dto";
import type {
  UpdateNotificationPreferenceDto,
  CreateNotificationWebhookDto,
  UpdateNotificationWebhookDto,
  MarkNotificationInboxReadDto,
} from "@/api/dto/notification/notification.dto";
import { NotificationService } from "@/services/notification/notification.service";
import { NotificationTemplateRegistry } from "@/services/notification/notification-template";
import { NotificationPreferenceInitializerService } from "@/services/notification/notification-preference-initializer.service";
import {
  NotificationEvent,
  NOTIFICATION_EVENT_I18N_KEYS,
  NOTIFICATION_EVENT_THRESHOLD_UNIT_I18N_KEYS,
  THRESHOLD_EVENTS,
  ALL_NOTIFICATION_EVENTS,
} from "@/constant/notification-event";
import { PermissionService } from "@/services/users/permission.service";
import { Permission } from "@quyan/shared";
import { getLogger, LogCategory } from "@/util/logger";
import { NotificationHistoryIamService } from "./notification-history-iam.service";
import { ForbiddenError, NotFoundError } from "@/util/errors";
import { env } from "@/config/env";
import type { TypedRequest } from "@/types/express";
import { normalizeNotificationPreferenceUpdate } from "./notification-preference-validation";
import { NotificationInboxIamService } from "./notification-inbox-iam.service";
import { NotificationPreferenceIamService } from "./notification-preference-iam.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import type { NotificationPreference, NotificationWebhook } from "@prisma/client";

export class NotificationManagementService {
  private static instance: NotificationManagementService;
  private readonly thresholdEventSet = new Set<NotificationEvent>(THRESHOLD_EVENTS);

  private constructor(
    private readonly repository = NotificationPreferenceRepository.getInstance(),
    private readonly notificationService = NotificationService.getInstance(),
    private readonly preferenceInitializer = NotificationPreferenceInitializerService.getInstance(),
    private readonly businessLogService = BusinessLogService.getInstance(),
  ) {}

  static getInstance(): NotificationManagementService {
    if (!NotificationManagementService.instance)
      NotificationManagementService.instance = new NotificationManagementService();

    return NotificationManagementService.instance;
  }

  // ─── Preference ────────────────────────────────────────────────────────────

  async getPreference(userId: string, request?: Request): Promise<NotificationPreferenceDto> {
    const pref =
      env.security.iamAuthorizationMode === "enforce"
        ? await NotificationPreferenceIamService.getInstance().get(userId, request as TypedRequest | undefined)
        : await this.preferenceInitializer.getOrInitialize(userId);

    return this.toPreferenceDto(pref);
  }

  async updatePreference(
    userId: string,
    dto: UpdateNotificationPreferenceDto,
    request: Request,
  ): Promise<NotificationPreferenceDto> {
    const updateData = normalizeNotificationPreferenceUpdate(dto);

    const updated =
      env.security.iamAuthorizationMode === "enforce"
        ? await NotificationPreferenceIamService.getInstance().update(userId, updateData, request as TypedRequest)
        : await this.repository.upsertPreference(userId, updateData);

    await this.businessLogService.logOperation({
      operationType: OperationType.NOTIFICATION_PREFERENCE_UPDATE,
      operationCategory: OperationCategory.NOTIFICATION,
      actorUserId: userId,
      targetResourceId: updated.id,
      targetResourceType: "NotificationPreference",
      description: "Updated notification preferences",
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: this.getClientIP(request),
      userAgent: request.headers["user-agent"],
    });

    return this.toPreferenceDto(updated);
  }

  // ─── Webhooks ──────────────────────────────────────────────────────────────

  async listWebhooks(userId: string): Promise<NotificationWebhookDto[]> {
    const webhooks = await this.repository.findWebhooksByUserId(userId);
    return webhooks.map(this.toWebhookDto);
  }

  async createWebhook(
    userId: string,
    dto: CreateNotificationWebhookDto,
    request: Request,
  ): Promise<NotificationWebhookDto> {
    const preference = await this.preferenceInitializer.getOrInitialize(userId);

    const webhook = await this.repository.createWebhook(userId, preference.id, {
      name: dto.name,
      url: dto.url,
      format: dto.format,
      secret: dto.secret ?? null,
      enabled: dto.enabled ?? true,
    } satisfies NotificationWebhookCreateInput);

    await this.businessLogService.logOperation({
      operationType: OperationType.NOTIFICATION_WEBHOOK_CREATE,
      operationCategory: OperationCategory.NOTIFICATION,
      actorUserId: userId,
      targetResourceId: webhook.id,
      targetResourceType: "NotificationWebhook",
      description: `Created webhook: ${webhook.name}`,
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: this.getClientIP(request),
      userAgent: request.headers["user-agent"],
    });

    return this.toWebhookDto(webhook);
  }

  async updateWebhook(
    id: string,
    userId: string,
    dto: UpdateNotificationWebhookDto,
    request: Request,
  ): Promise<NotificationWebhookDto> {
    const existing = await this.repository.findWebhookById(id, userId);
    if (!existing)
      throw new NotFoundError("Webhook not found", undefined, { messageKey: "notification.webhookNotFound" });

    const updateData: NotificationWebhookUpdateInput = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.url !== undefined) updateData.url = dto.url;
    if (dto.format !== undefined) updateData.format = dto.format;
    if (dto.secret !== undefined) updateData.secret = dto.secret;
    if (dto.enabled !== undefined) updateData.enabled = dto.enabled;

    const updated = await this.repository.updateWebhook(id, userId, updateData);

    await this.businessLogService.logOperation({
      operationType: OperationType.NOTIFICATION_WEBHOOK_UPDATE,
      operationCategory: OperationCategory.NOTIFICATION,
      actorUserId: userId,
      targetResourceId: id,
      targetResourceType: "NotificationWebhook",
      description: `Updated webhook: ${updated.name}`,
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: this.getClientIP(request),
      userAgent: request.headers["user-agent"],
    });

    return this.toWebhookDto(updated);
  }

  async deleteWebhook(id: string, userId: string, request: Request): Promise<void> {
    const existing = await this.repository.findWebhookById(id, userId);
    if (!existing)
      throw new NotFoundError("Webhook not found", undefined, { messageKey: "notification.webhookNotFound" });

    await this.repository.deleteWebhook(id, userId);

    await this.businessLogService.logOperation({
      operationType: OperationType.NOTIFICATION_WEBHOOK_DELETE,
      operationCategory: OperationCategory.NOTIFICATION,
      actorUserId: userId,
      targetResourceId: id,
      targetResourceType: "NotificationWebhook",
      description: `Deleted webhook: ${existing.name}`,
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: this.getClientIP(request),
      userAgent: request.headers["user-agent"],
    });
  }

  async testEmail(userId: string): Promise<{ success: boolean; error?: string }> {
    const pref = await this.preferenceInitializer.getOrInitialize(userId);
    const email = pref?.notificationEmail;
    if (!email) return { success: false, error: "未配置通知邮箱" };

    try {
      await this.notificationService.dispatchAndAwaitEmail(userId, NotificationEvent.BALANCE_LOW, {
        currentBalance: "100.0000",
        threshold: "10.0000",
        source: "test",
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async testWebhook(id: string, userId: string): Promise<{ success: boolean; error?: string }> {
    const webhook = await this.repository.findWebhookById(id, userId);
    if (!webhook)
      throw new NotFoundError("Webhook not found", undefined, { messageKey: "notification.webhookNotFound" });

    try {
      await this.notificationService["sendWebhook"](
        webhook,
        NotificationTemplateRegistry.build(NotificationEvent.BALANCE_LOW, {
          currentBalance: "100.0000",
          threshold: "10.0000",
          source: "test",
        }),
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  // ─── Logs ──────────────────────────────────────────────────────────────────

  async getLogs(
    userId: string,
    page: number,
    pageSize: number,
    request?: TypedRequest,
  ): Promise<NotificationLogListDto> {
    let result: Pick<Awaited<ReturnType<NotificationHistoryIamService["list"]>>, "logs" | "total">;
    if (env.security.iamAuthorizationMode === "enforce") {
      const authorized = await NotificationHistoryIamService.getInstance().list(userId, page, pageSize, request);
      result = authorized;
      ({ page, pageSize } = authorized);
    } else {
      const permission = await PermissionService.getInstance().checkUserPermissions(
        userId,
        [Permission.NOTIFICATION_MANAGE],
        {
          assumedRoleSessionId: request?.user?.roleSessionId,
        },
      );
      if (!permission.hasPermission)
        throw new ForbiddenError("Legacy notification log listing denied", undefined, {
          messageKey: "permission.insufficientPermission",
        });
      result = await this.repository.findLogsByUserId(userId, page, pageSize);
      if (env.security.iamAuthorizationMode === "shadow" && request) {
        try {
          const evaluated = await NotificationHistoryIamService.getInstance().list(
            userId,
            page,
            pageSize,
            request,
            true,
          );
          if (
            evaluated.total !== result.total ||
            evaluated.logs.length !== result.logs.length ||
            evaluated.logs.some((row, index) => row.id !== result.logs[index]?.id)
          )
            getLogger("NotificationHistoryAuthorization", LogCategory.SECURITY).warn(
              "IAM delivery log listing differs from legacy",
              { action: "quyan:notification:ListDeliveryLogs", legacyCount: result.total, iamCount: evaluated.total },
            );
        } catch {
          getLogger("NotificationHistoryAuthorization", LogCategory.SECURITY).warn(
            "IAM delivery log shadow evaluation unavailable",
            { action: "quyan:notification:ListDeliveryLogs", reason: "iam-list-unavailable" },
          );
        }
      }
    }
    const { logs, total } = result;
    return {
      logs: logs.map((log) => ({
        id: log.id,
        eventType: log.eventType,
        title: log.title,
        content: log.content,
        channel: log.channel,
        webhookId: log.webhookId ?? null,
        deliveryStatus: log.deliveryStatus,
        errorMessage: log.errorMessage ?? null,
        createTime: log.createTime.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async getInbox(
    userId: string,
    page: number,
    pageSize: number,
    unreadOnly: boolean,
    request?: TypedRequest,
  ): Promise<NotificationInboxListDto> {
    const { items, total, unreadCount, pixelOpenedUnreadCount } =
      env.security.iamAuthorizationMode === "enforce"
        ? await NotificationInboxIamService.getInstance().list(userId, page, pageSize, unreadOnly, request)
        : await this.repository.findInboxByUserId(userId, page, pageSize, unreadOnly);
    return {
      items: items.map((item) => this.toInboxItemDto(item)),
      total,
      unreadCount,
      pixelOpenedUnreadCount,
      page,
      pageSize,
    };
  }

  async markInboxRead(
    userId: string,
    dto: MarkNotificationInboxReadDto,
    request?: TypedRequest,
  ): Promise<{ success: boolean; count: number }> {
    const count =
      env.security.iamAuthorizationMode === "enforce"
        ? await NotificationInboxIamService.getInstance().markRead(userId, dto, request)
        : dto.markAll
          ? await this.repository.markAllInboxItemsRead(userId)
          : await this.repository.markInboxItemsRead(userId, dto.ids ?? []);

    return { success: true, count };
  }

  /** Promote unread items whose email tracking pixel has been opened to isRead, marking their source as "pixel" */
  async confirmPixelOpenedRead(userId: string, request?: TypedRequest): Promise<{ success: boolean; count: number }> {
    const count =
      env.security.iamAuthorizationMode === "enforce"
        ? await NotificationInboxIamService.getInstance().confirmPixelOpened(userId, request)
        : await this.repository.confirmPixelOpenedInboxItemsRead(userId);
    return { success: true, count };
  }

  // ─── Event List ────────────────────────────────────────────────────────────

  async getAuthorizedEventList(userId: string, request?: TypedRequest): Promise<NotificationEventInfoDto[]> {
    if (env.security.iamAuthorizationMode === "enforce")
      await NotificationHistoryIamService.getInstance().authorizeEvents(userId, request);
    return this.getEventList();
  }

  /** Internal metadata provider; HTTP callers use the authorized workflow. */
  getEventList(): NotificationEventInfoDto[] {
    return ALL_NOTIFICATION_EVENTS.map((event) => ({
      value: event,
      labelI18nKey: NOTIFICATION_EVENT_I18N_KEYS[event] ?? event,
      hasThreshold: this.isThresholdNotificationEvent(event),
      thresholdUnitI18nKey: this.isThresholdNotificationEvent(event)
        ? NOTIFICATION_EVENT_THRESHOLD_UNIT_I18N_KEYS[event]
        : undefined,
    }));
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private isThresholdNotificationEvent(event: NotificationEvent): event is (typeof THRESHOLD_EVENTS)[number] {
    return this.thresholdEventSet.has(event);
  }

  private toPreferenceDto(pref: NotificationPreference): NotificationPreferenceDto {
    return {
      id: pref.id,
      notificationEmail: pref.notificationEmail ?? null,
      subscribedEvents: (pref.subscribedEvents as string[]) ?? [],
      thresholds: (pref.thresholds as Record<string, number>) ?? {},
      cooldownMinutes: pref.cooldownMinutes,
      createTime: pref.createTime.toISOString(),
      updateTime: pref.updateTime.toISOString(),
    };
  }

  private toWebhookDto(webhook: NotificationWebhook): NotificationWebhookDto {
    return {
      id: webhook.id,
      name: webhook.name,
      url: webhook.url,
      format: webhook.format,
      hasSecret: !!webhook.secret,
      enabled: webhook.enabled,
      createTime: webhook.createTime.toISOString(),
      updateTime: webhook.updateTime.toISOString(),
    };
  }

  private toInboxItemDto(item: {
    id: string;
    eventType: string;
    title: string;
    content: string;
    isRead: boolean;
    readTime: Date | null;
    readSource: string | null;
    pixelOpened: boolean;
    pixelOpenedTime: Date | null;
    metadata: unknown;
    createTime: Date;
    updateTime: Date;
  }): NotificationInboxItemDto {
    return {
      id: item.id,
      eventType: item.eventType,
      title: item.title,
      content: item.content,
      isRead: item.isRead,
      readTime: item.readTime?.toISOString() ?? null,
      readSource: item.readSource ?? null,
      pixelOpened: item.pixelOpened,
      pixelOpenedTime: item.pixelOpenedTime?.toISOString() ?? null,
      metadata:
        item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
          ? (item.metadata as Record<string, unknown>)
          : null,
      createTime: item.createTime.toISOString(),
      updateTime: item.updateTime.toISOString(),
    };
  }

  private getClientIP(req: Request): string {
    return extractClientIp(req);
  }
}
