import axios from "axios";
import crypto from "crypto";
import nodemailer from "nodemailer";
import type { NotificationWebhook } from "@prisma/client";
import { NotificationEvent } from "@/constant/notification-event";
import { NotificationPreferenceRepository } from "@/store/notification/notification-preference.repository";
import { ConfigService } from "@/services/system/config.service";
import { RedisService } from "@/services/infrastructure/redis.service";
import { NotificationPreferenceInitializerService } from "@/services/notification/notification-preference-initializer.service";
import { WebhookFormatter } from "./webhook-formatter";
import {
  NotificationTemplateRegistry,
  type NotificationDocument,
  type NotificationInputFor,
} from "./notification-template";
import { EmailTemplateRenderer } from "./email-template-renderer";
import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("NotificationService", LogCategory.BUSINESS);

const COOLDOWN_KEY_PREFIX = "notify:cooldown:";
const WEBHOOK_TIMEOUT_MS = 5000;

export type { NotificationDocument, NotificationInputFor, NotificationTemplateInput } from "./notification-template";

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
  async dispatch<E extends NotificationEvent>(userId: string, event: E, input: NotificationInputFor<E>): Promise<void> {
    try {
      await this._dispatch(userId, NotificationTemplateRegistry.build(event, input));
    } catch (err) {
      logger.error(
        `[NotificationService] Unhandled error dispatching ${event} for user ${userId}: ${(err as Error).message}`,
      );
    }
  }

  private async _dispatch(userId: string, document: NotificationDocument): Promise<void> {
    const preference = await this.preferenceInitializer.getOrInitialize(userId);

    const inboxItem = await this.repository.createInboxItem({
      userId,
      eventType: document.event,
      title: document.subject,
      content: document.summary,
      metadata: { ...(document.metadata ?? {}), document },
    });

    const subscribedEvents = preference.subscribedEvents as string[];
    if (!subscribedEvents.includes(document.event)) return;

    // Check cooldown
    const cooldownKey = `${COOLDOWN_KEY_PREFIX}${userId}:${document.event}`;
    const cooldownTtlSeconds = (preference.cooldownMinutes ?? 60) * 60;

    try {
      const acquired = await this.redis.setIfNotExists(cooldownKey, "1", cooldownTtlSeconds * 1000);
      if (!acquired) {
        logger.debug(`[NotificationService] Cooldown active for ${document.event} user=${userId}`);
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
      deliveries.push(this.deliverEmail(userId, preference.notificationEmail, document, inboxItem.id));

    // Webhook deliveries
    for (const webhook of enabledWebhooks) deliveries.push(this.deliverWebhook(userId, webhook, document));

    await Promise.allSettled(deliveries);
  }

  /**
   * Creates an inbox item and sends the email synchronously, rethrowing delivery errors.
   * Used by the "test email" flow so failures can be reported back to the caller,
   * unlike fire-and-forget `dispatch()`.
   */
  async dispatchAndAwaitEmail<E extends NotificationEvent>(
    userId: string,
    event: E,
    input: NotificationInputFor<E>,
  ): Promise<void> {
    const document = NotificationTemplateRegistry.build(event, input);
    const preference = await this.preferenceInitializer.getOrInitialize(userId);

    const inboxItem = await this.repository.createInboxItem({
      userId,
      eventType: document.event,
      title: document.subject,
      content: document.summary,
      metadata: { ...(document.metadata ?? {}), document },
    });

    if (!preference.notificationEmail) throw new Error("未配置通知邮箱");

    await this.sendEmail(preference.notificationEmail, document, inboxItem.id);
  }

  private async deliverEmail(
    userId: string,
    email: string,
    document: NotificationDocument,
    inboxItemId: string,
  ): Promise<void> {
    const logData = {
      userId,
      eventType: document.event,
      title: document.subject,
      content: document.summary,
      channel: "email",
      webhookId: null,
      deliveryStatus: "pending" as string,
      errorMessage: null as string | null,
      metadata: { ...(document.metadata ?? {}), document },
    };

    try {
      await this.sendEmail(email, document, inboxItemId);
      logData.deliveryStatus = "success";
    } catch (err) {
      logData.deliveryStatus = "failed";
      logData.errorMessage = (err as Error).message?.slice(0, 500) ?? "Unknown error";
      logger.warn(
        `[NotificationService] Email delivery failed for ${document.event} user=${userId}: ${logData.errorMessage}`,
      );
    } finally {
      await this.repository.createLog(logData).catch(() => {});
    }
  }

  private async deliverWebhook(
    userId: string,
    webhook: NotificationWebhook,
    document: NotificationDocument,
  ): Promise<void> {
    const logData = {
      userId,
      eventType: document.event,
      title: document.subject,
      content: document.summary,
      channel: "webhook",
      webhookId: webhook.id,
      deliveryStatus: "pending" as string,
      errorMessage: null as string | null,
      metadata: { ...(document.metadata ?? {}), document },
    };

    try {
      await this.sendWebhook(webhook, document);
      logData.deliveryStatus = "success";
    } catch (err) {
      logData.deliveryStatus = "failed";
      logData.errorMessage = (err as Error).message?.slice(0, 500) ?? "Unknown error";
      logger.warn(
        `[NotificationService] Webhook delivery failed for ${document.event} webhook=${webhook.id}: ${logData.errorMessage}`,
      );
    } finally {
      await this.repository.createLog(logData).catch(() => {});
    }
  }

  private async sendEmail(email: string, document: NotificationDocument, inboxItemId: string): Promise<void> {
    const smtpConfig = await this.configService.getSmtpConfig();
    if (!smtpConfig.host) throw new Error("SMTP 未配置");

    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: { user: smtpConfig.user, pass: smtpConfig.password },
    });

    const siteConfig = await this.configService.getSiteConfig();
    const trackingPixelUrl = siteConfig.backendPublicUrl
      ? `${siteConfig.backendPublicUrl}/v1/notification/pixel/${inboxItemId}`
      : undefined;
    const rendered = EmailTemplateRenderer.render(document, { trackingPixelUrl });

    await transporter.sendMail({
      from: `"${smtpConfig.senderName}" <${smtpConfig.senderEmail}>`,
      to: email,
      subject: document.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  private async sendWebhook(webhook: NotificationWebhook, document: NotificationDocument): Promise<void> {
    const body = WebhookFormatter.format(webhook.format, document.event, {
      event: document.event,
      title: document.subject,
      content: document.summary,
      timestamp: document.timestamp,
      data: document.metadata,
      document,
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
