import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { RELAY_CAPABILITY_RESOLUTION_LIMITS } from "@/constant/relay-capability";
import { iamAccountDenied } from "../users/iam-account-principal";
import { relayChannelChangeValidationSourceSelect } from "./relay-channel-change-request-create.repository";
import type { RelayChannelProviderConfigRepository } from "./relay-channel-provider-config.repository";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import type { RelayModelCatalogEntry } from "@/services/relay/relay-pool-resolver.service";
import type { SubmissionProviderInput } from "./relay-channel-submission-create.repository";
import type {
  CreateRelayChannelRequest,
  RelayChannelProviderConfigRequest,
  RelayChannelMemberDto,
} from "@/api/dto/relay/relay-channel.dto";
export const creationPolicy = Object.freeze({ timeoutMs: 30000 });
export const edgeSelect = { id: true, memberChannelId: true, priority: true, weight: true, enabled: true } as const;
export const nodeSelect = {
  id: true,
  status: true,
  updateTime: true,
  channelType: true,
  pooledParentId: true,
  poolMembers: {
    select: edgeSelect,
    orderBy: { memberChannelId: "asc" },
    take: RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes + 1,
  },
  pooledChildren: {
    where: { status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
    select: { id: true },
    orderBy: { id: "asc" },
    take: RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes + 1,
  },
} as const satisfies Prisma.RelayChannelSelect;
export const providerSelect = {
  id: true,
  userId: true,
  status: true,
  createTime: true,
  updateTime: true,
  commissionPercent: true,
  settlementMode: true,
  settlementIntervalDays: true,
  settlementTime: true,
  nextSettlementAt: true,
  lastSettledAt: true,
} as const;
export const sourceSelect = {
  ...relayChannelChangeValidationSourceSelect,
  createTime: true,
  poolMembers: nodeSelect.poolMembers,
  providers: { select: providerSelect, orderBy: { userId: "asc" } },
} as const;
export const userSelect = { id: true, status: true, updateTime: true, accountOwnerId: true, username: true } as const;
export type CreationNode = Prisma.RelayChannelGetPayload<{ select: typeof nodeSelect }>;
export type CreationProviders = Awaited<ReturnType<RelayChannelProviderConfigRepository["providers"]>>;
export type ChannelCreatePreparation = (
  input: CreateRelayChannelRequest,
  catalog: readonly RelayModelCatalogEntry[],
  topologyMode: "legacy" | "strict-two-tier",
) => Promise<{
  data: Prisma.RelayChannelUncheckedCreateInput;
  members: RelayChannelMemberDto[] | null | undefined;
}>;
export type ChannelCreateProviderPreparation = (
  input: RelayChannelProviderConfigRequest,
  userId: string,
  now: Date,
) => SubmissionProviderInput;
export interface ChannelCreationGuard {
  principal: IamPrincipal;
  snapshot: PlatformManagementReadSnapshot;
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
  admit: (ids: readonly string[], providerIds?: readonly string[]) => Promise<void>;
}
export const decimal = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
export const providerValues = (row: {
  userId: string;
  commissionPercent: number | Prisma.Decimal;
  settlementMode: string;
  settlementIntervalDays?: number | null;
  settlementTime?: string | null;
  nextSettlementAt?: Date | null;
}) => ({
  userId: row.userId,
  commissionPercent: Number(decimal(row.commissionPercent)),
  settlementMode: row.settlementMode,
  settlementIntervalDays: row.settlementIntervalDays ?? null,
  settlementTime: row.settlementTime ?? null,
  nextSettlementAt: row.nextSettlementAt ?? null,
});
/** Credential values never leave SQL reads. These private digests are never returned or logged. */
export async function credentialProof(
  tx: Prisma.TransactionClient,
  id: string,
  data: Prisma.RelayChannelUncheckedCreateInput,
) {
  const rows = await tx.$queryRaw<{ actual: string; expected: string }[]>(Prisma.sql`SELECT
    SHA2(JSON_ARRAY(openaiUpstreamApiKey, anthropicUpstreamApiKey, geminiUpstreamApiKey),256) AS actual,
    SHA2(JSON_ARRAY(${data.openaiUpstreamApiKey ?? null}, ${data.anthropicUpstreamApiKey ?? null}, ${data.geminiUpstreamApiKey ?? null}),256) AS expected
    FROM relay_channels WHERE id=${id}`);
  if (rows.length !== 1 || !/^[a-f0-9]{64}$/i.test(rows[0]!.actual) || rows[0]!.actual !== rows[0]!.expected)
    throw iamAccountDenied();
}
