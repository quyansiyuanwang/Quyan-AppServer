import { describe, expect, it } from "vitest";
import { EmailTemplateRenderer } from "../../../src/services/notification/email-template-renderer";
import { NotificationTemplateRegistry } from "../../../src/services/notification/notification-template";
import { NotificationEvent } from "../../../src/constant/notification-event";

describe("NotificationTemplateRegistry", () => {
  it("builds a concise monitor recovery document without the internal monitor ID", () => {
    const document = NotificationTemplateRegistry.build(NotificationEvent.DEVELOPER_MONITOR_RECOVERED, {
      monitorName: "CMS API",
      targetUrl: "https://example.com/health",
      method: "GET",
      previousStatus: "down",
      currentStatus: "up",
      statusCode: 403,
      latencyMs: 120,
      checkedAt: "2026-08-07T00:00:00.000Z",
      monitorId: "internal-id",
    });

    expect(document.subject).toBe("监控恢复：CMS API");
    expect(document.summary).toBe("服务已恢复");
    expect(JSON.stringify(document.blocks)).toContain("HTTP 403");
    expect(JSON.stringify(document.blocks)).not.toContain("internal-id");
  });
});

describe("EmailTemplateRenderer", () => {
  it("escapes text, excludes unsafe actions, and provides a plain text alternative", () => {
    const document = NotificationTemplateRegistry.build(NotificationEvent.BALANCE_LOW, {
      currentBalance: "<5>",
      threshold: "10",
    });
    document.blocks.push({
      type: "actions",
      items: [
        { label: "安全链接", url: "https://example.com" },
        { label: "不安全链接", url: "javascript:alert(1)" },
      ],
    });

    const rendered = EmailTemplateRenderer.render(document, {
      trackingPixelUrl: "https://api.example.com/pixel/1",
    });

    expect(rendered.html).toContain("&lt;5&gt;");
    expect(rendered.html).not.toContain("javascript:alert");
    expect(rendered.html).toContain("https://api.example.com/pixel/1");
    expect(rendered.text).toContain("当前余额: <5>");
  });
});
