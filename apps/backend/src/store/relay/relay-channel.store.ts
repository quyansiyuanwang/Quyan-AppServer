import type { Prisma, RelayChannel } from "@prisma/client";

export type RelayChannelTransactionClient = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export interface RelayChannelQueryStore {
  findActiveByName(name: string): Promise<RelayChannel | null>;
  findVisibleByName(name: string): Promise<RelayChannel | null>;
  listActive(): Promise<RelayChannel[]>;
  listVisible(): Promise<RelayChannel[]>;
  findActiveById(id: string): Promise<RelayChannel | null>;
  findVisibleById(id: string): Promise<RelayChannel | null>;
  listActiveByIds(ids: string[]): Promise<RelayChannel[]>;
  listVisibleByIds(ids: string[]): Promise<RelayChannel[]>;
}

export interface RelayChannelMutationStore {
  create(data: Prisma.RelayChannelUncheckedCreateInput, tx?: RelayChannelTransactionClient): Promise<RelayChannel>;
  withTransaction<T>(callback: (tx: RelayChannelTransactionClient) => Promise<T>): Promise<T>;
  updateById(id: string, data: Prisma.RelayChannelUncheckedUpdateInput): Promise<RelayChannel>;
  updateStatusByIds(ids: string[], status: number): Promise<number>;
  softDeleteAndUnassignTokens(id: string): Promise<void>;
  softDeleteAndUnassignTokensByIds(ids: string[]): Promise<number>;
}

export type RelayChannelStore = RelayChannelQueryStore & RelayChannelMutationStore;
