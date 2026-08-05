import { beforeEach, describe, expect, it, vi } from "vitest";
import { BalanceTransferService } from "../../../src/services/billing/balance-transfer.service";
import { BadRequestError } from "../../../src/util/errors";

describe("BalanceTransferService", () => {
  const repository = {
    createGiftCode: vi.fn(),
    listGiftCodes: vi.fn(),
    redeemGiftCode: vi.fn(),
    cancelGiftCode: vi.fn(),
    findTransferDisplayRecords: vi.fn(),
    createTransfer: vi.fn(),
  };
  const users = { findByUsername: vi.fn() };
  const config = { getBillingConfig: vi.fn() };
  const logs = { logOperation: vi.fn().mockResolvedValue(undefined) };
  const ServiceCtor = BalanceTransferService as unknown as new (...args: any[]) => BalanceTransferService;
  let service: BalanceTransferService;

  beforeEach(() => {
    vi.clearAllMocks();
    config.getBillingConfig.mockResolvedValue({
      rechargeRatio: 100,
      giftCodeEnabled: true,
      directTransferEnabled: true,
      giftCodeFeePercent: 2.5,
      directTransferFeePercent: 1.25,
      giftCodeCancelFeeRefundPercent: 40,
    });
    repository.createGiftCode.mockResolvedValue({
      giftCode: {
        id: "gc-1",
        code: "ugc_test",
        amount: 10,
        feeAmount: 0.25,
        feePercent: 2.5,
        cancelFeeRefundPercent: 40,
        totalDebit: 10.25,
        state: "active",
        refundedAmount: null,
        redeemedBy: null,
        redeemedAt: null,
        cancelledAt: null,
        expiresAt: null,
        createTime: new Date(),
      },
      balance: 9.75,
    });
    repository.createTransfer.mockResolvedValue({
      transfer: {
        id: "tr-1",
        amount: 10,
        feeAmount: 0.125,
        feePercent: 1.25,
        totalDebit: 10.125,
        createTime: new Date(),
      },
      balance: 9.87,
    });
    service = new ServiceCtor(repository, users, config, logs);
  });

  it("snapshots gift-code fee settings and calculates total debit", async () => {
    await service.createGiftCode({ amount: 10 }, "sender-1");

    expect(repository.createGiftCode).toHaveBeenCalledWith(
      expect.objectContaining({
        senderId: "sender-1",
        amount: 10,
        feeAmount: 0.25,
        totalDebit: 10.25,
        feePercent: 2.5,
        cancelFeeRefundPercent: 40,
      }),
    );
  });

  it("rejects gift-code creation when the feature is disabled", async () => {
    config.getBillingConfig.mockResolvedValue({ giftCodeEnabled: false });

    await expect(service.createGiftCode({ amount: 10 }, "sender-1")).rejects.toThrow(BadRequestError);
    expect(repository.createGiftCode).not.toHaveBeenCalled();
  });

  it("returns the repository-calculated cancellation refund", async () => {
    repository.cancelGiftCode.mockResolvedValue({ refundedAmount: 10.1, balance: 50.1 });

    await expect(service.cancelGiftCode("gc-1", "sender-1")).resolves.toEqual({
      refundedAmount: 10.1,
      balance: 50.1,
    });
    expect(repository.cancelGiftCode).toHaveBeenCalledWith("gc-1", "sender-1");
  });

  it("retrieves transfer counterparties for transaction display", async () => {
    const records = [
      {
        id: "tr-1",
        senderUsername: "sender",
        recipientUsername: "recipient",
        description: "thanks",
      },
    ];
    repository.findTransferDisplayRecords.mockResolvedValue(records);

    await expect(service.getTransferDisplayRecords(["tr-1"])).resolves.toEqual(records);
    expect(repository.findTransferDisplayRecords).toHaveBeenCalledWith(["tr-1"]);
  });

  it("uses the direct-transfer fee and rejects self transfers", async () => {
    users.findByUsername.mockResolvedValue({ id: "recipient-1" });
    const result = await service.createTransfer({ recipientUsername: "recipient", amount: 10 }, "sender-1");

    expect(result.totalDebit).toBe(10.125);
    expect(repository.createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 10, feeAmount: 0.125, totalDebit: 10.125, feePercent: 1.25 }),
    );

    users.findByUsername.mockResolvedValue({ id: "sender-1" });
    await expect(service.createTransfer({ recipientUsername: "sender", amount: 10 }, "sender-1")).rejects.toThrow(
      BadRequestError,
    );
  });
});
