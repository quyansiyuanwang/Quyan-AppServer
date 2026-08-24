import type { RelayConvertibleRequestFormat, RelayRequestFormatTransform } from "@appserver/shared";
import { Transform } from "stream";

type JsonObject = Record<string, any>;

export class RelayFormatTransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayFormatTransformError";
  }
}

export const resolveRelayRequestFormatTransform = (
  rules: unknown,
  sourceFormat: RelayConvertibleRequestFormat,
): RelayRequestFormatTransform | undefined => {
  if (!Array.isArray(rules)) return undefined;
  return rules.find(
    (rule): rule is RelayRequestFormatTransform =>
      rule && typeof rule === "object" && rule.sourceFormat === sourceFormat && rule.targetFormat !== sourceFormat,
  );
};

const unsupported = (body: JsonObject, fields: string[]) => {
  const present = fields.filter((field) => body[field] !== undefined && body[field] !== null);
  if (present.length)
    throw new RelayFormatTransformError(`Unsupported for request format conversion: ${present.join(", ")}`);
};

const text = (content: any): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" || part?.type === "input_text" || part?.type === "output_text")
    .map((part) => String(part.text || ""))
    .join("");
};

const chatContentFromAnthropic = (content: any): any => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part?.type === "text") return { type: "text", text: part.text || "" };
      if (part?.type === "image") {
        const source = part.source || {};
        const url =
          source.type === "url" ? source.url : `data:${source.media_type || "image/png"};base64,${source.data || ""}`;
        if (!url || url.endsWith(",")) throw new RelayFormatTransformError("Anthropic image source is invalid");
        return { type: "image_url", image_url: { url } };
      }
      if (part?.type === "tool_use" || part?.type === "tool_result") return null;
      throw new RelayFormatTransformError(`Unsupported Anthropic content block: ${String(part?.type || "unknown")}`);
    })
    .filter(Boolean);
};

const anthropicContentFromChat = (content: any): any => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (part?.type === "text") return { type: "text", text: part.text || "" };
    if (part?.type === "image_url") {
      const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      if (typeof url !== "string" || !url) throw new RelayFormatTransformError("OpenAI image URL is invalid");
      const dataMatch = url.match(/^data:([^;]+);base64,(.+)$/);
      if (dataMatch) return { type: "image", source: { type: "base64", media_type: dataMatch[1], data: dataMatch[2] } };
      return { type: "image", source: { type: "url", url } };
    }
    throw new RelayFormatTransformError(`Unsupported OpenAI content part: ${String(part?.type || "unknown")}`);
  });
};

const anthropicToChat = (body: JsonObject): JsonObject => {
  unsupported(body, ["metadata", "container", "context_management", "mcp_servers"]);
  const messages: any[] = [];
  if (body.system) messages.push({ role: "system", content: text(body.system) });
  for (const message of body.messages || []) {
    const content = message.content;
    const toolUses = Array.isArray(content) ? content.filter((part) => part?.type === "tool_use") : [];
    const toolResults = Array.isArray(content) ? content.filter((part) => part?.type === "tool_result") : [];
    const converted = chatContentFromAnthropic(content);
    if (message.role === "assistant" && toolUses.length)
      messages.push({
        role: "assistant",
        content: converted.length ? converted : null,
        ...(message.reasoning_content !== undefined ? { reasoning_content: message.reasoning_content } : {}),
        tool_calls: toolUses.map((part: any) => ({
          id: part.id,
          type: "function",
          function: { name: part.name, arguments: JSON.stringify(part.input || {}) },
        })),
      });
    else if (message.role === "user" && toolResults.length) {
      if (converted.length) messages.push({ role: "user", content: converted });
      messages.push(
        ...toolResults.map((part: any) => ({
          role: "tool",
          tool_call_id: part.tool_use_id,
          content: text(part.content),
        })),
      );
    } else
      messages.push({
        role: message.role === "assistant" ? "assistant" : "user",
        content: converted,
        ...(message.role === "assistant" && message.reasoning_content !== undefined
          ? { reasoning_content: message.reasoning_content }
          : {}),
      });
  }
  const result: JsonObject = { model: body.model, messages, max_tokens: body.max_tokens };
  for (const [from, to] of [
    ["temperature", "temperature"],
    ["top_p", "top_p"],
    ["stop_sequences", "stop"],
    ["stream", "stream"],
  ])
    if (body[from] !== undefined) result[to] = body[from];
  if (Array.isArray(body.tools))
    result.tools = body.tools.map((tool: any) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.input_schema || {} },
    }));
  if (body.tool_choice)
    result.tool_choice =
      body.tool_choice.type === "tool"
        ? { type: "function", function: { name: body.tool_choice.name } }
        : body.tool_choice.type;
  return result;
};

const chatToAnthropic = (body: JsonObject): JsonObject => {
  unsupported(body, ["response_format", "logprobs", "logit_bias", "audio", "modalities", "prediction", "service_tier"]);
  const maxTokens = body.max_tokens ?? body.max_completion_tokens;
  if (!Number.isFinite(Number(maxTokens)) || Number(maxTokens) <= 0)
    throw new RelayFormatTransformError("max_tokens or max_completion_tokens is required when converting to Anthropic");
  const system: string[] = [];
  const messages: any[] = [];
  for (const message of body.messages || []) {
    if (message.role === "system" || message.role === "developer") {
      system.push(text(message.content));
      continue;
    }
    if (message.role === "tool") {
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: message.tool_call_id, content: text(message.content) }],
      });
      continue;
    }
    const content = anthropicContentFromChat(message.content);
    if (message.role === "assistant" && Array.isArray(message.tool_calls))
      content.push(
        ...message.tool_calls.map((call: any) => ({
          type: "tool_use",
          id: call.id,
          name: call.function?.name,
          input: JSON.parse(call.function?.arguments || "{}"),
        })),
      );
    messages.push({ role: message.role === "assistant" ? "assistant" : "user", content });
  }
  const result: JsonObject = { model: body.model, max_tokens: Number(maxTokens), messages };
  if (system.length) result.system = system.join("\n");
  for (const [from, to] of [
    ["temperature", "temperature"],
    ["top_p", "top_p"],
    ["stop", "stop_sequences"],
    ["stream", "stream"],
  ])
    if (body[from] !== undefined) result[to] = body[from];
  if (Array.isArray(body.tools))
    result.tools = body.tools.map((tool: any) => ({
      name: tool.function?.name,
      description: tool.function?.description,
      input_schema: tool.function?.parameters || {},
    }));
  return result;
};

const chatToResponses = (body: JsonObject): JsonObject => {
  unsupported(body, ["response_format", "logprobs", "logit_bias", "audio", "modalities", "prediction"]);
  const instructions: string[] = [];
  const input: any[] = [];
  for (const message of body.messages || []) {
    if (message.role === "system" || message.role === "developer") {
      instructions.push(text(message.content));
      continue;
    }
    if (message.role === "tool") {
      input.push({ type: "function_call_output", call_id: message.tool_call_id, output: text(message.content) });
      continue;
    }
    input.push({
      role: message.role === "assistant" ? "assistant" : "user",
      ...(message.role === "assistant" && message.reasoning_content !== undefined
        ? { reasoning_content: message.reasoning_content }
        : {}),
      content: Array.isArray(message.content)
        ? message.content.map((part: any) =>
            part.type === "image_url"
              ? {
                  type: "input_image",
                  image_url: typeof part.image_url === "string" ? part.image_url : part.image_url?.url,
                }
              : { type: message.role === "assistant" ? "output_text" : "input_text", text: part.text || "" },
          )
        : [{ type: message.role === "assistant" ? "output_text" : "input_text", text: String(message.content || "") }],
    });
    if (message.role === "assistant")
      for (const call of message.tool_calls || [])
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.function?.name,
          arguments: call.function?.arguments || "{}",
        });
  }
  const result: JsonObject = { model: body.model, input };
  if (instructions.length) result.instructions = instructions.join("\n");
  if (body.max_completion_tokens ?? body.max_tokens)
    result.max_output_tokens = body.max_completion_tokens ?? body.max_tokens;
  for (const key of ["temperature", "top_p", "stream", "stop", "user"])
    if (body[key] !== undefined) result[key] = body[key];
  if (Array.isArray(body.tools))
    result.tools = body.tools.map((tool: any) => ({
      type: "function",
      name: tool.function?.name,
      description: tool.function?.description,
      parameters: tool.function?.parameters || {},
    }));
  return result;
};

const responsesToChat = (body: JsonObject): JsonObject => {
  unsupported(body, [
    "previous_response_id",
    "conversation",
    "background",
    "store",
    "include",
    "reasoning",
    "text",
    "truncation",
  ]);
  const messages: any[] = [];
  if (body.instructions) messages.push({ role: "system", content: String(body.instructions) });
  const input =
    typeof body.input === "string"
      ? [{ role: "user", content: [{ type: "input_text", text: body.input }] }]
      : body.input || [];
  for (const item of input) {
    if (item.type === "function_call_output") {
      messages.push({ role: "tool", tool_call_id: item.call_id, content: text(item.output) });
      continue;
    }
    if (item.type === "function_call") {
      messages.push({
        role: "assistant",
        content: null,
        ...(item.reasoning_content !== undefined ? { reasoning_content: item.reasoning_content } : {}),
        tool_calls: [
          { id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments || "{}" } },
        ],
      });
      continue;
    }
    const parts = Array.isArray(item.content) ? item.content : [{ type: "input_text", text: item.content || "" }];
    messages.push({
      role: item.role === "assistant" ? "assistant" : "user",
      content: parts.map((part: any) => {
        if (part.type === "input_image") return { type: "image_url", image_url: { url: part.image_url } };
        if (["input_text", "output_text", "text"].includes(part.type)) return { type: "text", text: part.text || "" };
        throw new RelayFormatTransformError(`Unsupported Responses input item: ${String(part.type)}`);
      }),
      ...(item.role === "assistant" && item.reasoning_content !== undefined
        ? { reasoning_content: item.reasoning_content }
        : {}),
    });
  }
  const result: JsonObject = { model: body.model, messages };
  if (body.max_output_tokens) result.max_tokens = body.max_output_tokens;
  for (const key of ["temperature", "top_p", "stream", "stop", "user"])
    if (body[key] !== undefined) result[key] = body[key];
  if (Array.isArray(body.tools))
    result.tools = body.tools
      .filter((tool: any) => tool.type === "function")
      .map((tool: any) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.parameters || {} },
      }));
  return result;
};

export const convertRelayRequest = (
  body: JsonObject,
  source: RelayConvertibleRequestFormat,
  target: RelayConvertibleRequestFormat,
): JsonObject => {
  if (source === target) return body;
  if (source === "anthropic")
    return target === "openai-chat-completions" ? anthropicToChat(body) : chatToResponses(anthropicToChat(body));
  if (source === "openai-chat-completions")
    return target === "anthropic" ? chatToAnthropic(body) : chatToResponses(body);
  const chat = responsesToChat(body);
  return target === "anthropic" ? chatToAnthropic(chat) : chat;
};

const chatResponseFromAnthropic = (data: JsonObject): JsonObject => ({
  id: data.id || "relay-converted",
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model: data.model,
  choices: [
    {
      index: 0,
      finish_reason: data.stop_reason || "stop",
      message: {
        role: "assistant",
        content:
          (data.content || [])
            .filter((part: any) => part.type === "text")
            .map((part: any) => part.text)
            .join("") || null,
        tool_calls: (data.content || [])
          .filter((part: any) => part.type === "tool_use")
          .map((part: any) => ({
            id: part.id,
            type: "function",
            function: { name: part.name, arguments: JSON.stringify(part.input || {}) },
          })),
      },
    },
  ],
  usage: data.usage
    ? {
        prompt_tokens: data.usage.input_tokens || 0,
        completion_tokens: data.usage.output_tokens || 0,
        total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
      }
    : undefined,
});

const anthropicResponseFromChat = (data: JsonObject): JsonObject => {
  const message = data.choices?.[0]?.message || {};
  const content = [] as any[];
  if (message.content) content.push({ type: "text", text: text(message.content) });
  for (const call of message.tool_calls || [])
    content.push({
      type: "tool_use",
      id: call.id,
      name: call.function?.name,
      input: JSON.parse(call.function?.arguments || "{}"),
    });
  return {
    id: data.id || "relay-converted",
    type: "message",
    role: "assistant",
    model: data.model,
    content,
    stop_reason: data.choices?.[0]?.finish_reason || "end_turn",
    usage: data.usage
      ? { input_tokens: data.usage.prompt_tokens || 0, output_tokens: data.usage.completion_tokens || 0 }
      : undefined,
  };
};

const responsesResponseFromChat = (data: JsonObject): JsonObject => {
  const message = data.choices?.[0]?.message || {};
  return {
    id: data.id || "relay-converted",
    object: "response",
    status: "completed",
    model: data.model,
    output: [
      {
        type: "message",
        id: "msg_relay_converted",
        role: "assistant",
        content: [{ type: "output_text", text: text(message.content) }],
      },
    ],
    usage: data.usage
      ? {
          input_tokens: data.usage.prompt_tokens || 0,
          output_tokens: data.usage.completion_tokens || 0,
          total_tokens: data.usage.total_tokens || 0,
        }
      : undefined,
  };
};

export const convertRelayResponse = (
  data: JsonObject,
  source: RelayConvertibleRequestFormat,
  target: RelayConvertibleRequestFormat,
): JsonObject => {
  if (source === target) return data;
  const chat =
    source === "openai-chat-completions"
      ? data
      : source === "anthropic"
        ? chatResponseFromAnthropic(data)
        : {
            id: data.id,
            model: data.model,
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content: text(data.output?.[0]?.content) },
              },
            ],
            usage: data.usage && {
              prompt_tokens: data.usage.input_tokens,
              completion_tokens: data.usage.output_tokens,
              total_tokens: data.usage.total_tokens,
            },
          };
  return target === "openai-chat-completions"
    ? chat
    : target === "anthropic"
      ? anthropicResponseFromChat(chat)
      : responsesResponseFromChat(chat);
};

export const convertRelayError = (data: any, target: RelayConvertibleRequestFormat): JsonObject => {
  const message = data?.error?.message || data?.message || "Upstream request failed";
  if (target === "anthropic") return { type: "error", error: { type: "api_error", message } };
  return { error: { message, type: data?.error?.type || "upstream_error", code: data?.error?.code } };
};

/** Bounded incremental SSE parser. It never buffers more than one event. */
export class RelaySseFormatTransform extends Transform {
  private pending = "";
  private readonly decoder = new TextDecoder();

  constructor(
    private readonly source: RelayConvertibleRequestFormat,
    private readonly target: RelayConvertibleRequestFormat,
  ) {
    super();
  }

  _transform(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void) {
    try {
      this.pending += this.decoder.decode(chunk, { stream: true });
      if (this.pending.length > 128 * 1024) throw new RelayFormatTransformError("Upstream SSE event exceeds 128KB");
      const events = this.pending.split(/\r?\n\r?\n/);
      this.pending = events.pop() || "";
      for (const event of events) this.push(this.convertEvent(event));
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  _flush(callback: (error?: Error | null) => void) {
    try {
      if (this.pending) this.push(this.convertEvent(this.pending));
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private convertEvent(event: string): string {
    const dataLine = event.split(/\r?\n/).find((line) => line.startsWith("data:"));
    if (!dataLine) return `${event}\n\n`;
    const raw = dataLine.slice(5).trim();
    if (!raw || raw === "[DONE]") return "data: [DONE]\n\n";
    const value = JSON.parse(raw);
    if (this.source === "openai-chat-completions" && this.target === "anthropic") {
      const delta = value.choices?.[0]?.delta || {};
      return `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta.content || "" } })}\n\n`;
    }
    if (this.source === "anthropic" && this.target === "openai-chat-completions") {
      const delta = value.delta?.text || "";
      return `data: ${JSON.stringify({ id: value.message?.id || "relay-converted", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: delta }, finish_reason: value.type === "message_stop" ? "stop" : null }] })}\n\n`;
    }
    return `data: ${JSON.stringify(value)}\n\n`;
  }
}
