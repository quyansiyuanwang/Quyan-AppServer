import type { Prisma, RelayChannel } from "@prisma/client";

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
}

export type RelayChannelStore = RelayChannelQueryStore & RelayChannelMutationStore;
