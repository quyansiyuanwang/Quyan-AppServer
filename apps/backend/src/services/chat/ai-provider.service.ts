import axios from "axios";
import https from "https";
import http from "http";
import { extractTokenUsageMetrics, normalizeTokenBreakdown } from "@/util/token-usage.util";
import type { RelayRequestFormat } from "@/util/relay-model-availability.util";

// Reuse HTTP agents for connection pooling
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
});

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
});

interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatCompletionOptions {
  /** Provider-specific output cap; undefined preserves the upstream default. */
  maxOutputTokens?: number;
  /** Server-generated, non-credential headers for a trusted first-party relay hop. */
  requestHeaders?: Readonly<Record<string, string>>;
}

export type StreamChunk =
  | { content: string; done: false }
  | {
      done: true;
      inputTokens?: number;
      outputTokens?: number;
      cacheCreationTokens?: number;
      cacheReadTokens?: number;
      totalOutputTime?: number;
      timeToFirstByte?: number;
      isStreaming?: boolean;
    };

interface TokenMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export class AIProviderService {
  private static instance: AIProviderService;

  private readonly anthropicVersion = "2023-06-01";

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private extractTextValue(value: unknown): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((item) => this.extractTextValue(item)).join("");
    if (!this.isRecord(value)) return "";

    if (typeof value.text === "string") return value.text;
    if (typeof value.output_text === "string") return value.output_text;
    if (typeof value.value === "string") return value.value;
    if (Array.isArray(value.content)) return value.content.map((item) => this.extractTextValue(item)).join("");
    if (Array.isArray(value.output)) return value.output.map((item) => this.extractTextValue(item)).join("");

    return "";
  }

  private extractResponseEventText(event: unknown): string {
    if (!this.isRecord(event)) return "";

    const eventType = typeof event.type === "string" ? event.type : "";
    const deltaText = this.extractTextValue(event.delta);
    if (deltaText.length > 0) return deltaText;

    if (eventType === "response.output_text.delta") return this.extractTextValue(event.delta);
    if (eventType === "response.output_text") return this.extractTextValue(event.text);
    if (eventType === "response.output_text.done") return this.extractTextValue(event.text);

    // Some compatible Responses upstreams omit output_text delta events and only
    // include the completed output tree in the final event.
    if (eventType === "response.completed") return this.extractTextValue(event.response);

    return "";
  }

  private updateTokenMetrics(usagePayload: unknown, metrics: TokenMetrics, fallbackInputTokens: number): TokenMetrics {
    const usage = extractTokenUsageMetrics(usagePayload);
    const normalizedTokens = normalizeTokenBreakdown(
      usage.inputTokens,
      usage.outputTokens,
      usage.totalTokens,
      fallbackInputTokens,
    );

    return {
      inputTokens: normalizedTokens.inputTokens > 0 ? normalizedTokens.inputTokens : metrics.inputTokens,
      outputTokens: normalizedTokens.outputTokens > 0 ? normalizedTokens.outputTokens : metrics.outputTokens,
      cacheCreationTokens: usage.cacheCreationTokens > 0 ? usage.cacheCreationTokens : metrics.cacheCreationTokens,
      cacheReadTokens: usage.cacheReadTokens > 0 ? usage.cacheReadTokens : metrics.cacheReadTokens,
    };
  }

  static getInstance() {
    if (!this.instance) this.instance = new AIProviderService();
    return this.instance;
  }

  getProvider(model: string): RelayRequestFormat {
    if (model.startsWith("gpt-") || model.startsWith("o1-")) return "openai";
    if (model.startsWith("claude-")) return "anthropic";
    if (model.startsWith("gemini-")) return "gemini";
    return "openai";
  }

  private resolveProvider(model: string, requestFormat?: RelayRequestFormat): RelayRequestFormat {
    return requestFormat || this.getProvider(model);
  }

  private toAnthropicMessages(messages: ChatMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
    return messages
      .filter(
        (message): message is ChatMessage & { role: "user" | "assistant" } =>
          message.role === "user" || message.role === "assistant",
      )
      .map((message) => ({ role: message.role, content: message.content }));
  }

  private toGeminiRequest(messages: ChatMessage[]) {
    const contents = messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

    return { contents };
  }

  private estimateInputTokens(messages: ChatMessage[]): number {
    return Math.ceil(JSON.stringify(messages).length / 4);
  }

  private extractAnthropicTextDelta(payload: unknown): string {
    if (!this.isRecord(payload)) return "";

    const payloadType = typeof payload.type === "string" ? payload.type : "";
    if (payloadType === "content_block_delta") return this.extractTextValue(payload.delta);
    if (payloadType === "message_delta") return this.extractTextValue(payload.delta);
    if (payloadType === "message" || payloadType === "message_start") return this.extractTextValue(payload.content);

    return "";
  }

  private extractGeminiTextDelta(payload: unknown): string {
    if (!this.isRecord(payload)) return "";

    if (Array.isArray(payload.candidates))
      return payload.candidates
        .map((candidate) => {
          if (!this.isRecord(candidate)) return "";
          const content = candidate.content;
          if (!this.isRecord(content) || !Array.isArray(content.parts)) return "";
          return content.parts.map((part) => this.extractTextValue(part)).join("");
        })
        .join("");

    return "";
  }

  private extractGeminiUsage(payload: unknown): unknown {
    if (!this.isRecord(payload)) return undefined;

    const metadata = this.isRecord(payload.usageMetadata) ? payload.usageMetadata : undefined;
    if (!metadata) return undefined;

    return {
      prompt_tokens: metadata.promptTokenCount,
      completion_tokens: metadata.candidatesTokenCount,
      total_tokens: metadata.totalTokenCount,
      cache_read_input_tokens: metadata.cachedContentTokenCount,
    };
  }

  private buildOpenAIUrl(upstreamUrl: string) {
    return `${upstreamUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  private buildAnthropicUrl(upstreamUrl: string) {
    return `${upstreamUrl.replace(/\/+$/, "")}/v1/messages`;
  }

  private buildGeminiUrl(upstreamUrl: string, model: string, apiKey: string) {
    const normalizedBaseUrl = upstreamUrl.replace(/\/+$/, "");
    const path = /\/v\d/.test(normalizedBaseUrl)
      ? `${normalizedBaseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent`
      : `${normalizedBaseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent`;
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}alt=sse&key=${encodeURIComponent(apiKey)}`;
  }

  async *streamChat(
    messages: ChatMessage[],
    model: string,
    apiKey: string,
    upstreamUrl: string,
    requestFormat?: RelayRequestFormat,
    signal?: AbortSignal,
    options?: ChatCompletionOptions,
  ): AsyncGenerator<StreamChunk> {
    const provider = this.resolveProvider(model, requestFormat);

    if (provider === "openai" || provider === "openai-chat-completions")
      yield* this.streamOpenAI(messages, model, apiKey, upstreamUrl, signal, options);
    else if (provider === "anthropic")
      yield* this.streamAnthropic(messages, model, apiKey, upstreamUrl, signal, options);
    else if (provider === "gemini") yield* this.streamGemini(messages, model, apiKey, upstreamUrl, signal, options);
    else throw new Error(`Provider ${provider} not yet implemented`);
  }

  private async *streamOpenAI(
    messages: ChatMessage[],
    model: string,
    apiKey: string,
    upstreamUrl: string,
    signal?: AbortSignal,
    options?: ChatCompletionOptions,
  ): AsyncGenerator<StreamChunk> {
    const url = this.buildOpenAIUrl(upstreamUrl);
    console.log("[AIProvider] Calling OpenAI API:", url, "model:", model);
    const startAt = Date.now();
    let response;
    try {
      response = await axios.post(
        url,
        {
          model,
          messages,
          stream: true,
          ...(options?.maxOutputTokens ? { max_tokens: options.maxOutputTokens } : {}),
          // Ask upstream to include usage in stream final chunk when supported.
          stream_options: { include_usage: true },
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, ...options?.requestHeaders },
          responseType: "stream",
          httpAgent,
          httpsAgent,
          signal,
        },
      );
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status !== 400 && status !== 422) throw error;

      console.warn("[AIProvider] stream_options not supported by upstream, retrying without it");
      response = await axios.post(
        url,
        {
          model,
          messages,
          stream: true,
          ...(options?.maxOutputTokens ? { max_tokens: options.maxOutputTokens } : {}),
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, ...options?.requestHeaders },
          responseType: "stream",
          httpAgent,
          httpsAgent,
          signal,
        },
      );
    }

    console.log("[AIProvider] Response received, starting to read stream");
    const estimatedRequestTokens = this.estimateInputTokens(messages);
    let tokenMetrics: TokenMetrics = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
    let assistantContentLength = 0;
    let firstContentAt: number | null = null;
    let buffer = "";
    const extractTextValue = (value: unknown) => this.extractTextValue(value);
    const extractResponseEventText = (event: unknown) => this.extractResponseEventText(event);
    const updateTokenMetrics = (usagePayload: unknown, metrics: TokenMetrics, fallbackInputTokens: number) =>
      this.updateTokenMetrics(usagePayload, metrics, fallbackInputTokens);

    const processDataLine = async function* (line: string): AsyncGenerator<StreamChunk> {
      if (!line.startsWith("data:")) return;

      const data = line.slice(5).trimStart();
      if (data === "[DONE]") {
        if (tokenMetrics.inputTokens === 0) tokenMetrics.inputTokens = estimatedRequestTokens;
        if (tokenMetrics.outputTokens === 0 && assistantContentLength > 0)
          tokenMetrics.outputTokens = Math.ceil(assistantContentLength / 4);

        const normalizedTokens = normalizeTokenBreakdown(
          tokenMetrics.inputTokens,
          tokenMetrics.outputTokens,
          tokenMetrics.inputTokens + tokenMetrics.outputTokens,
          estimatedRequestTokens,
        );
        tokenMetrics = {
          ...tokenMetrics,
          inputTokens: normalizedTokens.inputTokens,
          outputTokens: normalizedTokens.outputTokens,
        };

        const endAt = Date.now();
        console.log("[AIProvider] Stream done, tokens:", {
          inputTokens: tokenMetrics.inputTokens,
          outputTokens: tokenMetrics.outputTokens,
        });
        yield {
          done: true,
          inputTokens: tokenMetrics.inputTokens,
          outputTokens: tokenMetrics.outputTokens,
          cacheCreationTokens: tokenMetrics.cacheCreationTokens,
          cacheReadTokens: tokenMetrics.cacheReadTokens,
          totalOutputTime: Math.max(0, endAt - startAt),
          timeToFirstByte: Math.max(0, (firstContentAt || endAt) - startAt),
          isStreaming: true,
        };
        return;
      }

      try {
        const parsed = JSON.parse(data);
        const completionDeltaText = extractTextValue(parsed?.choices?.[0]?.delta?.content);
        const isResponsesCompletion = parsed?.type === "response.completed";
        const responsesEventText =
          isResponsesCompletion && assistantContentLength > 0 ? "" : extractResponseEventText(parsed);
        const content = completionDeltaText || responsesEventText;

        if (content.length > 0) {
          if (!firstContentAt) firstContentAt = Date.now();
          assistantContentLength += content.length;
          console.log("[AIProvider] Yielding content:", content);
          yield { content, done: false };
        }

        if (parsed.usage)
          tokenMetrics = updateTokenMetrics(
            parsed.usage,
            tokenMetrics,
            tokenMetrics.inputTokens > 0 ? tokenMetrics.inputTokens : estimatedRequestTokens,
          );

        if (parsed.type === "response.completed" && parsed.response?.usage)
          tokenMetrics = updateTokenMetrics(
            parsed.response.usage,
            tokenMetrics,
            tokenMetrics.inputTokens > 0 ? tokenMetrics.inputTokens : estimatedRequestTokens,
          );
      } catch (e) {
        console.error("[AIProvider] Parse error:", e);
      }
    };

    for await (const chunk of response.data) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        for await (const out of processDataLine(line)) {
          yield out;
          if (out.done) return;
        }
      }
    }

    const trailingLine = buffer.trim();
    if (trailingLine)
      for await (const out of processDataLine(trailingLine)) {
        yield out;
        if (out.done) return;
      }

    console.log("[AIProvider] Stream ended");
    if (tokenMetrics.inputTokens === 0) tokenMetrics.inputTokens = estimatedRequestTokens;
    if (tokenMetrics.outputTokens === 0 && assistantContentLength > 0)
      tokenMetrics.outputTokens = Math.ceil(assistantContentLength / 4);
    const normalizedTokens = normalizeTokenBreakdown(
      tokenMetrics.inputTokens,
      tokenMetrics.outputTokens,
      tokenMetrics.inputTokens + tokenMetrics.outputTokens,
      estimatedRequestTokens,
    );
    tokenMetrics = {
      ...tokenMetrics,
      inputTokens: normalizedTokens.inputTokens,
      outputTokens: normalizedTokens.outputTokens,
    };
    const endAt = Date.now();
    yield {
      done: true,
      inputTokens: tokenMetrics.inputTokens,
      outputTokens: tokenMetrics.outputTokens,
      cacheCreationTokens: tokenMetrics.cacheCreationTokens,
      cacheReadTokens: tokenMetrics.cacheReadTokens,
      totalOutputTime: Math.max(0, endAt - startAt),
      timeToFirstByte: Math.max(0, (firstContentAt || endAt) - startAt),
      isStreaming: true,
    };
  }

  private async *streamAnthropic(
    messages: ChatMessage[],
    model: string,
    apiKey: string,
    upstreamUrl: string,
    signal?: AbortSignal,
    options?: ChatCompletionOptions,
  ): AsyncGenerator<StreamChunk> {
    const url = this.buildAnthropicUrl(upstreamUrl);
    const startAt = Date.now();
    const estimatedRequestTokens = this.estimateInputTokens(messages);
    let tokenMetrics: TokenMetrics = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
    let assistantContentLength = 0;
    let firstContentAt: number | null = null;
    let buffer = "";
    const extractAnthropicTextDelta = (payload: unknown) => this.extractAnthropicTextDelta(payload);
    const isRecord = (value: unknown): value is Record<string, unknown> => this.isRecord(value);
    const updateTokenMetrics = (usagePayload: unknown, metrics: TokenMetrics, fallbackInputTokens: number) =>
      this.updateTokenMetrics(usagePayload, metrics, fallbackInputTokens);

    const response = await axios.post(
      url,
      {
        model,
        max_tokens: options?.maxOutputTokens ?? 4096,
        stream: true,
        messages: this.toAnthropicMessages(messages),
      },
      {
        headers: {
          "content-type": "application/json",
          "anthropic-version": this.anthropicVersion,
          Authorization: `Bearer ${apiKey}`,
          "x-api-key": apiKey,
        },
        responseType: "stream",
        httpAgent,
        httpsAgent,
        signal,
      },
    );

    const finalizeDoneChunk = (): StreamChunk => {
      if (tokenMetrics.inputTokens === 0) tokenMetrics.inputTokens = estimatedRequestTokens;
      if (tokenMetrics.outputTokens === 0 && assistantContentLength > 0)
        tokenMetrics.outputTokens = Math.ceil(assistantContentLength / 4);

      const normalizedTokens = normalizeTokenBreakdown(
        tokenMetrics.inputTokens,
        tokenMetrics.outputTokens,
        tokenMetrics.inputTokens + tokenMetrics.outputTokens,
        estimatedRequestTokens,
      );

      const endAt = Date.now();
      return {
        done: true,
        inputTokens: normalizedTokens.inputTokens,
        outputTokens: normalizedTokens.outputTokens,
        cacheCreationTokens: tokenMetrics.cacheCreationTokens,
        cacheReadTokens: tokenMetrics.cacheReadTokens,
        totalOutputTime: Math.max(0, endAt - startAt),
        timeToFirstByte: Math.max(0, (firstContentAt || endAt) - startAt),
        isStreaming: true,
      };
    };

    const processDataLine = async function* (line: string): AsyncGenerator<StreamChunk> {
      if (!line.startsWith("data:")) return;

      const data = line.slice(5).trimStart();
      if (!data || data === "[DONE]") {
        yield finalizeDoneChunk();
        return;
      }

      try {
        const parsed = JSON.parse(data);
        const content = extractAnthropicTextDelta(parsed);
        if (content.length > 0) {
          if (!firstContentAt) firstContentAt = Date.now();
          assistantContentLength += content.length;
          yield { content, done: false };
        }

        const usagePayload = isRecord(parsed) && isRecord(parsed.message) ? parsed.message.usage : parsed.usage;
        if (usagePayload)
          tokenMetrics = updateTokenMetrics(
            usagePayload,
            tokenMetrics,
            tokenMetrics.inputTokens > 0 ? tokenMetrics.inputTokens : estimatedRequestTokens,
          );

        const payloadType = isRecord(parsed) && typeof parsed.type === "string" ? parsed.type : "";
        if (payloadType === "message_stop") yield finalizeDoneChunk();
      } catch (error) {
        console.error("[AIProvider] Anthropic parse error:", error);
      }
    };

    for await (const chunk of response.data) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        for await (const out of processDataLine(line)) {
          yield out;
          if (out.done) return;
        }
      }
    }

    const trailingLine = buffer.trim();
    if (trailingLine)
      for await (const out of processDataLine(trailingLine)) {
        yield out;
        if (out.done) return;
      }

    yield finalizeDoneChunk();
  }

  private async *streamGemini(
    messages: ChatMessage[],
    model: string,
    apiKey: string,
    upstreamUrl: string,
    signal?: AbortSignal,
    options?: ChatCompletionOptions,
  ): AsyncGenerator<StreamChunk> {
    const url = this.buildGeminiUrl(upstreamUrl, model, apiKey);
    const startAt = Date.now();
    const estimatedRequestTokens = this.estimateInputTokens(messages);
    let tokenMetrics: TokenMetrics = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
    let assistantContentLength = 0;
    let firstContentAt: number | null = null;
    let buffer = "";
    const extractGeminiTextDelta = (payload: unknown) => this.extractGeminiTextDelta(payload);
    const extractGeminiUsage = (payload: unknown) => this.extractGeminiUsage(payload);
    const updateTokenMetrics = (usagePayload: unknown, metrics: TokenMetrics, fallbackInputTokens: number) =>
      this.updateTokenMetrics(usagePayload, metrics, fallbackInputTokens);

    const response = await axios.post(
      url,
      {
        ...this.toGeminiRequest(messages),
        ...(options?.maxOutputTokens ? { generationConfig: { maxOutputTokens: options.maxOutputTokens } } : {}),
      },
      {
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        responseType: "stream",
        httpAgent,
        httpsAgent,
        signal,
      },
    );

    const finalizeDoneChunk = (): StreamChunk => {
      if (tokenMetrics.inputTokens === 0) tokenMetrics.inputTokens = estimatedRequestTokens;
      if (tokenMetrics.outputTokens === 0 && assistantContentLength > 0)
        tokenMetrics.outputTokens = Math.ceil(assistantContentLength / 4);

      const normalizedTokens = normalizeTokenBreakdown(
        tokenMetrics.inputTokens,
        tokenMetrics.outputTokens,
        tokenMetrics.inputTokens + tokenMetrics.outputTokens,
        estimatedRequestTokens,
      );
      const endAt = Date.now();
      return {
        done: true,
        inputTokens: normalizedTokens.inputTokens,
        outputTokens: normalizedTokens.outputTokens,
        cacheCreationTokens: tokenMetrics.cacheCreationTokens,
        cacheReadTokens: tokenMetrics.cacheReadTokens,
        totalOutputTime: Math.max(0, endAt - startAt),
        timeToFirstByte: Math.max(0, (firstContentAt || endAt) - startAt),
        isStreaming: true,
      };
    };

    const processDataLine = async function* (line: string): AsyncGenerator<StreamChunk> {
      if (!line.startsWith("data:")) return;

      const data = line.slice(5).trimStart();
      if (!data || data === "[DONE]") {
        yield finalizeDoneChunk();
        return;
      }

      try {
        const parsed = JSON.parse(data);
        const content = extractGeminiTextDelta(parsed);
        if (content.length > 0) {
          if (!firstContentAt) firstContentAt = Date.now();
          assistantContentLength += content.length;
          yield { content, done: false };
        }

        const usagePayload = extractGeminiUsage(parsed);
        if (usagePayload)
          tokenMetrics = updateTokenMetrics(
            usagePayload,
            tokenMetrics,
            tokenMetrics.inputTokens > 0 ? tokenMetrics.inputTokens : estimatedRequestTokens,
          );
      } catch (error) {
        console.error("[AIProvider] Gemini parse error:", error);
      }
    };

    for await (const chunk of response.data) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        for await (const out of processDataLine(line)) yield out;
      }
    }

    const trailingLine = buffer.trim();
    if (trailingLine) for await (const out of processDataLine(trailingLine)) yield out;

    yield finalizeDoneChunk();
  }
}
