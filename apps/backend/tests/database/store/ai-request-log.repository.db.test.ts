import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "@/config/database";
import { AIRequestLogRepository } from "@/store/system/ai-request-log.repository";
const repository = AIRequestLogRepository.getInstance();
let prefix: string;
const create = async (extra: Record<string, unknown> = {}) =>
  prisma.aIRequestLog.create({
    data: {
      requestId: prefix + randomUUID().slice(0, 8),
      path: "/relay/proxy/v1/messages",
      method: "POST",
      statusCode: 200,
      ipAddress: "127.0.0.1",
      ...extra,
    },
  });
const query = (keyword: string, extra = {}) =>
  repository.query({ page: 1, pageSize: 20, requestId: prefix, keyword, ...extra });
describe("AI request log paged database queries", () => {
  beforeEach(() => {
    prefix = "audit-db-" + randomUUID().slice(0, 8) + "-";
  });
  afterEach(async () => {
    await prisma.aIRequestLog.deleteMany({ where: { requestId: { startsWith: prefix } } });
  });
  it("matches nested decoded Chinese/newline values and JSON numeric keys without returning bodies", async () => {
    const row = await create({
      requestBody: { messages: [{ content: "中文目标\n下一行" }], temperature: 0.7 },
      responseBody: { output: "answer" },
    });
    const result = await query("中文目标\n下一行");
    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe(row.id);
    expect(result.items[0]).not.toHaveProperty("requestBody");
    expect(result.items[0]).not.toHaveProperty("responseBody");
    expect(result.items[0]).not.toHaveProperty("attempts");
    expect((await query("temperature")).total).toBe(1);
    expect((await query("0.7")).total).toBe(1);
  });
  it("escapes %, _, quotes and escape characters literally", async () => {
    await create({ requestBody: { text: "literal 100%_ = '中文'" } });
    await create({ requestBody: { text: "literal 100anything" } });
    expect((await query("100%_")).total).toBe(1);
    expect((await query("= '中文'")).total).toBe(1);
    expect((await query("' OR 1=1 --")).total).toBe(0);
  });
  it("matches SSE and user/token/model/error metadata", async () => {
    await create({
      username: "fixture-user",
      relayTokenId: "fixture-token",
      model: "fixture-model",
      errorSummary: "fixture-failure",
      responseBody: 'data: {"delta":{"text":"流式答案"}}\n\n',
    });
    for (const needle of ["流式答案", "fixture-user", "fixture-token", "fixture-model", "fixture-failure"])
      expect((await query(needle)).total).toBe(1);
  });
  it("combines failure, streaming, IP, duration and time filters independently of HTTP 200", async () => {
    await create({
      outcome: "failed",
      isStreaming: true,
      failureStage: "settlement",
      durationMs: 230,
      errorSummary: "failure",
    });
    expect(
      (
        await query("failure", {
          outcome: "failed",
          isStreaming: true,
          failureStage: "settlement",
          minDurationMs: 200,
          maxDurationMs: 300,
          ipAddress: "127.0.0.1",
          startDate: new Date(Date.now() - 60000),
          endDate: new Date(Date.now() + 60000),
        })
      ).total,
    ).toBe(1);
    expect((await query("failure", { outcome: "success" })).total).toBe(0);
  });
  it("reads metadata and only the selected side and leaves legacy nullable fields unchanged", async () => {
    const row = await create({ requestBody: { input: "saved" }, responseBody: { output: "large saved response" } });
    const metadata = await repository.findMetadata(row.id);
    expect(Boolean(metadata?.hasRequestBody)).toBe(true);
    expect(metadata?.outcome).toBeNull();
    expect(metadata).not.toHaveProperty("requestBody");
    const requestOnly = await repository.findPayload(row.id, "request");
    expect(requestOnly?.responseBody).toBeNull();
    expect(requestOnly?.requestBody).toEqual({ input: "saved" });
  });
  it("breaks timestamp ties with ID and supports real database pagination", async () => {
    const time = new Date("2026-09-20T00:00:00Z");
    for (let i = 0; i < 6; i++) await create({ createTime: time, requestBody: { text: "page marker" } });
    const first = await query("page marker", { pageSize: 3 });
    const second = await query("page marker", { pageSize: 3, page: 2 });
    expect(first.total).toBe(6);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(6);
  });
});
