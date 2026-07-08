import type {
  NotificationPreference,
  NotificationWebhook,
  NotificationLog,
  NotificationInboxItem,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";

export interface NotificationPreferenceUpdateInput {
  notificationEmail?: string | null;
  subscribedEvents?: string[];
  thresholds?: Record<string, number>;
  cooldownMinutes?: number;
}

export interface NotificationWebhookCreateInput {
  name: string;
  url: string;
  format: string;
  secret?: string | null;
  enabled?: boolean;
}

export interface NotificationWebhookUpdateInput {
  name?: string;
  url?: string;
  format?: string;
  secret?: string | null;
  enabled?: boolean;
}

export interface NotificationLogCreateInput {
  userId: string;
  eventType: string;
  title: string;
  content: string;
  channel: string;
  webhookId?: string | null;
  deliveryStatus: string;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | undefined;
}

export interface NotificationInboxCreateInput {
  userId: string;
  eventType: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown> | undefined;
}

export class NotificationPreferenceRepository {
  private static instance: NotificationPreferenceRepository;

  static getInstance(): NotificationPreferenceRepository {
    if (!NotificationPreferenceRepository.instance)
      NotificationPreferenceRepository.instance = new NotificationPreferenceRepository();

    return NotificationPreferenceRepository.instance;
  }

  // ─── Preference ────────────────────────────────────────────────────────────

  async findByUserId(userId: string): Promise<NotificationPreference | null> {
    return prisma.notificationPreference.findUnique({ where: { userId } });
  }

  async ensurePreferenceExists(userId: string): Promise<NotificationPreference> {
    const existing = await prisma.notificationPreference.findUnique({ where: { userId } });
    if (existing) return existing;
    return prisma.notificationPreference.create({
      data: {
        userId,
        subscribedEvents: [],
        thresholds: {},
      },
    });
  }

  async upsertPreference(userId: string, data: NotificationPreferenceUpdateInput): Promise<NotificationPreference> {
    return prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        notificationEmail: data.notificationEmail ?? null,
        subscribedEvents: data.subscribedEvents ?? [],
        thresholds: data.thresholds ?? {},
        cooldownMinutes: data.cooldownMinutes ?? 60,
      },
      update: {
        ...(data.notificationEmail !== undefined && { notificationEmail: data.notificationEmail }),
        ...(data.subscribedEvents !== undefined && { subscribedEvents: data.subscribedEvents }),
        ...(data.thresholds !== undefined && { thresholds: data.thresholds }),
        ...(data.cooldownMinutes !== undefined && { cooldownMinutes: data.cooldownMinutes }),
      },
    });
  }

  // ─── Webhooks ──────────────────────────────────────────────────────────────

  async findWebhooksByUserId(userId: string): Promise<NotificationWebhook[]> {
    return prisma.notificationWebhook.findMany({
      where: { userId, status: 1 },
      orderBy: { createTime: "asc" },
    });
  }

  async findWebhookById(id: string, userId: string): Promise<NotificationWebhook | null> {
    return prisma.notificationWebhook.findFirst({ where: { id, userId, status: 1 } });
  }

  async createWebhook(
    userId: string,
    preferenceId: string,
    data: NotificationWebhookCreateInput,
  ): Promise<NotificationWebhook> {
    return prisma.notificationWebhook.create({
      data: {
        userId,
        preferenceId,
        name: data.name,
        url: data.url,
        format: data.format,
        secret: data.secret ?? null,
        enabled: data.enabled ?? true,
      },
    });
  }

  async updateWebhook(id: string, userId: string, data: NotificationWebhookUpdateInput): Promise<NotificationWebhook> {
    return prisma.notificationWebhook.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.url !== undefined && { url: data.url }),
        ...(data.format !== undefined && { format: data.format }),
        ...(data.secret !== undefined && { secret: data.secret }),
        ...(data.enabled !== undefined && { enabled: data.enabled }),
      },
    });
  }

  async deleteWebhook(id: string, _userId: string): Promise<void> {
    // Soft-delete
    await prisma.notificationWebhook.update({
      where: { id },
      data: { status: 0 },
    });
  }

  // ─── Logs ──────────────────────────────────────────────────────────────────

  async createLog(data: NotificationLogCreateInput): Promise<NotificationLog> {
    return prisma.notificationLog.create({
      data: {
        userId: data.userId,
        eventType: data.eventType,
        title: data.title,
        content: data.content,
        channel: data.channel,
        webhookId: data.webhookId ?? null,
        deliveryStatus: data.deliveryStatus,
        errorMessage: data.errorMessage ?? null,
        metadata: data.metadata ? (data.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  }

  async findLogsByUserId(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ logs: NotificationLog[]; total: number }> {
    const skip = (page - 1) * pageSize;
    const [logs, total] = await Promise.all([
      prisma.notificationLog.findMany({
        where: { userId },
        orderBy: { createTime: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.notificationLog.count({ where: { userId } }),
    ]);
    return { logs, total };
  }

  async createInboxItem(data: NotificationInboxCreateInput): Promise<NotificationInboxItem> {
    return prisma.notificationInboxItem.create({
      data: {
        userId: data.userId,
        eventType: data.eventType,
        title: data.title,
        content: data.content,
        metadata: data.metadata ? (data.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  }

  async findInboxByUserId(
    userId: string,
    page: number,
    pageSize: number,
    unreadOnly: boolean,
  ): Promise<{ items: NotificationInboxItem[]; total: number; unreadCount: number; pixelOpenedUnreadCount: number }> {
    const skip = (page - 1) * pageSize;
    const where = { userId, status: 1, ...(unreadOnly ? { isRead: false } : {}) };

    const [items, total, unreadCount, pixelOpenedUnreadCount] = await Promise.all([
      prisma.notificationInboxItem.findMany({
        where,
        orderBy: [{ isRead: "asc" }, { createTime: "desc" }],
        skip,
        take: pageSize,
      }),
      prisma.notificationInboxItem.count({ where }),
      prisma.notificationInboxItem.count({ where: { userId, status: 1, isRead: false } }),
      prisma.notificationInboxItem.count({ where: { userId, status: 1, isRead: false, pixelOpened: true } }),
    ]);

    return { items, total, unreadCount, pixelOpenedUnreadCount };
  }

  async markInboxItemPixelOpenedById(id: string): Promise<boolean> {
    const result = await prisma.notificationInboxItem.updateMany({
      where: { id, status: 1, pixelOpened: false },
      data: { pixelOpened: true, pixelOpenedTime: new Date() },
    });

    return result.count > 0;
  }

  async markInboxItemsRead(userId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const result = await prisma.notificationInboxItem.updateMany({
      where: { userId, id: { in: ids }, status: 1, isRead: false },
      data: { isRead: true, readTime: new Date(), readSource: "manual" },
    });

    return result.count;
  }

  async markAllInboxItemsRead(userId: string): Promise<number> {
    const result = await prisma.notificationInboxItem.updateMany({
      where: { userId, status: 1, isRead: false },
      data: { isRead: true, readTime: new Date(), readSource: "manual" },
    });

    return result.count;
  }

  async confirmPixelOpenedInboxItemsRead(userId: string): Promise<number> {
    const result = await prisma.notificationInboxItem.updateMany({
      where: { userId, status: 1, isRead: false, pixelOpened: true },
      data: { isRead: true, readTime: new Date(), readSource: "pixel" },
    });

    return result.count;
  }
}
