import type { BalanceGiftCode, BalanceTransfer } from "@prisma/client";

export interface BalanceTransferDisplayRecord {
  id: string;
  senderUsername: string;
  recipientUsername: string;
  description: string | null;
}

export interface CreateGiftCodeParams {
  senderId: string;
  code: string;
  amount: number;
  feeAmount: number;
  feePercent: number;
  cancelFeeRefundPercent: number;
  totalDebit: number;
  expiresAt?: Date;
}

export type BalanceGiftCodeTarget = Pick<BalanceGiftCode, "id" | "createdBy" | "createTime" | "updateTime">;

export interface BalanceTransferStore {
  findGiftCodeTarget(id: string, senderId: string, accountOwnerId: string): Promise<BalanceGiftCodeTarget | null>;
  scanGiftCodeTargets(
    senderId: string,
    accountOwnerId: string,
    after?: BalanceGiftCodeTarget,
  ): Promise<BalanceGiftCodeTarget[]>;
  readGiftCodeTargets(
    senderId: string,
    accountOwnerId: string,
    targets: readonly BalanceGiftCodeTarget[],
  ): Promise<BalanceGiftCode[]>;
  createGiftCode(params: CreateGiftCodeParams): Promise<{ giftCode: BalanceGiftCode; balance: number }>;
  listGiftCodes(senderId: string, skip: number, take: number): Promise<{ total: number; records: BalanceGiftCode[] }>;
  redeemGiftCode(code: string, userId: string): Promise<{ balance: number; amount: number }>;
  cancelGiftCode(id: string, senderId: string): Promise<{ refundedAmount: number; balance: number }>;
  findTransferDisplayRecords(ids: string[]): Promise<BalanceTransferDisplayRecord[]>;
  createTransfer(params: {
    senderId: string;
    recipientId: string;
    amount: number;
    feeAmount: number;
    feePercent: number;
    totalDebit: number;
    description?: string;
  }): Promise<{ transfer: BalanceTransfer; balance: number }>;
}
