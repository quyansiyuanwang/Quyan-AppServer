import type { Prisma } from "@prisma/client";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import type { RelayChannelType, RelayChannelSubmissionStatus } from "@/api/dto/relay/relay-channel.dto";
import { BadRequestError } from "@/util/errors";
export interface RelayChannelManagementFilters {
  page?: number;
  pageSize?: number;
  keyword?: string;
  channelType?: RelayChannelType;
  channelTypes?: RelayChannelType[];
  enabled?: boolean;
  submissionStatus?: RelayChannelSubmissionStatus;
  models?: string[];
  modelMatchMode?: "any" | "all";
}
export function buildRelayChannelManagementQuery(
  query: RelayChannelManagementFilters,
  visibilityWhere?: Prisma.RelayChannelWhereInput,
) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const modelFilters = [...new Set((query.models ?? []).map((model) => model.trim()).filter(Boolean))];
  const modelMatchMode = query.modelMatchMode ?? "any";
  const where: Prisma.RelayChannelWhereInput = {
    status:
      query.enabled === undefined
        ? { in: VISIBLE_RELAY_CHANNEL_STATUSES }
        : query.enabled
          ? RELAY_CHANNEL_STATUS.ENABLED
          : RELAY_CHANNEL_STATUS.DISABLED,
  };

  if (query.keyword?.trim()) where.name = { contains: query.keyword.trim() };
  if (query.channelType && query.channelTypes?.length)
    throw new BadRequestError("channelType and channelTypes cannot be used together", undefined, {
      messageKey: "relayChannel.channelTypeConflict",
    });
  if (query.channelTypes?.length) where.channelType = { in: query.channelTypes };
  else if (query.channelType) where.channelType = query.channelType;
  if (query.submissionStatus === "pending") {
    where.OR = [{ submissionStatus: "pending" }, { changeRequests: { some: { status: 1, reviewStatus: "pending" } } }];
  } else if (query.submissionStatus) {
    where.submissionStatus = query.submissionStatus;
  }

  if (visibilityWhere) where.AND = [visibilityWhere];

  return { where, page, pageSize, modelFilters, modelMatchMode };
}
