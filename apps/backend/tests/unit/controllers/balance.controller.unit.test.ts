import { describe, expect, it } from "vitest";
import { BalanceController } from "../../../src/api/controllers/v1/billing/balance.controller";

describe("BalanceController", () => {
  it("displays the sender username for incoming peer transfers", () => {
    const controller = Object.create(BalanceController.prototype) as BalanceController;
    const transaction = {
      id: "tx-1",
      userId: "recipient-1",
      type: "peer_transfer_in",
      amount: 10,
      balanceBefore: 20,
      balanceAfter: 30,
      relatedId: "transfer-1",
      description: "来自用户 sender-id 的转账",
      createTime: new Date(),
    };

    const result = (controller as any).mapTransactionRecord(
      transaction,
      new Map(),
      new Map(),
      new Map([
        [
          "transfer-1",
          {
            senderUsername: "sender",
            recipientUsername: "recipient",
            description: "thank you",
          },
        ],
      ]),
    );

    expect(result.description).toBe("来自用户 sender 的转账：thank you");
  });
});
