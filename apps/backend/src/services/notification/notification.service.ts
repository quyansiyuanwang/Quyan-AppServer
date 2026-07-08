import axios from "axios";
import crypto from "crypto";
import nodemailer from "nodemailer";
import type { NotificationWebhook } from "@prisma/client";
import { NotificationEvent, NOTIFICATION_EVENT_LABELS } from "@/constant/notification-event";
import { NotificationPreferenceRepository } from "@/store/notification/notification-preference.repository";
import { ConfigService } from "@/services/system/config.service";
import { RedisService } from "@/services/infrastructure/redis.service";
import { NotificationPreferenceInitializerService } from "@/services/notification/notification-preference-initializer.service";
import { WebhookFormatter } from "./webhook-formatter";
import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("NotificationService", LogCategory.BUSINESS);

const COOLDOWN_KEY_PREFIX = "notify:cooldown:";
const WEBHOOK_TIMEOUT_MS = 5000;

export interface NotificationPayload {
  title: string;
  content: string;
  data?: Record<string, unknown>;
}

export class NotificationService {
  private static instance: NotificationService;

  private constructor(
    private readonly repository = NotificationPreferenceRepository.getInstance(),
    private readonly configService = ConfigService.getInstance(),
    private readonly redis = RedisService.getInstance(),
    private readonly preferenceInitializer = NotificationPreferenceInitializerService.getInstance(),
  ) {}

  static getInstance(): NotificationService {
    if (!NotificationService.instance) NotificationService.instance = new NotificationService();

    return NotificationService.instance;
  }

  /**
   * Fire-and-forget notification dispatch.
   * Never throws — all errors are caught and logged internally.
   */
  async dispatch(userId: string, event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    try {
      await this._dispatch(userId, event, payload);
    } catch (err) {
      logger.error(
        `[NotificationService] Unhandled error dispatching ${event} for user ${userId}: ${(err as Error).message}`,
      );
    }
  }

  private async _dispatch(userId: string, event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    const preference = await this.preferenceInitializer.getOrInitialize(userId);

    const inboxItem = await this.repository.createInboxItem({
      userId,
      eventType: event,
      title: payload.title,
      content: payload.content,
      metadata: payload.data,
    });

    const subscribedEvents = preference.subscribedEvents as string[];
    if (!subscribedEvents.includes(event)) return;

    // Check cooldown
    const cooldownKey = `${COOLDOWN_KEY_PREFIX}${userId}:${event}`;
    const cooldownTtlSeconds = (preference.cooldownMinutes ?? 60) * 60;

    try {
      const acquired = await this.redis.setIfNotExists(cooldownKey, "1", cooldownTtlSeconds * 1000);
      if (!acquired) {
        logger.debug(`[NotificationService] Cooldown active for ${event} user=${userId}`);
        return;
      }
    } catch {
      // Redis unavailable — proceed without cooldown enforcement
    }

    const webhooks = await this.repository.findWebhooksByUserId(userId);
    const enabledWebhooks = webhooks.filter((w) => w.enabled);

    const deliveries: Promise<void>[] = [];

    // Email delivery
    if (preference.notificationEmail)
      deliveries.push(this.deliverEmail(userId, preference.notificationEmail, event, payload, inboxItem.id));

    // Webhook deliveries
    for (const webhook of enabledWebhooks) deliveries.push(this.deliverWebhook(userId, webhook, event, payload));

    await Promise.allSettled(deliveries);
  }

  /**
   * Creates an inbox item and sends the email synchronously, rethrowing delivery errors.
   * Used by the "test email" flow so failures can be reported back to the caller,
   * unlike fire-and-forget `dispatch()`.
   */
  async dispatchAndAwaitEmail(userId: string, event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    const preference = await this.preferenceInitializer.getOrInitialize(userId);

    const inboxItem = await this.repository.createInboxItem({
      userId,
      eventType: event,
      title: payload.title,
      content: payload.content,
      metadata: payload.data,
    });

    if (!preference.notificationEmail) throw new Error("未配置通知邮箱");

    await this.sendEmail(preference.notificationEmail, event, payload, inboxItem.id);
  }

  private async deliverEmail(
    userId: string,
    email: string,
    event: NotificationEvent,
    payload: NotificationPayload,
    inboxItemId: string,
  ): Promise<void> {
    const logData = {
      userId,
      eventType: event,
      title: payload.title,
      content: payload.content,
      channel: "email",
      webhookId: null,
      deliveryStatus: "pending" as string,
      errorMessage: null as string | null,
      metadata: payload.data ?? undefined,
    };

    try {
      await this.sendEmail(email, event, payload, inboxItemId);
      logData.deliveryStatus = "success";
    } catch (err) {
      logData.deliveryStatus = "failed";
      logData.errorMessage = (err as Error).message?.slice(0, 500) ?? "Unknown error";
      logger.warn(`[NotificationService] Email delivery failed for ${event} user=${userId}: ${logData.errorMessage}`);
    } finally {
      await this.repository.createLog(logData).catch(() => {});
    }
  }

  private async deliverWebhook(
    userId: string,
    webhook: NotificationWebhook,
    event: NotificationEvent,
    payload: NotificationPayload,
  ): Promise<void> {
    const logData = {
      userId,
      eventType: event,
      title: payload.title,
      content: payload.content,
      channel: "webhook",
      webhookId: webhook.id,
      deliveryStatus: "pending" as string,
      errorMessage: null as string | null,
      metadata: payload.data ?? undefined,
    };

    try {
      await this.sendWebhook(webhook, event, payload);
      logData.deliveryStatus = "success";
    } catch (err) {
      logData.deliveryStatus = "failed";
      logData.errorMessage = (err as Error).message?.slice(0, 500) ?? "Unknown error";
      logger.warn(
        `[NotificationService] Webhook delivery failed for ${event} webhook=${webhook.id}: ${logData.errorMessage}`,
      );
    } finally {
      await this.repository.createLog(logData).catch(() => {});
    }
  }

  private async sendEmail(
    email: string,
    event: NotificationEvent,
    payload: NotificationPayload,
    inboxItemId: string,
  ): Promise<void> {
    const smtpConfig = await this.configService.getSmtpConfig();
    if (!smtpConfig.host) throw new Error("SMTP 未配置");

    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: { user: smtpConfig.user, pass: smtpConfig.password },
    });

    const eventLabel = NOTIFICATION_EVENT_LABELS[event] ?? event;
    const extraRows = payload.data
      ? Object.entries(payload.data)
          .map(
            ([k, v]) =>
              `<tr><td style="padding:4px 8px;color:#666;font-size:13px;">${k}</td><td style="padding:4px 8px;font-size:13px;">${v}</td></tr>`,
          )
          .join("")
      : "";

    const siteConfig = await this.configService.getSiteConfig();
    const pixelTag = siteConfig.backendPublicUrl
      ? `<img src="${siteConfig.backendPublicUrl}/v1/notification/pixel/${inboxItemId}" width="1" height="1" style="display:none;border:0;" alt="" />`
      : "";

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#e53e3e;margin-bottom:4px;">${payload.title}</h2>
        <p style="color:#555;font-size:14px;margin-top:0;">[${eventLabel}]</p>
        <p style="color:#333;font-size:15px;">${payload.content}</p>
        ${extraRows ? `<table style="border-collapse:collapse;margin-top:12px;width:100%;">${extraRows}</table>` : ""}
        <p style="color:#999;font-size:12px;margin-top:20px;">此邮件由系统自动发送，请勿回复。</p>
        ${pixelTag}
      </div>`;

    await transporter.sendMail({
      from: smtpConfig.user,
      to: email,
      subject: payload.title,
      html,
    });
  }

  private async sendWebhook(
    webhook: NotificationWebhook,
    event: NotificationEvent,
    payload: NotificationPayload,
  ): Promise<void> {
    const body = WebhookFormatter.format(webhook.format, event, {
      event,
      title: payload.title,
      content: payload.content,
      timestamp: new Date().toISOString(),
      data: payload.data,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (webhook.secret) {
      const bodyStr = JSON.stringify(body);
      const sig = crypto.createHmac("sha256", webhook.secret).update(bodyStr).digest("hex");
      headers["X-Webhook-Signature"] = `sha256=${sig}`;
    }

    await axios.post(webhook.url, body, {
      headers,
      timeout: WEBHOOK_TIMEOUT_MS,
    });
  }
}
