import type { RelayConvertibleRequestFormat, RelayRequestFormatTransform } from "@quyan/shared";
import { Transform } from "stream";

type JsonObject = Record<string, any>;
const SSE_CONVERSION_LIMITS = { eventChars: 1024 * 1024, retainedChars: 128 * 1024, blocks: 128 } as const;

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
      if (this.pending.length > SSE_CONVERSION_LIMITS.eventChars)
        throw new RelayFormatTransformError("Upstream SSE event exceeds conversion limit");
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

  private started = false;
  private finished = false;
  private id = "relay-converted";
  private model = "";
  private inputTokens = 0;
  private outputTokens = 0;
  private finishReason = "stop";
  private outputText = "";
  private textIndex: number | undefined;
  private nextIndex = 0;
  private sequence = 0;
  private bufferedChars = 0;
  private readonly tools = new Map<number, { index: number; id: string; name: string; args: string }>();
  private readonly sourceTools = new Map<number, { id: string; name: string }>();

  private frame(type: string, data: JsonObject): string {
    if (this.target === "openai-responses") data = { ...data, sequence_number: this.sequence++ };
    return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  }
  private chat(delta: JsonObject, finish: string | null = null, usage?: JsonObject): string {
    return `data: ${JSON.stringify({
      id: this.id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(usage ? { usage } : {}),
    })}\n\n`;
  }
  private response(status: string, output: JsonObject[] = []): JsonObject {
    return {
      id: this.id,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      model: this.model,
      status,
      output,
      error: null,
      incomplete_details: status === "incomplete" ? { reason: "max_output_tokens" } : null,
      usage: {
        input_tokens: this.inputTokens,
        output_tokens: this.outputTokens,
        total_tokens: this.inputTokens + this.outputTokens,
      },
    };
  }
  private start(): string {
    if (this.started) return "";
    this.started = true;
    if (this.target === "anthropic")
      return this.frame("message_start", {
        message: {
          id: this.id,
          type: "message",
          role: "assistant",
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: this.inputTokens, output_tokens: 0 },
        },
      });
    if (this.target === "openai-responses")
      return this.frame("response.created", { response: this.response("in_progress") });
    return this.chat({ role: "assistant", content: "" });
  }
  private retain(fragment: string): void {
    this.bufferedChars += fragment.length;
    if (this.bufferedChars > SSE_CONVERSION_LIMITS.retainedChars)
      throw new RelayFormatTransformError("Converted stream output exceeds retention limit");
  }
  private textDelta(fragment: string): string {
    if (!fragment) return "";
    this.retain(fragment);
    this.outputText += fragment;
    if (this.target === "openai-chat-completions") return this.chat({ content: fragment });
    let output = "";
    if (this.textIndex === undefined) {
      this.textIndex = this.nextIndex++;
      if (this.target === "anthropic")
        output += this.frame("content_block_start", {
          index: this.textIndex,
          content_block: { type: "text", text: "" },
        });
      else {
        output += this.frame("response.output_item.added", {
          output_index: this.textIndex,
          item: { id: `${this.id}_message`, type: "message", role: "assistant", status: "in_progress", content: [] },
        });
        output += this.frame("response.content_part.added", {
          output_index: this.textIndex,
          item_id: `${this.id}_message`,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        });
      }
    }
    return (
      output +
      (this.target === "anthropic"
        ? this.frame("content_block_delta", { index: this.textIndex, delta: { type: "text_delta", text: fragment } })
        : this.frame("response.output_text.delta", {
            output_index: this.textIndex,
            item_id: `${this.id}_message`,
            content_index: 0,
            delta: fragment,
          }))
    );
  }
  private toolDelta(sourceIndex: number, id: string | undefined, name: string | undefined, fragment = ""): string {
    let tool = this.tools.get(sourceIndex);
    let output = "";
    if (!tool) {
      if (!id || !name) throw new RelayFormatTransformError("Stream tool metadata is missing");
      if (this.tools.size >= SSE_CONVERSION_LIMITS.blocks)
        throw new RelayFormatTransformError("Stream tool count exceeds conversion limit");
      this.retain(id + name);
      tool = { index: this.nextIndex++, id, name, args: "" };
      this.tools.set(sourceIndex, tool);
      if (this.target === "anthropic")
        output += this.frame("content_block_start", {
          index: tool.index,
          content_block: { type: "tool_use", id, name, input: {} },
        });
      else if (this.target === "openai-responses")
        output += this.frame("response.output_item.added", {
          output_index: tool.index,
          item: {
            id: `${this.id}_tool_${tool.index}`,
            type: "function_call",
            call_id: id,
            name,
            arguments: "",
            status: "in_progress",
          },
        });
      else
        output += this.chat({
          tool_calls: [{ index: sourceIndex, id, type: "function", function: { name, arguments: "" } }],
        });
    }
    this.retain(fragment);
    tool.args += fragment;
    if (!fragment) return output;
    if (this.target === "anthropic")
      return (
        output +
        this.frame("content_block_delta", {
          index: tool.index,
          delta: { type: "input_json_delta", partial_json: fragment },
        })
      );
    if (this.target === "openai-responses")
      return (
        output +
        this.frame("response.function_call_arguments.delta", {
          output_index: tool.index,
          item_id: `${this.id}_tool_${tool.index}`,
          delta: fragment,
        })
      );
    return output + this.chat({ tool_calls: [{ index: sourceIndex, function: { arguments: fragment } }] });
  }
  private finish(): string {
    if (this.finished) return "";
    this.finished = true;
    let output = this.start();
    if (this.target === "openai-chat-completions")
      return (
        output +
        this.chat({}, this.tools.size ? "tool_calls" : this.finishReason, {
          prompt_tokens: this.inputTokens,
          completion_tokens: this.outputTokens,
          total_tokens: this.inputTokens + this.outputTokens,
        }) +
        "data: [DONE]\n\n"
      );
    if (this.target === "anthropic") {
      for (let index = 0; index < this.nextIndex; index++) output += this.frame("content_block_stop", { index });
      return (
        output +
        this.frame("message_delta", {
          delta: {
            stop_reason: this.finishReason === "length" ? "max_tokens" : this.tools.size ? "tool_use" : "end_turn",
            stop_sequence: null,
          },
          usage: { input_tokens: this.inputTokens, output_tokens: this.outputTokens },
        }) +
        this.frame("message_stop", {})
      );
    }
    const items: Array<{ index: number; item: JsonObject }> = [];
    if (this.textIndex !== undefined) {
      const part = { type: "output_text", text: this.outputText, annotations: [] };
      const item = {
        id: `${this.id}_message`,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [part],
      };
      output += this.frame("response.output_text.done", {
        output_index: this.textIndex,
        item_id: item.id,
        content_index: 0,
        text: this.outputText,
      });
      output += this.frame("response.content_part.done", {
        output_index: this.textIndex,
        item_id: item.id,
        content_index: 0,
        part,
      });
      items.push({ index: this.textIndex, item });
    }
    for (const tool of this.tools.values()) {
      const item = {
        id: `${this.id}_tool_${tool.index}`,
        type: "function_call",
        call_id: tool.id,
        name: tool.name,
        arguments: tool.args,
        status: "completed",
      };
      output += this.frame("response.function_call_arguments.done", {
        output_index: tool.index,
        item_id: item.id,
        arguments: tool.args,
      });
      items.push({ index: tool.index, item });
    }
    items.sort((a, b) => a.index - b.index);
    for (const { index, item } of items)
      output += this.frame("response.output_item.done", { output_index: index, item });
    return (
      output +
      this.frame(this.finishReason === "length" ? "response.incomplete" : "response.completed", {
        response: this.response(
          this.finishReason === "length" ? "incomplete" : "completed",
          items.map((item) => item.item),
        ),
      })
    );
  }
  private convertEvent(event: string): string {
    if (this.source === this.target) return `${event}\n\n`;
    const raw = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!raw) return "";
    if (raw === "[DONE]") return this.finish();
    const value = JSON.parse(raw);
    if (value.error || value.type === "error" || value.type === "response.failed") {
      this.finished = true;
      const error = convertRelayError(value.error ? value : (value.response ?? value), this.target);
      return this.target === "anthropic"
        ? this.frame("error", error)
        : this.target === "openai-responses"
          ? this.frame("response.failed", { response: { ...this.response("failed"), error: error.error } })
          : `data: ${JSON.stringify(error)}\n\n`;
    }
    const info = value.message ?? value.response ?? value;
    if (!this.started) {
      this.id = info.id ?? this.id;
      this.model = info.model ?? this.model;
    }
    const usage = value.usage ?? info.usage;
    if (usage) {
      this.inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? this.inputTokens;
      this.outputTokens = usage.completion_tokens ?? usage.output_tokens ?? this.outputTokens;
    }
    if (this.source === "openai-chat-completions") {
      const choice = value.choices?.[0];
      if (choice?.finish_reason) this.finishReason = choice.finish_reason;
      let output = this.start() + this.textDelta(choice?.delta?.content ?? "");
      for (const call of choice?.delta?.tool_calls ?? [])
        output += this.toolDelta(call.index ?? 0, call.id, call.function?.name, call.function?.arguments ?? "");
      return output;
    }
    if (this.source === "anthropic") {
      const type =
        value.type ??
        event
          .split(/\r?\n/)
          .find((line) => line.startsWith("event:"))
          ?.slice(6)
          .trim();
      if (type === "message_stop") return this.finish();
      if (type === "message_delta") {
        this.finishReason =
          value.delta?.stop_reason === "max_tokens"
            ? "length"
            : value.delta?.stop_reason === "tool_use"
              ? "tool_calls"
              : "stop";
        return "";
      }
      let output = this.start();
      if (type === "content_block_start" && value.content_block?.type === "tool_use") {
        const block = value.content_block;
        this.sourceTools.set(value.index, { id: block.id, name: block.name });
        return (
          output +
          this.toolDelta(
            value.index,
            block.id,
            block.name,
            Object.keys(block.input ?? {}).length ? JSON.stringify(block.input) : "",
          )
        );
      }
      if (type === "content_block_delta") {
        if (value.delta?.partial_json !== undefined) {
          const tool = this.sourceTools.get(value.index);
          return output + this.toolDelta(value.index, tool?.id, tool?.name, value.delta.partial_json);
        }
        return output + this.textDelta(value.delta?.text ?? "");
      }
      return output;
    }
    if (value.type === "response.completed" || value.type === "response.incomplete") {
      this.finishReason = value.type === "response.incomplete" ? "length" : "stop";
      return this.finish();
    }
    let output = this.start();
    if (value.type === "response.output_text.delta") return output + this.textDelta(value.delta ?? "");
    if (value.type === "response.output_item.added" && value.item?.type === "function_call") {
      this.sourceTools.set(value.output_index, { id: value.item.call_id, name: value.item.name });
      return (
        output + this.toolDelta(value.output_index, value.item.call_id, value.item.name, value.item.arguments ?? "")
      );
    }
    if (value.type === "response.function_call_arguments.delta") {
      const tool = this.sourceTools.get(value.output_index);
      return output + this.toolDelta(value.output_index, tool?.id, tool?.name, value.delta ?? "");
    }
    return output;
  }
}
