import { describe, expect, it } from "vitest";
import { NotificationEvent } from "../../../src/constant/notification-event";
import { NotificationTemplateRegistry } from "../../../src/services/notification/notification-template";
import { WebhookFormatter, type WebhookPayload } from "../../../src/services/notification/webhook-formatter";

const basePayload: WebhookPayload = {
  event: NotificationEvent.BALANCE_LOW,
  title: "余额不足",
  content: "您的账户余额已低于阈值",
  timestamp: "2026-05-22T10:00:00.000Z",
  data: { balance: "9.50", threshold: "10.00" },
};

const payloadNoData: WebhookPayload = {
  event: NotificationEvent.ABNORMAL_LOGIN,
  title: "异常登录",
  content: "检测到异常登录行为",
  timestamp: "2026-05-22T10:00:00.000Z",
};

describe("WebhookFormatter", () => {
  describe("generic 格式", () => {
    it("应包含 event、title、content、timestamp、data 字段", () => {
      const result = WebhookFormatter.format("generic", NotificationEvent.BALANCE_LOW, basePayload);
      expect(result).toMatchObject({
        event: NotificationEvent.BALANCE_LOW,
        title: "余额不足",
        content: "您的账户余额已低于阈值",
        timestamp: "2026-05-22T10:00:00.000Z",
        data: { balance: "9.50", threshold: "10.00" },
      });
    });

    it("无 data 时 data 字段应为空对象", () => {
      expect(WebhookFormatter.format("generic", NotificationEvent.ABNORMAL_LOGIN, payloadNoData).data).toEqual({});
    });

    it("未知格式应回退到 generic", () => {
      const result = WebhookFormatter.format("unknown_format", NotificationEvent.BALANCE_LOW, basePayload);
      expect(result).toHaveProperty("event");
      expect(result).toHaveProperty("title");
    });
  });

  describe("discord 格式", () => {
    it("应返回包含 embeds 和 data fields 的结构", () => {
      const result = WebhookFormatter.format("discord", NotificationEvent.BALANCE_LOW, basePayload) as {
        embeds: Array<{
          title: string;
          description: string;
          timestamp: string;
          fields: Array<{ name: string; inline: boolean }>;
        }>;
      };
      expect(result.embeds).toHaveLength(1);
      expect(result.embeds[0]).toMatchObject({
        title: "余额不足",
        description: "您的账户余额已低于阈值",
        timestamp: basePayload.timestamp,
      });
      expect(result.embeds[0].fields).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "balance", inline: true })]),
      );
      expect(result.embeds[0].fields).toHaveLength(2);
      expect(result.embeds[0].fields.find((field) => field.name === "threshold")).toBeTruthy();
      expect(result.embeds[0].fields.every((field) => field.inline)).toBe(true);
    });

    it("无 data 时 fields 应为空数组", () => {
      const result = WebhookFormatter.format("discord", NotificationEvent.ABNORMAL_LOGIN, payloadNoData) as {
        embeds: Array<{ fields: unknown[] }>;
      };
      expect(result.embeds[0].fields).toEqual([]);
    });

    it("color 字段应为数字", () => {
      const result = WebhookFormatter.format("discord", NotificationEvent.BALANCE_LOW, basePayload) as {
        embeds: Array<{ color: unknown }>;
      };
      expect(typeof result.embeds[0].color).toBe("number");
    });
  });

  describe("slack、飞书与企业微信格式", () => {
    it("slack 保留 header、section、context 块", () => {
      const result = WebhookFormatter.format("slack", NotificationEvent.BALANCE_LOW, basePayload) as {
        text: string;
        blocks: Array<{ type: string; text?: { text: string }; elements?: Array<{ text: string }> }>;
      };
      expect(result.text).toBe("余额不足");
      expect(result.blocks.map((block) => block.type)).toEqual(["header", "section", "context"]);
      expect(result.blocks[0].text?.text).toBe("余额不足");
      expect(result.blocks[1].text?.text).toBe("您的账户余额已低于阈值");
      expect(result.blocks[2].elements?.[0].text).toContain(basePayload.timestamp);
    });

    it("飞书保留标题、字段和时间", () => {
      const result = WebhookFormatter.format("feishu", NotificationEvent.BALANCE_LOW, basePayload) as {
        msg_type: string;
        card: {
          header: { title: { content: string } };
          elements: Array<{ tag: string; fields?: unknown[]; elements?: Array<{ content: string }> }>;
        };
      };
      expect(result.msg_type).toBe("interactive");
      expect(result.card.header.title.content).toBe("余额不足");
      expect(result.card.elements.find((element) => element.fields)?.fields).toHaveLength(2);
      expect(result.card.elements.at(-1)?.elements?.[0].content).toBe(basePayload.timestamp);
    });

    it("飞书无 data 时不应包含 fields div", () => {
      const result = WebhookFormatter.format("feishu", NotificationEvent.ABNORMAL_LOGIN, payloadNoData) as {
        card: { elements: Array<{ tag: string; fields?: unknown[] }> };
      };
      expect(result.card.elements.find((element) => element.tag === "div" && element.fields)).toBeUndefined();
    });

    it("企业微信保留标题、内容和字段", () => {
      const result = WebhookFormatter.format("wechat_work", NotificationEvent.BALANCE_LOW, basePayload) as {
        msgtype: string;
        markdown: { content: string };
      };
      expect(result.msgtype).toBe("markdown");
      expect(result.markdown.content).toContain("余额不足");
      expect(result.markdown.content).toContain("您的账户余额已低于阈值");
      expect(result.markdown.content).toContain("balance");
    });

    it("无 data 时企业微信不应包含多余字段", () => {
      const result = WebhookFormatter.format("wechat_work", NotificationEvent.ABNORMAL_LOGIN, payloadNoData) as {
        markdown: { content: string };
      };
      expect(result.markdown.content).toBe("**异常登录**\n检测到异常登录行为");
    });
  });

  describe("边缘情况", () => {
    it("data 值为数字时应正确序列化", () => {
      const payload: WebhookPayload = { ...basePayload, data: { count: 42, ratio: 0.95 } };
      const discord = WebhookFormatter.format("discord", NotificationEvent.BALANCE_LOW, payload) as {
        embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
      };
      expect(discord.embeds[0].fields.find((field) => field.name === "count")?.value).toBe("42");
    });

    it("title 含特殊字符时不应抛出", () => {
      const payload: WebhookPayload = { ...basePayload, title: '<script>alert("xss")</script>' };
      expect(() => WebhookFormatter.format("generic", NotificationEvent.BALANCE_LOW, payload)).not.toThrow();
    });
  });

  it("使用结构化文档时应将其字段映射到渠道格式，同时保留 generic 外壳", () => {
    const document = NotificationTemplateRegistry.build(NotificationEvent.BALANCE_LOW, {
      currentBalance: "5.00",
      threshold: "10.00",
    });
    const payload: WebhookPayload = {
      event: document.event,
      title: document.subject,
      content: document.summary,
      timestamp: document.timestamp,
      data: document.metadata,
      document,
    };
    const generic = WebhookFormatter.format("generic", document.event, payload);
    const discord = WebhookFormatter.format("discord", document.event, payload) as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };

    expect(generic).toMatchObject({
      event: NotificationEvent.BALANCE_LOW,
      title: "余额不足提醒",
      content: "当前余额已低于设定阈值，请及时充值。",
    });
    expect(discord.embeds[0].fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "当前余额", value: "5.00" })]),
    );
  });
});
