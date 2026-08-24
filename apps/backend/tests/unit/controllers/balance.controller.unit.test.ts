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

  it.each([
    [75, 25, 0.25],
    [0, 100, 1],
  ])("calculates cache hit rate per request", (inputTokens, cacheReadTokens, expected) => {
    const controller = Object.create(BalanceController.prototype) as BalanceController;
    const result = (controller as any).mapTransactionRecord(
      {
        id: "tx-cache",
        userId: "u-1",
        type: "api_usage",
        amount: -1,
        balanceBefore: 10,
        balanceAfter: 9,
        inputTokens,
        cacheReadTokens,
        cacheCreationTokens: 500,
        model: "gpt-4o",
        description: "API调用: /v1/chat/completions",
        createTime: new Date(),
      },
      new Map(),
      new Map(),
      new Map(),
    );

    expect(result.cacheHitRate).toBe(expected);
  });

  it("returns no cache rate for non-usage or invalid token records", () => {
    const controller = Object.create(BalanceController.prototype) as BalanceController;
    const map = (transaction: Record<string, unknown>) =>
      (controller as any).mapTransactionRecord(transaction, new Map(), new Map(), new Map());

    expect(map({ id: "transfer", userId: "u-1", type: "peer_transfer_in", amount: 1 }).cacheHitRate).toBeNull();
    expect(
      map({
        id: "invalid",
        userId: "u-1",
        type: "api_usage",
        amount: -1,
        inputTokens: -1,
        cacheReadTokens: 4,
      }).cacheHitRate,
    ).toBeNull();
    expect(
      map({
        id: "empty",
        userId: "u-1",
        type: "api_usage",
        amount: -1,
        inputTokens: 0,
        cacheReadTokens: 0,
      }).cacheHitRate,
    ).toBeNull();
  });
});
