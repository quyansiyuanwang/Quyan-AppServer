import type { NotificationBlock, NotificationDocument, NotificationSeverity } from "./notification-template";

export interface EmailTemplateRenderOptions {
  trackingPixelUrl?: string;
}

export interface RenderedEmailTemplate {
  html: string;
  text: string;
}

const severityColors: Record<NotificationSeverity, string> = {
  info: "#2563eb",
  success: "#16a34a",
  warning: "#d97706",
  error: "#dc2626",
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const isSafeUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const blockText = (block: NotificationBlock): string[] => {
  switch (block.type) {
    case "text":
      return [block.text];
    case "status":
      return [`${block.label}: ${block.value}`];
    case "fields":
      return [...(block.title ? [block.title] : []), ...block.items.map((item) => `${item.label}: ${item.value}`)];
    case "actions":
      return block.items.filter((item) => isSafeUrl(item.url)).map((item) => `${item.label}: ${item.url}`);
  }
};

const renderBlock = (block: NotificationBlock): string => {
  switch (block.type) {
    case "text":
      return `<p style="margin:16px 0;color:#334155;font-size:14px;line-height:1.6;">${escapeHtml(block.text)}</p>`;
    case "status":
      return `<p style="margin:16px 0;"><span style="display:inline-block;border-radius:999px;padding:5px 10px;background:${severityColors[block.tone ?? "info"]}18;color:${severityColors[block.tone ?? "info"]};font-size:13px;font-weight:600;">${escapeHtml(block.label)}：${escapeHtml(block.value)}</span></p>`;
    case "fields": {
      if (!block.items.length) return "";
      const rows = block.items
        .map(
          (item) =>
            `<tr><td style="padding:8px 12px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;width:35%;">${escapeHtml(item.label)}</td><td style="padding:8px 12px;color:#0f172a;font-size:13px;border-bottom:1px solid #e2e8f0;${item.emphasis ? "font-weight:600;" : ""}">${escapeHtml(item.value)}</td></tr>`,
        )
        .join("");
      return `${block.title ? `<h3 style="margin:20px 0 8px;color:#334155;font-size:14px;">${escapeHtml(block.title)}</h3>` : ""}<table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">${rows}</table>`;
    }
    case "actions":
      return block.items
        .filter((item) => isSafeUrl(item.url))
        .map(
          (item) =>
            `<a href="${escapeHtml(item.url)}" style="display:inline-block;margin:20px 8px 0 0;padding:9px 14px;border-radius:6px;background:#2563eb;color:#fff;text-decoration:none;font-size:14px;">${escapeHtml(item.label)}</a>`,
        )
        .join("");
  }
};

export class EmailTemplateRenderer {
  static render(document: NotificationDocument, options: EmailTemplateRenderOptions = {}): RenderedEmailTemplate {
    const blocks = document.blocks.map(renderBlock).join("");
    const pixel =
      options.trackingPixelUrl && isSafeUrl(options.trackingPixelUrl)
        ? `<img src="${escapeHtml(options.trackingPixelUrl)}" width="1" height="1" style="display:none;border:0;" alt="" />`
        : "";
    const text = [
      document.subject,
      document.summary,
      ...document.blocks.flatMap(blockText),
      "此邮件由系统自动发送，请勿回复。",
    ]
      .filter(Boolean)
      .join("\n");
    return {
      text,
      html: `<div style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,'Microsoft YaHei',sans-serif;color:#0f172a;"><div style="max-width:600px;margin:0 auto;padding:28px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;"><div style="height:4px;margin:-28px -28px 24px;background:${severityColors[document.severity]};border-radius:12px 12px 0 0;"></div><h1 style="margin:0;color:#0f172a;font-size:20px;line-height:1.4;">${escapeHtml(document.subject)}</h1><p style="margin:10px 0 0;color:#475569;font-size:15px;line-height:1.6;">${escapeHtml(document.summary)}</p>${blocks}<p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">此邮件由系统自动发送，请勿回复。</p>${pixel}</div></div>`,
    };
  }
}
