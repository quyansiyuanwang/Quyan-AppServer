import type { Prisma, RelayChannel } from "@prisma/client";

export interface RelayChannelManagementQuery {
  where: Prisma.RelayChannelWhereInput;
  page: number;
  pageSize: number;
}

export interface RelayChannelManagementRecord {
  id: string;
  name: string;
  status: number;
  channelType: string | null;
  routingStrategy: string | null;
  visibilityMode: string | null;
  multiplier: Prisma.Decimal;
  submissionStatus: string;
  providers: Array<{ commissionPercent: Prisma.Decimal }>;
  updateTime: Date;
  pooledParentId: string | null;
  pooledParent: { name: string } | null;
  poolMembers: Array<{ memberChannelId: string }>;
  pooledChildren: Array<{ id: string }>;
}

export type RelayChannelTransactionClient = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export interface RelayChannelMemberInput {
  memberChannelId: string;
  priority: number;
  weight?: number;
  enabled?: boolean;
}

export interface RelayChannelQueryStore {
  findActiveByName(name: string): Promise<RelayChannel | null>;
  findVisibleByName(name: string): Promise<RelayChannel | null>;
  listActive(tx?: RelayChannelTransactionClient): Promise<RelayChannel[]>;
  listVisible(tx?: RelayChannelTransactionClient): Promise<RelayChannel[]>;
  findActiveById(id: string): Promise<RelayChannel | null>;
  findVisibleById(id: string): Promise<RelayChannel | null>;
  listActiveByIds(ids: string[], tx?: RelayChannelTransactionClient): Promise<RelayChannel[]>;
  listVisibleByIds(ids: string[], tx?: RelayChannelTransactionClient): Promise<RelayChannel[]>;
  listActiveDirectPooledParentsByMemberChannelId(memberChannelId: string): Promise<RelayChannel[]>;
  listManagementPage(query: RelayChannelManagementQuery): Promise<{
    records: RelayChannelManagementRecord[];
    total: number;
  }>;
  listSubmittedByUser(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ records: RelayChannel[]; total: number }>;
}

export interface RelayChannelMutationStore {
  create(data: Prisma.RelayChannelUncheckedCreateInput, tx?: RelayChannelTransactionClient): Promise<RelayChannel>;
  withTransaction<T>(callback: (tx: RelayChannelTransactionClient) => Promise<T>): Promise<T>;
  updateById(
    id: string,
    data: Prisma.RelayChannelUncheckedUpdateInput,
    tx?: RelayChannelTransactionClient,
  ): Promise<RelayChannel>;
  updateStatusByIds(ids: string[], status: number): Promise<number>;
  countDirectBusinessReferences(id: string): Promise<number>;
  softDeleteAndUnassignTokens(id: string): Promise<void>;
  softDeleteAndUnassignTokensByIds(ids: string[]): Promise<number>;
  replaceMembersByChannelId(
    relayChannelId: string,
    members: RelayChannelMemberInput[],
    tx?: RelayChannelTransactionClient,
  ): Promise<void>;
  deleteMembersByChannelId(relayChannelId: string, tx?: RelayChannelTransactionClient): Promise<void>;
  replaceProvidersByChannelId(
    relayChannelId: string,
    providers: Array<{
      userId: string;
      commissionPercent: number;
      settlementMode: string;
      settlementIntervalDays?: number;
      settlementTime?: string;
      nextSettlementAt?: Date | null;
    }>,
    tx?: RelayChannelTransactionClient,
  ): Promise<void>;
}

export type RelayChannelStore = RelayChannelQueryStore & RelayChannelMutationStore;
