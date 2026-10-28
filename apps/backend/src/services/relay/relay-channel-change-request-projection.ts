import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { createRelayChannelChangeRequestBodySchema } from "@/api/schema/relay/relay-channel.schema";
import type { RelayChannelChangeRequestDto } from "@/api/dto/relay/relay-channel.dto";
import { BadRequestError } from "@/util/errors";
// Strip unknown fields at every schema-defined object boundary, including nested provider configurations.
const publicConfig = createRelayChannelChangeRequestBodySchema
  .omit({
    openaiUpstreamApiKey: true,
    anthropicUpstreamApiKey: true,
    geminiUpstreamApiKey: true,
  })
  .extend({
    hasOpenaiUpstreamApiKey: z.boolean().default(false),
    hasAnthropicUpstreamApiKey: z.boolean().default(false),
    hasGeminiUpstreamApiKey: z.boolean().default(false),
  });
export interface RelayChannelChangeRequestProjectionSource {
  id: string;
  relayChannelId: string;
  submittedByUserId: string;
  reviewStatus: string;
  reviewedAt: Date | null;
  reviewReason: string | null;
  configSnapshot: Prisma.JsonValue;
  createTime: Date;
  updateTime: Date;
  relayChannel: { name: string };
  submittedBy: { username: string };
}
export function projectRelayChannelChangeRequest(
  row: RelayChannelChangeRequestProjectionSource,
): RelayChannelChangeRequestDto {
  const config = publicConfig.safeParse(row.configSnapshot);
  if (!config.success || !["pending", "approved", "rejected"].includes(row.reviewStatus))
    throw new BadRequestError("Invalid stored channel change configuration", undefined, {
      messageKey: "errors.badRequest",
    });
  return {
    id: row.id,
    relayChannelId: row.relayChannelId,
    channelName: row.relayChannel.name || "",
    submittedByUserId: row.submittedByUserId,
    submittedByUsername: row.submittedBy.username,
    reviewStatus: row.reviewStatus as RelayChannelChangeRequestDto["reviewStatus"],
    reviewedAt: row.reviewedAt || undefined,
    reviewReason: row.reviewReason || undefined,
    config: config.data,
    createTime: row.createTime,
    updateTime: row.updateTime,
  };
}
