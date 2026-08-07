import type { NotificationEvent } from "@/constant/notification-event";
import type { NotificationDocument } from "./notification-template";

export interface WebhookPayload {
  event: string;
  title: string;
  content: string;
  timestamp: string;
  data?: Record<string, unknown>;
  document?: NotificationDocument;
}

/**
 * Formats a notification payload for different webhook target formats.
 */
export class WebhookFormatter {
  static format(webhookFormat: string, event: NotificationEvent, payload: WebhookPayload): Record<string, unknown> {
    switch (webhookFormat) {
      case "discord":
        return WebhookFormatter.formatDiscord(payload);
      case "slack":
        return WebhookFormatter.formatSlack(payload);
      case "feishu":
        return WebhookFormatter.formatFeishu(payload);
      case "wechat_work":
        return WebhookFormatter.formatWechatWork(payload);
      default:
        return WebhookFormatter.formatGeneric(event, payload);
    }
  }

  private static formatGeneric(event: NotificationEvent, payload: WebhookPayload): Record<string, unknown> {
    return {
      event,
      title: payload.title,
      content: payload.content,
      timestamp: payload.timestamp,
      data: payload.data ?? {},
    };
  }

  private static formatDiscord(payload: WebhookPayload): Record<string, unknown> {
    const fields = payload.document ? this.documentFields(payload.document) : [];
    return {
      embeds: [
        {
          title: payload.title,
          description: payload.content,
          color: 0xff6b6b,
          timestamp: payload.timestamp,
          fields: fields.length
            ? fields
            : payload.data
              ? Object.entries(payload.data).map(([name, value]) => ({
                  name,
                  value: String(value),
                  inline: true,
                }))
              : [],
        },
      ],
    };
  }

  private static formatSlack(payload: WebhookPayload): Record<string, unknown> {
    const fields = payload.document ? this.documentFields(payload.document) : [];
    return {
      text: payload.title,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: payload.title },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: fields.length
              ? `${payload.content}\n${fields.map((field) => `*${field.name}*: ${field.value}`).join("\n")}`
              : payload.content,
          },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `_${payload.timestamp}_` }],
        },
      ],
    };
  }

  private static formatFeishu(payload: WebhookPayload): Record<string, unknown> {
    const documentFields = payload.document ? this.documentFields(payload.document) : [];
    const fields = documentFields.length
      ? documentFields.map(({ name, value }) => ({
          is_short: true,
          text: { tag: "lark_md", content: `**${name}**: ${value}` },
        }))
      : payload.data
        ? Object.entries(payload.data).map(([key, value]) => ({
            is_short: true,
            text: { tag: "lark_md", content: `**${key}**: ${value}` },
          }))
        : [];

    return {
      msg_type: "interactive",
      card: {
        header: {
          title: { content: payload.title, tag: "plain_text" },
          template: "red",
        },
        elements: [
          {
            tag: "div",
            text: { content: payload.content, tag: "plain_text" },
          },
          ...(fields.length > 0 ? [{ tag: "div", fields }] : []),
          {
            tag: "note",
            elements: [{ tag: "plain_text", content: payload.timestamp }],
          },
        ],
      },
    };
  }

  private static formatWechatWork(payload: WebhookPayload): Record<string, unknown> {
    const documentFields = payload.document ? this.documentFields(payload.document) : [];
    const extraLines = documentFields.length
      ? documentFields.map(({ name, value }) => `> **${name}**: ${value}`).join("\n")
      : payload.data
        ? Object.entries(payload.data)
            .map(([k, v]) => `> **${k}**: ${v}`)
            .join("\n")
        : "";

    const content = extraLines
      ? `**${payload.title}**\n${payload.content}\n${extraLines}`
      : `**${payload.title}**\n${payload.content}`;

    return {
      msgtype: "markdown",
      markdown: { content },
    };
  }

  private static documentFields(document: NotificationDocument): Array<{ name: string; value: string }> {
    return document.blocks.flatMap((block) => {
      if (block.type === "status") return [{ name: block.label, value: block.value }];
      if (block.type === "fields") return block.items.map((item) => ({ name: item.label, value: item.value }));
      return [];
    });
  }
}
