import { describe, expect, it } from "vitest";
import { contentPage, searchContent } from "@/util/ai-request-log-content";
import { auditUtf8Slice, sanitizeAuditPayload, safeAttemptExcerpt } from "@/util/ai-request-log-payload";
import { AI_REQUEST_LOG_LIMITS } from "@/constant/ai-request-log";
const base = { id: "test-log", side: "request" as const, truncated: false, omissionReason: null };
describe("AI audit bounded content", () => {
  it("loads unknown JSON structure one bounded subtree at a time", () => {
    const value = { extra: { nodes: Array.from({ length: 50 }, (_, i) => ({ label: "node-" + i })) } };
    const root = contentPage({ ...base, value, view: "parsed" });
    expect(root.items[0]?.expandable).toBe(true);
    const child = contentPage({ ...base, value, view: "parsed", locator: root.items[0]!.locator });
    expect(child.items[0]?.path).toBe("/extra/nodes");
    const leaves = contentPage({ ...base, value, view: "parsed", locator: child.items[0]!.locator });
    expect(leaves.items).toHaveLength(20);
    expect(leaves.hasMore).toBe(true);
  });
  it("finds field names as well as values and formats provider messages", () => {
    const value = { temperature: 0.7 };
    expect(searchContent({ ...base, value, keyword: "temperature" }).total).toBe(1);
    const gemini = contentPage({
      ...base,
      value: { contents: [{ role: "user", parts: [{ text: "readable Gemini text" }] }] },
      view: "parsed",
    });
    expect(gemini.items[0]?.text).toBe("readable Gemini text");
    const chat = contentPage({
      ...base,
      side: "response",
      value: { choices: [{ message: { role: "assistant", content: "readable answer" } }] },
      view: "parsed",
    });
    expect(chat.items[0]?.text).toBe("readable answer");
  });

  it("pages 98 tool definitions without transferring schemas", () => {
    const value = {
      model: "fixture-model",
      tools: Array.from({ length: 98 }, (_, i) => ({
        name: "tool-" + i,
        description: "x".repeat(9000),
        input_schema: { type: "object" },
      })),
    };
    const first = contentPage({ ...base, value, view: "parsed" });
    expect(first.items).toHaveLength(20);
    expect(first.totalItems).toBe(99);
    expect(first.hasMore).toBe(true);
    expect(first.items.filter((item) => item.section === "tools").every((item) => item.text === "")).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(AI_REQUEST_LOG_LIMITS.contentChunkBytes);
    const second = contentPage({ ...base, value, view: "parsed", cursor: first.nextCursor! });
    expect(second.items[0]?.label).toBe("tool-19");
    const expanded = contentPage({ ...base, value, view: "raw", locator: first.items[1]!.locator });
    expect(expanded.items[0]?.text).toContain('"description"');
  });
  it("limits each raw segment even for a single 2 MiB string", () => {
    const value = "汉🙂".repeat(300000);
    let cursor: string | undefined;
    let result = "";
    do {
      const page = contentPage({ ...base, value, view: "raw", cursor });
      expect(Buffer.byteLength(page.items[0]!.text)).toBeLessThanOrEqual(32768);
      expect(page.items[0]!.text).not.toContain("�");
      result += page.items[0]!.text;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(result).toBe(value);
  });
  it("rejects cursors for another log, side, view or subtree", () => {
    const page = contentPage({ ...base, value: "a".repeat(40000), view: "raw" });
    expect(() =>
      contentPage({ ...base, id: "different", value: "a".repeat(40000), view: "raw", cursor: page.nextCursor! }),
    ).toThrow();
    expect(() =>
      contentPage({ ...base, value: "a".repeat(40000), view: "parsed", cursor: page.nextCursor! }),
    ).toThrow();
    expect(() => contentPage({ ...base, value: {}, view: "parsed", locator: "__proto__" })).toThrow();
  });
  it("searches unloaded nested fields and treats wildcard characters literally", () => {
    const value = {
      tools: Array.from({ length: 98 }, (_, i) => ({
        name: "t" + i,
        description: i === 97 ? "目标 中文 100%_\n下一行" : "ordinary",
      })),
    };
    const result = searchContent({ ...base, value, keyword: "100%_\n下一行" });
    expect(result.total).toBe(1);
    expect(result.items[0]?.path).toContain("/97/description");
    const focus = contentPage({
      ...base,
      value,
      view: "raw",
      locator: result.items[0]!.locator,
      offset: result.items[0]!.offset,
    });
    expect(focus.items[0]!.text).toContain("100%_");
  });
  it("paginates hits without allocating all matching excerpts", () => {
    const value = { text: "match ".repeat(1000) };
    const first = searchContent({ ...base, value, keyword: "match", pageSize: 20 });
    const next = searchContent({ ...base, value, keyword: "match", cursor: first.nextCursor!, pageSize: 20 });
    expect(first.total).toBe(1000);
    expect(next.items).toHaveLength(20);
    expect(next.items[1]!.offset).toBeGreaterThan(0);
    expect(() => searchContent({ ...base, value, keyword: "other", cursor: first.nextCursor! })).toThrow();
  });
  it("parses provider stream events and reconstructs output without a model call", () => {
    const value =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"text":" world"}}\n\n';
    const page = contentPage({ ...base, value, side: "response", view: "parsed" });
    expect(page.items.find((item) => item.section === "output")?.text).toBe("hello world");
    expect(searchContent({ ...base, side: "response", value, keyword: "world" }).total).toBeGreaterThan(0);
  });
  it("reports omission and truncation without pretending missing content can be restored", () => {
    expect(contentPage({ ...base, value: null, view: "raw" }).omissionReason).toBe("not-recorded");
    expect(
      contentPage({ ...base, value: { _truncated: true, _preview: "saved" }, truncated: true, view: "parsed" })
        .truncated,
    ).toBe(true);
  });
  it("sanitizes nested JSON/SSE credentials and never serializes a transport Error", () => {
    const input =
      'data: {"api_key":"secret-value","message":"ok","nested":{"authorization":"Bearer other-secret"}}\n\n';
    const output = String(sanitizeAuditPayload(input));
    expect(output).not.toContain("secret-value");
    expect(output).not.toContain("other-secret");
    expect(safeAttemptExcerpt(new Error("https://internal.invalid/?api_key=secret"))).toBe("Upstream request failed");
    expect(
      safeAttemptExcerpt({ error: { message: "https://internal.invalid/endpoint Bearer hidden" }, token: "hidden" }),
    ).not.toContain("internal.invalid");
  });
  it("cuts UTF-8 text without replacement bytes", () => {
    expect(auditUtf8Slice("🙂中", 0, 5)).toEqual({ text: "🙂", nextOffset: 4 });
  });
});
