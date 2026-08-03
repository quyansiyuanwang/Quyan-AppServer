import { describe, it, expect } from "vitest";
import { WebhookFormatter } from "../../../src/services/notification/webhook-formatter";
import { NotificationEvent } from "../../../src/constant/notification-event";
import type { WebhookPayload } from "../../../src/services/notification/webhook-formatter";

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
      const result = WebhookFormatter.format("generic", NotificationEvent.ABNORMAL_LOGIN, payloadNoData);
      expect(result.data).toEqual({});
    });

    it("未知格式应回退到 generic", () => {
      const result = WebhookFormatter.format("unknown_format", NotificationEvent.BALANCE_LOW, basePayload);
      expect(result).toHaveProperty("event");
      expect(result).toHaveProperty("title");
    });
  });

  describe("discord 格式", () => {
    it("应返回包含 embeds 数组的结构", () => {
      const result = WebhookFormatter.format("discord", NotificationEvent.BALANCE_LOW, basePayload);
      expect(result).toHaveProperty("embeds");
      const embeds = result.embeds as any[];
      expect(embeds).toHaveLength(1);
      expect(embeds[0].title).toBe("余额不足");
      expect(embeds[0].description).toBe("您的账户余额已低于阈值");
      expect(embeds[0].timestamp).toBe("2026-05-22T10:00:00.000Z");
    });

    it("data 字段应映射为 fields 数组", () => {
      const result = WebhookFormatter.format("discord", NotificationEvent.BALANCE_LOW, basePayload);
      const embeds = result.embeds as any[];
      const fields = embeds[0].fields as any[];
      expect(fields.length).toBe(2);
      expect(fields.find((f: any) => f.name === "balance")).toBeTruthy();
      expect(fields.find((f: any) => f.name === "threshold")).toBeTruthy();
      fields.forEach((f: any) => expect(f.inline).toBe(true));
    });

    it("无 data 时 fields 应为空数组", () => {
      const result = WebhookFormatter.format("discord", NotificationEvent.ABNORMAL_LOGIN, payloadNoData);
      const embeds = result.embeds as any[];
      expect(embeds[0].fields).toEqual([]);
    });

    it("color 字段应为数字", () => {
      const result = WebhookFormatter.format("discord", NotificationEvent.BALANCE_LOW, basePayload);
      const embeds = result.embeds as any[];
      expect(typeof embeds[0].color).toBe("number");
    });
  });

  describe("slack 格式", () => {
    it("应返回包含 text 和 blocks 的结构", () => {
      const result = WebhookFormatter.format("slack", NotificationEvent.BALANCE_LOW, basePayload);
      expect(result.text).toBe("余额不足");
      expect(Array.isArray(result.blocks)).toBe(true);
    });

    it("blocks 应包含 header、section、context 三个块", () => {
      const result = WebhookFormatter.format("slack", NotificationEvent.BALANCE_LOW, basePayload);
      const blocks = result.blocks as any[];
      expect(blocks[0].type).toBe("header");
      expect(blocks[1].type).toBe("section");
      expect(blocks[2].type).toBe("context");
    });

    it("header 块应包含 title 文本", () => {
      const result = WebhookFormatter.format("slack", NotificationEvent.BALANCE_LOW, basePayload);
      const blocks = result.blocks as any[];
      expect(blocks[0].text.text).toBe("余额不足");
    });

    it("section 块应包含 content 文本", () => {
      const result = WebhookFormatter.format("slack", NotificationEvent.BALANCE_LOW, basePayload);
      const blocks = result.blocks as any[];
      expect(blocks[1].text.text).toBe("您的账户余额已低于阈值");
    });

    it("context 块应包含 timestamp", () => {
      const result = WebhookFormatter.format("slack", NotificationEvent.BALANCE_LOW, basePayload);
      const blocks = result.blocks as any[];
      expect(blocks[2].elements[0].text).toContain("2026-05-22T10:00:00.000Z");
    });
  });

  describe("feishu 格式", () => {
    it("应返回 msg_type 为 interactive 的结构", () => {
      const result = WebhookFormatter.format("feishu", NotificationEvent.BALANCE_LOW, basePayload);
      expect(result.msg_type).toBe("interactive");
    });

    it("card.header.title 应包含通知标题", () => {
      const result = WebhookFormatter.format("feishu", NotificationEvent.BALANCE_LOW, basePayload);
      const card = result.card as any;
      expect(card.header.title.content).toBe("余额不足");
    });

    it("有 data 时 elements 应包含 fields div", () => {
      const result = WebhookFormatter.format("feishu", NotificationEvent.BALANCE_LOW, basePayload);
      const card = result.card as any;
      const fieldDiv = card.elements.find((el: any) => el.tag === "div" && el.fields);
      expect(fieldDiv).toBeTruthy();
      expect(fieldDiv.fields.length).toBe(2);
    });

    it("无 data 时不应包含 fields div", () => {
      const result = WebhookFormatter.format("feishu", NotificationEvent.ABNORMAL_LOGIN, payloadNoData);
      const card = result.card as any;
      const fieldDiv = card.elements.find((el: any) => el.tag === "div" && el.fields);
      expect(fieldDiv).toBeUndefined();
    });

    it("最后一个 element 应为 note 包含 timestamp", () => {
      const result = WebhookFormatter.format("feishu", NotificationEvent.BALANCE_LOW, basePayload);
      const card = result.card as any;
      const note = card.elements[card.elements.length - 1];
      expect(note.tag).toBe("note");
      expect(note.elements[0].content).toBe("2026-05-22T10:00:00.000Z");
    });
  });

  describe("wechat_work 格式", () => {
    it("应返回 msgtype 为 markdown 的结构", () => {
      const result = WebhookFormatter.format("wechat_work", NotificationEvent.BALANCE_LOW, basePayload);
      expect(result.msgtype).toBe("markdown");
    });

    it("markdown.content 应包含标题和内容", () => {
      const result = WebhookFormatter.format("wechat_work", NotificationEvent.BALANCE_LOW, basePayload);
      const md = result.markdown as any;
      expect(md.content).toContain("余额不足");
      expect(md.content).toContain("您的账户余额已低于阈值");
    });

    it("有 data 时 content 应包含 key-value 行", () => {
      const result = WebhookFormatter.format("wechat_work", NotificationEvent.BALANCE_LOW, basePayload);
      const md = result.markdown as any;
      expect(md.content).toContain("balance");
      expect(md.content).toContain("9.50");
    });

    it("无 data 时 content 不应包含多余行", () => {
      const result = WebhookFormatter.format("wechat_work", NotificationEvent.ABNORMAL_LOGIN, payloadNoData);
      const md = result.markdown as any;
      expect(md.content).toBe("**异常登录**\n检测到异常登录行为");
    });
  });

  describe("所有格式的边缘情况", () => {
    it("data 值为数字时应正确序列化", () => {
      const payload: WebhookPayload = {
        ...basePayload,
        data: { count: 42, ratio: 0.95 },
      };
      // discord fields 应将数字转为字符串
      const discord = WebhookFormatter.format("discord", NotificationEvent.BALANCE_LOW, payload);
      const fields = (discord.embeds as any[])[0].fields as any[];
      expect(fields.find((f: any) => f.name === "count").value).toBe("42");
    });

    it("title 含特殊字符时不应抛出", () => {
      const payload: WebhookPayload = {
        ...basePayload,
        title: '<script>alert("xss")</script>',
      };
      expect(() => WebhookFormatter.format("generic", NotificationEvent.BALANCE_LOW, payload)).not.toThrow();
    });
  });
});
