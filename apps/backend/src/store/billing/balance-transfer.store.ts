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

export interface BalanceTransferStore {
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
