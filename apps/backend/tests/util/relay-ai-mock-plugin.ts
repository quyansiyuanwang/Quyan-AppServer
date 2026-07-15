import http, { IncomingMessage, ServerResponse } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { RelayRequestFormat } from "@appserver/shared";

type RelayAIMockFormat = RelayRequestFormat;

interface RelayAIMockUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface RelayAIMockRequestContext {
  format: RelayAIMockFormat;
  pathname: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
  model: string;
}

export interface RelayAIMockReply {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  streamChunks?: string[];
}

export type RelayAIMockHandler = (ctx: RelayAIMockRequestContext) => RelayAIMockReply | Promise<RelayAIMockReply>;

export interface RelayAIMockPluginOptions {
  host?: string;
  defaultModel?: string;
  contentPrefix?: string;
  usage?: Partial<RelayAIMockUsage>;
}

const DEFAULT_USAGE: RelayAIMockUsage = {
  promptTokens: 12,
  completionTokens: 9,
  totalTokens: 21,
};

const OPENAI_PATHS = new Set([
  "/chat/completions",
  "/v1/chat/completions",
  "/responses",
  "/v1/responses",
  "/images/generations",
  "/v1/images/generations",
  "/images/edits",
  "/v1/images/edits",
]);

const ANTHROPIC_PATHS = new Set(["/messages", "/v1/messages"]);

const readJsonBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve());
    req.on("error", reject);
  });

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
};

const extractGeminiModelFromPath = (pathname: string): string | null => {
  const colonMatch = pathname.match(/\/models\/([^/:]+):/);
  if (colonMatch?.[1]) return colonMatch[1];

  const slashMatch = pathname.match(/\/models\/([^/]+)\//);
  if (slashMatch?.[1]) return slashMatch[1];

  return null;
};

const resolveUsage = (usage?: Partial<RelayAIMockUsage>): RelayAIMockUsage => {
  const promptTokens = Math.max(0, Math.floor(Number(usage?.promptTokens ?? DEFAULT_USAGE.promptTokens)));
  const completionTokens = Math.max(0, Math.floor(Number(usage?.completionTokens ?? DEFAULT_USAGE.completionTokens)));
  const totalTokens = Math.max(
    promptTokens + completionTokens,
    Math.floor(Number(usage?.totalTokens ?? DEFAULT_USAGE.totalTokens)),
  );

  return { promptTokens, completionTokens, totalTokens };
};

export class RelayAIMockPlugin {
  private readonly host: string;
  private readonly defaultModel: string;
  private readonly contentPrefix: string;
  private readonly usage: RelayAIMockUsage;

  private server: http.Server | null = null;
  private port = 0;

  private openaiHandler: RelayAIMockHandler;
  private anthropicHandler: RelayAIMockHandler;
  private geminiHandler: RelayAIMockHandler;

  private errorMode: { status: number; message: string } | null = null;

  constructor(options: RelayAIMockPluginOptions = {}) {
    this.host = options.host || "127.0.0.1";
    this.defaultModel = options.defaultModel || "test-mock-model";
    this.contentPrefix = options.contentPrefix || "模拟AI输出-";
    this.usage = resolveUsage(options.usage);

    this.openaiHandler = async (ctx) => ({
      ...(this.isStreamRequest(ctx) ? this.buildOpenAIStreamReply(ctx) : { body: this.buildOpenAIBody(ctx) }),
    });
    this.anthropicHandler = async (ctx) => ({
      ...(this.isStreamRequest(ctx) ? this.buildAnthropicStreamReply(ctx) : { body: this.buildAnthropicBody(ctx) }),
    });
    this.geminiHandler = async (ctx) => ({
      ...(this.isStreamRequest(ctx) ? this.buildGeminiStreamReply(ctx) : { body: this.buildGeminiBody(ctx) }),
    });
  }

  get baseUrl(): string {
    if (!this.port) throw new Error("RelayAIMockPlugin is not started yet");
    return `http://${this.host}:${this.port}`;
  }

  useOpenAI(handler: RelayAIMockHandler): this {
    this.openaiHandler = handler;
    return this;
  }

  useAnthropic(handler: RelayAIMockHandler): this {
    this.anthropicHandler = handler;
    return this;
  }

  useGemini(handler: RelayAIMockHandler): this {
    this.geminiHandler = handler;
    return this;
  }

  setErrorMode(status: number, message: string): this {
    this.errorMode = { status, message };
    return this;
  }

  clearErrorMode(): this {
    this.errorMode = null;
    return this;
  }

  async start(): Promise<void> {
    if (this.server) return;

    this.server = http.createServer(async (req, res) => {
      try {
        await this.handleRequest(req, res);
      } catch (error) {
        const message = error instanceof Error ? error.message : "mock server error";
        this.sendJson(res, 500, { error: message });
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(0, this.host, () => {
        const address = this.server!.address() as AddressInfo;
        this.port = address.port;
        resolve();
      });
      this.server!.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;

    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    this.server = null;
    this.port = 0;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method || "GET";
    const reqUrl = req.url || "/";
    const url = new URL(reqUrl, `http://${this.host}`);
    const pathname = url.pathname;

    if (method !== "POST") {
      this.sendJson(res, 405, { error: `method ${method} is not allowed` });
      return;
    }

    // Check if error mode is enabled
    if (this.errorMode) {
      this.sendJson(res, this.errorMode.status, { error: this.errorMode.message });
      return;
    }

    const body = await readJsonBody(req);
    const format = this.resolveFormat(pathname);
    if (!format) {
      this.sendJson(res, 404, { error: `mock upstream path not found: ${pathname}` });
      return;
    }

    const modelFromBody = typeof body.model === "string" ? body.model : null;
    const modelFromPath = format === "gemini" ? extractGeminiModelFromPath(pathname) : null;
    const model = modelFromBody || modelFromPath || this.defaultModel;

    const ctx: RelayAIMockRequestContext = {
      format,
      pathname,
      query: url.searchParams,
      headers: req.headers,
      body,
      model,
    };

    let reply: RelayAIMockReply;
    if (format === "openai") reply = await this.openaiHandler(ctx);
    else if (format === "anthropic") reply = await this.anthropicHandler(ctx);
    else reply = await this.geminiHandler(ctx);

    const status = reply.status ?? 200;
    if (reply.streamChunks?.length) {
      this.sendStream(res, status, reply.streamChunks, reply.headers);
      return;
    }

    this.sendJson(res, status, reply.body ?? {}, reply.headers);
  }

  private resolveFormat(pathname: string): RelayAIMockFormat | null {
    if (OPENAI_PATHS.has(pathname)) return "openai";
    if (ANTHROPIC_PATHS.has(pathname)) return "anthropic";

    // 支持任意版本号的OpenAI路径 (v1, v2, v3, etc.)
    if (/^\/v\d+\/(chat\/completions|responses|images\/generations|images\/edits)$/.test(pathname)) return "openai";

    if (/^\/v1beta\/models\//.test(pathname) || /^\/v1\/models\//.test(pathname)) return "gemini";

    return null;
  }

  private sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, {
      "Content-Type": "application/json",
      ...headers,
    });
    res.end(JSON.stringify(body));
  }

  private sendStream(
    res: ServerResponse,
    status: number,
    chunks: string[],
    headers: Record<string, string> = {},
  ): void {
    res.writeHead(status, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...headers,
    });

    chunks.forEach((chunk) => {
      res.write(chunk);
    });
    res.end();
  }

  private isStreamRequest(ctx: RelayAIMockRequestContext): boolean {
    if (ctx.format === "gemini") return ctx.pathname.includes("streamGenerateContent");
    return ctx.body.stream === true;
  }

  private buildMockContent(): string {
    return `${this.contentPrefix}${randomUUID().slice(0, 8)}：这是中转插件生成的模拟输出。`;
  }

  private splitContent(content: string): [string, string] {
    const splitIndex = Math.max(1, Math.floor(content.length / 2));
    const first = content.slice(0, splitIndex);
    const second = content.slice(splitIndex) || "。";
    return [first, second];
  }

  private toSSEData(payload: unknown): string {
    return `data: ${JSON.stringify(payload)}\n\n`;
  }

  private buildOpenAIStreamReply(ctx: RelayAIMockRequestContext): RelayAIMockReply {
    const content = this.buildMockContent();
    const [part1, part2] = this.splitContent(content);

    if (ctx.pathname.endsWith("/responses")) {
      const responseId = `resp_mock_${randomUUID().slice(0, 8)}`;

      return {
        streamChunks: [
          this.toSSEData({ type: "response.output_text.delta", delta: part1 }),
          this.toSSEData({ type: "response.output_text.delta", delta: part2 }),
          this.toSSEData({
            type: "response.completed",
            response: {
              id: responseId,
              object: "response",
              model: ctx.model,
              output: [
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: `${part1}${part2}` }],
                },
              ],
              usage: {
                input_tokens: this.usage.promptTokens,
                output_tokens: this.usage.completionTokens,
                total_tokens: this.usage.totalTokens,
              },
            },
          }),
          "data: [DONE]\n\n",
        ],
      };
    }

    const streamId = `chatcmpl_mock_${randomUUID().slice(0, 8)}`;

    return {
      streamChunks: [
        this.toSSEData({
          id: streamId,
          object: "chat.completion.chunk",
          model: ctx.model,
          choices: [{ index: 0, delta: { role: "assistant", content: part1 }, finish_reason: null }],
        }),
        this.toSSEData({
          id: streamId,
          object: "chat.completion.chunk",
          model: ctx.model,
          choices: [{ index: 0, delta: { content: part2 }, finish_reason: null }],
        }),
        this.toSSEData({
          id: streamId,
          object: "chat.completion.chunk",
          model: ctx.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        }),
        this.toSSEData({
          id: streamId,
          object: "chat.completion.chunk",
          model: ctx.model,
          choices: [],
          usage: {
            prompt_tokens: this.usage.promptTokens,
            completion_tokens: this.usage.completionTokens,
            total_tokens: this.usage.totalTokens,
          },
        }),
        "data: [DONE]\n\n",
      ],
    };
  }

  private buildAnthropicStreamReply(ctx: RelayAIMockRequestContext): RelayAIMockReply {
    const content = this.buildMockContent();
    const [part1, part2] = this.splitContent(content);

    return {
      streamChunks: [
        this.toSSEData({
          type: "message_start",
          message: {
            id: `msg_mock_${randomUUID().slice(0, 8)}`,
            type: "message",
            role: "assistant",
            model: ctx.model,
            usage: {
              input_tokens: this.usage.promptTokens,
            },
          },
        }),
        this.toSSEData({
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        }),
        this.toSSEData({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: part1 },
        }),
        this.toSSEData({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: part2 },
        }),
        this.toSSEData({
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: {
            output_tokens: this.usage.completionTokens,
          },
        }),
        this.toSSEData({ type: "message_stop" }),
        "data: [DONE]\n\n",
      ],
    };
  }

  private buildGeminiStreamReply(ctx: RelayAIMockRequestContext): RelayAIMockReply {
    const content = this.buildMockContent();
    const [part1, part2] = this.splitContent(content);

    return {
      streamChunks: [
        `${JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: part1 }],
              },
            },
          ],
        })}\n`,
        `${JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: part2 }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: this.usage.promptTokens,
            candidatesTokenCount: this.usage.completionTokens,
            totalTokenCount: this.usage.totalTokens,
          },
          modelVersion: ctx.model,
        })}\n`,
      ],
    };
  }

  private buildOpenAIBody(ctx: RelayAIMockRequestContext): Record<string, unknown> {
    const content = this.buildMockContent();

    if (ctx.pathname.endsWith("/responses"))
      return {
        id: `resp_mock_${randomUUID().slice(0, 8)}`,
        object: "response",
        model: ctx.model,
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: content }],
          },
        ],
        usage: {
          input_tokens: this.usage.promptTokens,
          output_tokens: this.usage.completionTokens,
          total_tokens: this.usage.totalTokens,
        },
      };

    return {
      id: `chatcmpl_mock_${randomUUID().slice(0, 8)}`,
      object: "chat.completion",
      model: ctx.model,
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content,
          },
        },
      ],
      usage: {
        prompt_tokens: this.usage.promptTokens,
        completion_tokens: this.usage.completionTokens,
        total_tokens: this.usage.totalTokens,
      },
    };
  }

  private buildAnthropicBody(ctx: RelayAIMockRequestContext): Record<string, unknown> {
    const content = this.buildMockContent();

    return {
      id: `msg_mock_${randomUUID().slice(0, 8)}`,
      type: "message",
      role: "assistant",
      model: ctx.model,
      content: [
        {
          type: "text",
          text: content,
        },
      ],
      usage: {
        input_tokens: this.usage.promptTokens,
        output_tokens: this.usage.completionTokens,
      },
    };
  }

  private buildGeminiBody(ctx: RelayAIMockRequestContext): Record<string, unknown> {
    const content = this.buildMockContent();

    return {
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: content }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: this.usage.promptTokens,
        candidatesTokenCount: this.usage.completionTokens,
        totalTokenCount: this.usage.totalTokens,
      },
      modelVersion: ctx.model,
    };
  }
}

export const createRelayAIMockPlugin = (options: RelayAIMockPluginOptions = {}): RelayAIMockPlugin => {
  return new RelayAIMockPlugin(options);
};
