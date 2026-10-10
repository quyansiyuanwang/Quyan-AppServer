import { buildRelayConfig } from "./env/infrastructure";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { z } from "zod";
import { buildAiResourcesConfig, buildChatResourceConfig, buildAiRequestLogConfig } from "./env/ai-resources";
import type { AIResourceSettingsDto, AIResourceFieldDto } from "@/api/dto/system/ai-resources.dto";
import { deepFreeze } from "./env/common";
const positive = z.number().int().min(1).max(2147483647);
const capacity = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const nonnegative = z.number().int().min(0).max(2147483647);
export const AI_RESOURCE_CONFIG_KEY = CONFIG_KEYS.AI_RESOURCES;
export const AI_RESOURCE_REFRESH_MS = 5000;
export const aiResourceSettingsSchema = z
  .object({
    version: z.literal(1),
    aiResources: z
      .object({
        maxActiveRequests: positive,
        maxQueuedRequests: nonnegative,
        queueTimeoutMs: positive,
        memory: z
          .object({
            sampleIntervalMs: positive,
            highWatermarkBytes: capacity,
            resumeWatermarkBytes: capacity,
          })
          .strict(),
        streaming: z
          .object({
            frameLimitBytes: capacity,
            retainedLimitBytes: capacity,
            maxBlocks: positive,
            outputLimitBytes: capacity,
          })
          .strict(),
        http: z.object({ maxSockets: positive, maxTotalSockets: positive, maxFreeSockets: positive }).strict(),
      })
      .strict(),
    chat: z
      .object({
        resourceLimits: z
          .object({
            inputLimitBytes: capacity,
            outputLimitBytes: capacity,
            contextMaxMessages: nonnegative,
            contextLimitBytes: capacity,
          })
          .strict(),
      })
      .strict(),
    aiRequestLog: z
      .object({
        requestBodyBytes: capacity,
        responseBodyBytes: capacity,
        writeConcurrency: positive,
        queueMaxItems: positive,
        queueMaxBytes: capacity,
      })
      .strict(),
    relay: z
      .object({
        resourceGuard: z
          .object({
            multipartBodyLimitMb: positive,
            imageMaxConcurrency: positive,
            imageQueueTimeoutMs: nonnegative,
            nonStreamUpstreamTimeoutMs: positive,
            maxUpstreamResponseBodyMb: positive,
            imageResponseBodyLimitMb: positive,
          })
          .strict(),
        channelProbe: z.object({ maxConcurrency: positive }).strict(),
      })
      .strict(),
    ruleCache: z.object({ maxItems: positive, maxEstimatedBytes: capacity }).strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.aiResources.memory.resumeWatermarkBytes >= value.aiResources.memory.highWatermarkBytes)
      ctx.addIssue({ code: "custom", message: "RSS resume must be below the high watermark" });
    const http = value.aiResources.http;
    if (http.maxFreeSockets > http.maxSockets || http.maxSockets > http.maxTotalSockets)
      ctx.addIssue({ code: "custom", message: "Sockets require free <= per-host <= total" });
  });
export const AI_RESOURCE_DEFAULTS: AIResourceSettingsDto = deepFreeze({
  version: 1,
  aiResources: buildAiResourcesConfig({}),
  chat: buildChatResourceConfig({}),
  aiRequestLog: buildAiRequestLogConfig({}),
  relay: {
    resourceGuard: buildRelayConfig({}).resourceGuard,
    channelProbe: { maxConcurrency: buildRelayConfig({}).channelProbe.maxConcurrency },
  },
  ruleCache: { maxItems: 512, maxEstimatedBytes: 8 * 1024 * 1024 },
});
const field = (
  path: string,
  group: string,
  label: string,
  labelEn: string,
  unit = "",
  scale = 1,
  min = 1,
): AIResourceFieldDto => ({
  path,
  group,
  label,
  labelEn,
  unit,
  scale,
  min,
  max: Math.floor((scale > 1 ? Number.MAX_SAFE_INTEGER : 2147483647) / scale),
});
export const AI_RESOURCE_FIELDS: AIResourceFieldDto[] = [
  field("aiResources.maxActiveRequests", "admission", "AI 执行并发", "Active AI requests"),
  field(
    "aiResources.maxQueuedRequests",
    "admission",
    "等待人数（0 为不排队）",
    "Waiting requests (0 disables queuing)",
    "",
    1,
    0,
  ),
  field("aiResources.queueTimeoutMs", "admission", "总排队时间", "Total queue timeout", "ms"),
  field("aiResources.memory.sampleIntervalMs", "admission", "内存采样间隔", "Memory sampling interval", "ms"),
  field("aiResources.memory.highWatermarkBytes", "admission", "RSS 高水位", "RSS high watermark", "MB", 1048576),
  field("aiResources.memory.resumeWatermarkBytes", "admission", "RSS 恢复水位", "RSS resume watermark", "MB", 1048576),
  field("aiResources.streaming.frameLimitBytes", "streaming", "单帧容量", "Frame capacity", "KB", 1024),
  field(
    "aiResources.streaming.retainedLimitBytes",
    "streaming",
    "转换保留容量",
    "Conversion retained capacity",
    "KB",
    1024,
  ),
  field("aiResources.streaming.maxBlocks", "streaming", "转换 block 数", "Conversion block count"),
  field("aiResources.streaming.outputLimitBytes", "streaming", "累积文本容量", "Accumulated text capacity", "KB", 1024),
  field("chat.resourceLimits.inputLimitBytes", "chat", "输入容量", "Input capacity", "KB", 1024),
  field("chat.resourceLimits.outputLimitBytes", "chat", "聊天输出容量", "Chat output capacity", "KB", 1024),
  field(
    "chat.resourceLimits.contextMaxMessages",
    "chat",
    "上下文条数（0 为不限条数）",
    "Context messages (0 disables count limit)",
    "",
    1,
    0,
  ),
  field("chat.resourceLimits.contextLimitBytes", "chat", "上下文正文容量", "Context content capacity", "KB", 1024),
  field("aiRequestLog.requestBodyBytes", "audit", "请求审计正文", "Request audit body", "KB", 1024),
  field("aiRequestLog.responseBodyBytes", "audit", "响应审计正文", "Response audit body", "KB", 1024),
  field("aiRequestLog.writeConcurrency", "audit", "审计写入并发", "Audit write concurrency"),
  field("aiRequestLog.queueMaxItems", "audit", "审计等待记录数", "Queued audit records"),
  field("aiRequestLog.queueMaxBytes", "audit", "审计等待容量", "Queued audit capacity", "MB", 1048576),
  field("aiResources.http.maxSockets", "http", "单上游连接数", "Sockets per upstream"),
  field("aiResources.http.maxTotalSockets", "http", "总连接数", "Total sockets"),
  field("aiResources.http.maxFreeSockets", "http", "单上游空闲连接数", "Idle sockets per upstream"),
  field("relay.resourceGuard.multipartBodyLimitMb", "relay", "图片上传容量", "Multipart upload capacity", "MB"),
  field("relay.resourceGuard.imageMaxConcurrency", "relay", "图片并发", "Image concurrency"),
  field("relay.resourceGuard.imageQueueTimeoutMs", "relay", "图片排队时间", "Image queue timeout", "ms", 1, 0),
  field(
    "relay.resourceGuard.nonStreamUpstreamTimeoutMs",
    "relay",
    "非流式上游超时",
    "Non-stream upstream timeout",
    "ms",
  ),
  field("relay.resourceGuard.maxUpstreamResponseBodyMb", "relay", "非流式响应容量", "Buffered response capacity", "MB"),
  field("relay.resourceGuard.imageResponseBodyLimitMb", "relay", "图片响应容量", "Image response capacity", "MB"),
  field("relay.channelProbe.maxConcurrency", "relay", "探针并发", "Probe concurrency"),
  field("ruleCache.maxItems", "rules", "编译规则缓存条数", "Compiled rule cache entries"),
  field(
    "ruleCache.maxEstimatedBytes",
    "rules",
    "编译规则缓存估算容量",
    "Estimated compiled rule cache capacity",
    "MB",
    1048576,
  ),
];
