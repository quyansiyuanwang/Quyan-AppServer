/**
 * AnthropicUpstreamClient
 *
 * 统一封装"调用 Anthropic 上游（或兼容代理）"的方式：
 *   - 支持从 Relay 渠道读取配置（优先）
 *   - 回退到环境变量配置
 *   - 同时发送 Authorization: Bearer <key> 和 x-api-key: <key>
 */

import axios from "axios";
import { BadRequestError } from "@/util/errors";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface AnthropicMessagesResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text?: string }>;
  model: string;
  stop_reason: string;
  usage: AnthropicUsage;
}

export class AnthropicUpstreamClient {
  private channelName?: string;
  private relayChannelRepository = RelayChannelRepository.getInstance();

  /**
   * 构造函数
   * @param channelName 可选的渠道名称，如果提供则从该渠道读取配置
   */
  constructor(channelName?: string) {
    this.channelName = channelName;
  }

  /**
   * 获取上游配置
   * 优先从指定渠道读取，否则从环境变量读取
   */
  private async buildConfig(): Promise<{ messagesUrl: string; headers: Record<string, string> }> {
    let apiKey = "";
    let baseUrl = "";

    // 如果指定了渠道名称，从数据库读取
    if (this.channelName) {
      const channel = await this.relayChannelRepository.findActiveByName(this.channelName);

      if (channel) {
        baseUrl = (channel.anthropicUpstreamUrl || "").replace(/\/+$/, "");
        apiKey = channel.anthropicUpstreamApiKey || "";
      }
    }

    // 回退到环境变量
    if (!apiKey) {
      apiKey = process.env.ANTHROPIC_API_KEY || "";
      if (!apiKey)
        throw new BadRequestError(
          "Anthropic API key not configured. Please set the ANTHROPIC_API_KEY environment variable or configure a relay channel.",
        );
    }

    if (!baseUrl) throw new BadRequestError("Anthropic API base URL not configured.");

    return {
      messagesUrl: `${baseUrl}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        Authorization: `Bearer ${apiKey}`,
        "x-api-key": apiKey,
      },
    };
  }

  /**
   * 调用上游 /v1/messages 接口
   */
  async messages(body: AnthropicMessagesRequest): Promise<AnthropicMessagesResponse> {
    const { messagesUrl, headers } = await this.buildConfig();

    const response = await axios.post<AnthropicMessagesResponse>(messagesUrl, body, {
      headers,
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      const errMsg = typeof response.data === "object" ? JSON.stringify(response.data) : String(response.data);
      throw new BadRequestError(`AI service error: ${response.status} ${errMsg}`);
    }

    return response.data;
  }
}
