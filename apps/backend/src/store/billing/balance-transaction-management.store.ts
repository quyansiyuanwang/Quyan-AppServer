import type { BalanceTransaction } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
export interface ManagedTransactionQuery {
  userId?: string;
  type?: string;
  model?: string;
  tokenName?: string;
  startTime?: Date;
  endTime?: Date;
  page: number;
  pageSize: number;
}
export type ManagedTransactionTarget = Pick<BalanceTransaction, "id" | "userId" | "createTime" | "updateTime">;
export interface ManagedTransactionDisplay {
  tokenNameMap: Map<string, string>;
  usageDataMap: Map<
    string,
    {
      totalOutputTime: number | null;
      timeToFirstByte: number | null;
      isStreaming: boolean;
      requestId: string | null;
      displayChannelName: string | null;
      automaticPoolDisplayChannelName: string | null;
      isAutomaticPoolUsage: boolean;
      hideDisplayChannel: boolean;
      legacyMonthlyPassChannelName: string | null;
    }
  >;
  transferDataMap: Map<string, { senderUsername: string; recipientUsername: string; description: string | null }>;
}
export interface BalanceTransactionManagementStore {
  assertActor(principal: IamPrincipal): Promise<void>;
  scan(
    principal: IamPrincipal,
    query: ManagedTransactionQuery,
    after?: ManagedTransactionTarget,
  ): Promise<ManagedTransactionTarget[]>;
  hydrate(principal: IamPrincipal, targets: readonly ManagedTransactionTarget[]): Promise<BalanceTransaction[]>;
  current(principal: IamPrincipal, targets: readonly ManagedTransactionTarget[]): Promise<ManagedTransactionTarget[]>;
  display(principal: IamPrincipal, rows: readonly BalanceTransaction[]): Promise<ManagedTransactionDisplay>;
}
