import type { Request } from "express";
import {
  NotificationPreferenceRepository,
  type NotificationPreferenceUpdateInput,
  type NotificationWebhookCreateInput,
  type NotificationWebhookUpdateInput,
} from "@/store/notification/notification-preference.repository";
import {
  NotificationPreferenceDto,
  NotificationWebhookDto,
  NotificationLogListDto,
  NotificationEventInfoDto,
} from "@/api/dto/notification/notification.dto";
import type {
  UpdateNotificationPreferenceDto,
  CreateNotificationWebhookDto,
  UpdateNotificationWebhookDto,
} from "@/api/dto/notification/notification.dto";
import { NotificationService } from "@/services/notification/notification.service";
import { NotificationPreferenceInitializerService } from "@/services/notification/notification-preference-initializer.service";
import {
  NotificationEvent,
  NOTIFICATION_EVENT_LABELS,
  THRESHOLD_EVENTS,
  ALL_NOTIFICATION_EVENTS,
} from "@/constant/notification-event";
import { NotFoundError, BadRequestError as _BadRequestError } from "@/util/errors";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import type { NotificationPreference, NotificationWebhook } from "@prisma/client";

export class NotificationManagementService {
  private static instance: NotificationManagementService;

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

  async getPreference(userId: string): Promise<NotificationPreferenceDto> {
    const pref = await this.preferenceInitializer.getOrInitialize(userId);

    return this.toPreferenceDto(pref);
  }

  async updatePreference(
    userId: string,
    dto: UpdateNotificationPreferenceDto,
    request: Request,
  ): Promise<NotificationPreferenceDto> {
    const updateData: NotificationPreferenceUpdateInput = {};

    if (dto.notificationEmail !== undefined) updateData.notificationEmail = dto.notificationEmail;
    if (dto.subscribedEvents !== undefined) updateData.subscribedEvents = dto.subscribedEvents;
    if (dto.thresholds !== undefined) updateData.thresholds = dto.thresholds;
    if (dto.cooldownMinutes !== undefined) updateData.cooldownMinutes = dto.cooldownMinutes;

    const updated = await this.repository.upsertPreference(userId, updateData);

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
    if (!existing) throw new NotFoundError("Webhook not found");

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
    if (!existing) throw new NotFoundError("Webhook not found");

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
      await this.notificationService["sendEmail"](email, NotificationEvent.BALANCE_LOW, {
        title: "邮件测试通知",
        content: "这是一条测试通知，用于验证邮件配置是否正确。",
        data: { source: "test", timestamp: new Date().toISOString() },
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async testWebhook(id: string, userId: string): Promise<{ success: boolean; error?: string }> {
    const webhook = await this.repository.findWebhookById(id, userId);
    if (!webhook) throw new NotFoundError("Webhook not found");

    try {
      await this.notificationService["sendWebhook"](webhook, NotificationEvent.BALANCE_LOW, {
        title: "Webhook 测试通知",
        content: "这是一条测试通知，用于验证 Webhook 配置是否正确。",
        data: { source: "test", timestamp: new Date().toISOString() },
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  // ─── Logs ──────────────────────────────────────────────────────────────────

  async getLogs(userId: string, page: number, pageSize: number): Promise<NotificationLogListDto> {
    const { logs, total } = await this.repository.findLogsByUserId(userId, page, pageSize);
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

  // ─── Event List ────────────────────────────────────────────────────────────

  getEventList(): NotificationEventInfoDto[] {
    const thresholdUnits: Partial<Record<NotificationEvent, string>> = {
      [NotificationEvent.BALANCE_LOW]: "曲",
      [NotificationEvent.MONTHLY_PASS_QUOTA_LOW]: "%",
      [NotificationEvent.MONTHLY_PASS_DAILY_LIMIT]: "%",
      [NotificationEvent.RELAY_TOKEN_QUOTA_LOW]: "%",
    };

    return ALL_NOTIFICATION_EVENTS.map((event) => ({
      value: event,
      label: NOTIFICATION_EVENT_LABELS[event as NotificationEvent] ?? event,
      hasThreshold: (THRESHOLD_EVENTS as readonly string[]).includes(event),
      thresholdUnit: thresholdUnits[event as NotificationEvent],
    }));
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

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

  private getClientIP(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return typeof forwarded === "string" ? forwarded.split(",")[0].trim() : forwarded[0];
    return req.ip || req.socket.remoteAddress || "unknown";
  }
}
