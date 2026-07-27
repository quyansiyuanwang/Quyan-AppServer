import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../../src/app";
import { prisma } from "../../../src/config/database";
import { hashPassword } from "../../../src/util/crypto";
import { Permission } from "../../../src/constant/permission";
import { withReplayProtection } from "../../util/replay-protection-test-helper";

describe("Balance API Integration", () => {
  let app: Express;
  let accessToken = "";
  let adminUserId = "";
  let targetUserId = "";
  let testGroupId = "";
  const relayTokenIds: string[] = [];
  const relayChannelIds: string[] = [];

  const shortSuffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)}`;
  const adminUsername = `bau_${shortSuffix}`;
  const targetUsername = `btu_${shortSuffix}`;
  const groupUsername = `bag_${shortSuffix}`;

  const postWithReplay = (path: string, body: Record<string, unknown>) =>
    withReplayProtection(request(app).post(path), body, path).set("Authorization", `Bearer ${accessToken}`).send(body);

  beforeAll(async () => {
    app = createApp();

    const group = await prisma.group.create({
      data: {
        username: groupUsername,
        name: "Balance API Test Group",
        level: 1,
        permissions: JSON.stringify([Permission.BALANCE_READ, Permission.BALANCE_RECHARGE]),
      },
    });
    testGroupId = group.id;

    const adminUser = await prisma.user.create({
      data: {
        username: adminUsername,
        password: hashPassword("test_password"),
        groupId: testGroupId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    adminUserId = adminUser.id;

    const targetUser = await prisma.user.create({
      data: {
        username: targetUsername,
        password: hashPassword("test_password"),
        groupId: testGroupId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    targetUserId = targetUser.id;

    const loginBody = {
      username: adminUsername,
      password: "test_password",
      agreedToLegalPolicies: true,
    };
    const loginRes = await withReplayProtection(request(app).post("/v1/auth/login"), loginBody, "/v1/auth/login").send(
      loginBody,
    );
    accessToken = loginRes.body.data.access_token;
  });

  afterAll(async () => {
    await prisma.monthlyPassUsage.deleteMany({ where: { userId: { in: [adminUserId, targetUserId] } } });
    await prisma.balanceTransaction.deleteMany({ where: { userId: { in: [adminUserId, targetUserId] } } });
    await prisma.relayUsage.deleteMany({ where: { relayTokenId: { in: relayTokenIds } } });
    await prisma.relayToken.deleteMany({ where: { id: { in: relayTokenIds } } });
    await prisma.relayChannel.deleteMany({ where: { id: { in: relayChannelIds } } });
    await prisma.userMonthlyPass.deleteMany({ where: { userId: { in: [adminUserId, targetUserId] } } });
    await prisma.monthlyPassTemplate.deleteMany({ where: { name: { startsWith: `Balance History ${shortSuffix}` } } });
    await prisma.balanceAccount.deleteMany({ where: { userId: { in: [adminUserId, targetUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminUserId, targetUserId] } } });
    await prisma.group.deleteMany({ where: { id: testGroupId } });
  });

  it("supports recharge and account/transaction queries", async () => {
    const myAccountRes = await request(app).get("/v1/balance/account").set("Authorization", `Bearer ${accessToken}`);
    expect(myAccountRes.status).toBe(200);
    expect(myAccountRes.body.data).toHaveProperty("userId", adminUserId);

    const usageRes = await request(app).get("/v1/balance/usage").set("Authorization", `Bearer ${accessToken}`);
    expect(usageRes.status).toBe(200);
    expect(usageRes.body.data).toHaveProperty("remaining");

    const rechargeRes = await postWithReplay("/v1/balance/recharge", {
      userId: targetUserId,
      amount: 88.88,
      description: "integration test recharge",
      countAsStatistics: true,
    });
    expect(rechargeRes.status).toBe(200);

    const targetAccountRes = await request(app)
      .get(`/v1/balance/account/${targetUserId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(targetAccountRes.status).toBe(200);
    expect(targetAccountRes.body.data.balance).toBe(88.88);

    const batchRes = await postWithReplay("/v1/balance/accounts/batch", {
      userIds: [adminUserId, targetUserId],
    });
    expect(batchRes.status).toBe(200);
    expect(Array.isArray(batchRes.body.data)).toBe(true);
    expect(batchRes.body.data.some((item: { userId: string }) => item.userId === targetUserId)).toBe(true);

    const allTxRes = await request(app)
      .get(`/v1/balance/transactions/all?userId=${targetUserId}&limit=20&offset=0`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(allTxRes.status).toBe(200);
    expect(Array.isArray(allTxRes.body.data.records)).toBe(true);
    expect(allTxRes.body.data.records.length).toBeGreaterThan(0);
  });

  it("classifies monthly pass coverage descriptions consistently", async () => {
    const monthlyPassCn = await prisma.balanceTransaction.create({
      data: {
        userId: targetUserId,
        type: "recharge",
        amount: -0.1234,
        balanceBefore: 88.88,
        balanceAfter: 88.7566,
        description: "月卡抵扣: 覆盖本次请求 ¥0.1234",
      },
    });

    const monthlyPassEn = await prisma.balanceTransaction.create({
      data: {
        userId: targetUserId,
        type: "recharge",
        amount: -0.2234,
        balanceBefore: 88.7566,
        balanceAfter: 88.5332,
        description: "Monthly pass coverage: covered request ¥0.2234",
      },
    });

    const chatUsage = await prisma.balanceTransaction.create({
      data: {
        userId: targetUserId,
        type: "recharge",
        amount: -0.3234,
        balanceBefore: 88.5332,
        balanceAfter: 88.2098,
        description: "API调用: /chat/conversations/test-id/messages",
        model: "gpt-5.4",
      },
    });

    const allTxRes = await request(app)
      .get(`/v1/balance/transactions/all?userId=${targetUserId}&limit=100&offset=0`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(allTxRes.status).toBe(200);
    const records = allTxRes.body.data.records as Array<{ id: string; category: string }>;
    const categoryById = new Map(records.map((record) => [record.id, record.category]));

    expect(categoryById.get(monthlyPassCn.id)).toBe("monthly_pass_coverage");
    expect(categoryById.get(monthlyPassEn.id)).toBe("monthly_pass_coverage");
    expect(categoryById.get(chatUsage.id)).toBe("chat_usage");
  });

  it("returns per-request pricing metadata in transaction records", async () => {
    const transaction = await prisma.balanceTransaction.create({
      data: {
        userId: targetUserId,
        type: "api_usage",
        amount: -0.25,
        balanceBefore: 88.2098,
        balanceAfter: 87.9598,
        description: "API调用: /relay/proxy/v1/responses",
        model: "gpt-5.4",
        pricingType: "per-request",
        fixedPrice: 0.25,
      },
    });

    const allTxRes = await request(app)
      .get(`/v1/balance/transactions/all?userId=${targetUserId}&limit=100&offset=0`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(allTxRes.status).toBe(200);
    const record = (allTxRes.body.data.records as Array<Record<string, unknown>>).find(
      (item) => item.id === transaction.id,
    );
    expect(record).toBeTruthy();
    expect(record).toEqual(
      expect.objectContaining({
        pricingType: "per-request",
        fixedPrice: 0.25,
      }),
    );
  });

  it("restores old physical names while preserving new logical channel snapshots", async () => {
    const relayToken = await prisma.relayToken.create({
      data: {
        userId: targetUserId,
        token: `balance_snapshot_${shortSuffix}_${Date.now()}`,
      },
    });
    relayTokenIds.push(relayToken.id);

    const [linkedLogicalUsage, linkedMonthlyPassUsage, conflictingMonthlyPassUsage, placeholderOnlyUsage] =
      await Promise.all([
        prisma.relayUsage.create({
          data: {
            relayTokenId: relayToken.id,
            displayChannelId: "linked-logical-channel-id",
            displayChannelName: "Linked Logical Pool",
            path: "/relay/proxy/v1/chat/completions",
            method: "POST",
            statusCode: 200,
            ipAddress: "127.0.0.1",
          },
        }),
        prisma.relayUsage.create({
          data: {
            relayTokenId: relayToken.id,
            displayChannelId: "guessed-monthly-pass-pool-id",
            displayChannelName: "历史混池渠道",
            path: "/relay/proxy/v1/chat/completions",
            method: "POST",
            statusCode: 200,
            ipAddress: "127.0.0.1",
          },
        }),
        prisma.relayUsage.create({
          data: {
            relayTokenId: relayToken.id,
            path: "/relay/proxy/v1/chat/completions",
            method: "POST",
            statusCode: 200,
            ipAddress: "127.0.0.1",
          },
        }),
        prisma.relayUsage.create({
          data: {
            relayTokenId: relayToken.id,
            displayChannelName: "历史渠道（未记录）",
            path: "/relay/proxy/v1/chat/completions",
            method: "POST",
            statusCode: 200,
            ipAddress: "127.0.0.1",
          },
        }),
      ]);

    const monthlyPassTemplate = await prisma.monthlyPassTemplate.create({
      data: {
        name: `Balance History ${shortSuffix} Template`,
        defaultQuota: 10,
        quotaUnit: "amount",
      },
    });
    const userMonthlyPass = await prisma.userMonthlyPass.create({
      data: {
        userId: targetUserId,
        templateId: monthlyPassTemplate.id,
        startAt: new Date(Date.now() - 60_000),
        endAt: new Date(Date.now() + 60 * 60 * 1000),
        totalQuota: 10,
        remainingQuota: 10,
        usedQuota: 0,
        quotaUnit: "amount",
      },
    });
    await prisma.monthlyPassUsage.createMany({
      data: [
        {
          userMonthlyPassId: userMonthlyPass.id,
          userId: targetUserId,
          relayUsageId: linkedMonthlyPassUsage.id,
          channelName: "Recovered Monthly Pass Member",
          coveredAmount: 0.1,
          totalRequestCost: 0.1,
          remainingRequestCost: 0,
        },
        {
          userMonthlyPassId: userMonthlyPass.id,
          userId: targetUserId,
          relayUsageId: conflictingMonthlyPassUsage.id,
          channelName: "Conflicting Member A",
          coveredAmount: 0.1,
          totalRequestCost: 0.1,
          remainingRequestCost: 0,
        },
        {
          userMonthlyPassId: userMonthlyPass.id,
          userId: targetUserId,
          relayUsageId: conflictingMonthlyPassUsage.id,
          channelName: "Conflicting Member B",
          coveredAmount: 0.1,
          totalRequestCost: 0.1,
          remainingRequestCost: 0,
        },
      ],
    });

    const baseTransaction = {
      userId: targetUserId,
      type: "api_usage",
      amount: -0.1,
      balanceBefore: 87.9598,
      balanceAfter: 87.8598,
    };
    const [legacyTransaction, logicalTransaction, linkedLogicalTransaction, linkedMonthlyPassTransaction] =
      await Promise.all([
        prisma.balanceTransaction.create({
          data: {
            ...baseTransaction,
            channelName: "Original Physical Member",
            displayChannelId: "guessed-pool-id",
            displayChannelName: "历史混池渠道",
          },
        }),
        prisma.balanceTransaction.create({
          data: {
            ...baseTransaction,
            displayChannelId: "logical-pool-id",
            displayChannelName: "Current Logical Pool",
          },
        }),
        prisma.balanceTransaction.create({
          data: { ...baseTransaction, relatedId: linkedLogicalUsage.id },
        }),
        prisma.balanceTransaction.create({
          data: { ...baseTransaction, relatedId: linkedMonthlyPassUsage.id },
        }),
      ]);
    const [conflictingMonthlyPassTransaction, placeholderOnlyTransaction, unrelatedTransaction] = await Promise.all([
      prisma.balanceTransaction.create({
        data: { ...baseTransaction, relatedId: conflictingMonthlyPassUsage.id },
      }),
      prisma.balanceTransaction.create({
        data: { ...baseTransaction, relatedId: placeholderOnlyUsage.id },
      }),
      prisma.balanceTransaction.create({
        data: { ...baseTransaction, relatedId: `non-relay-${shortSuffix}` },
      }),
    ]);

    const allTxRes = await request(app)
      .get(`/v1/balance/transactions/all?userId=${targetUserId}&limit=100&offset=0`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(allTxRes.status).toBe(200);
    const records = allTxRes.body.data.records as Array<Record<string, unknown>>;
    const recordById = new Map(records.map((record) => [record.id, record]));

    expect(recordById.get(legacyTransaction.id)?.displayChannelName).toBe("Original Physical Member");
    expect(recordById.get(logicalTransaction.id)?.displayChannelName).toBe("Current Logical Pool");
    expect(recordById.get(linkedLogicalTransaction.id)?.displayChannelName).toBe("Linked Logical Pool");
    expect(recordById.get(linkedMonthlyPassTransaction.id)?.displayChannelName).toBe("Recovered Monthly Pass Member");
    expect(recordById.get(conflictingMonthlyPassTransaction.id)?.displayChannelName).toBeUndefined();
    expect(recordById.get(placeholderOnlyTransaction.id)?.displayChannelName).toBeUndefined();
    expect(recordById.get(unrelatedTransaction.id)?.displayChannelName).toBeUndefined();
  });

  it("uses automatic pool names and hides unresolved hidden members in balance history", async () => {
    const [automaticPool, hiddenMember] = await Promise.all([
      prisma.relayChannel.create({
        data: {
          name: `Automatic Pool ${shortSuffix}`,
          channelType: "automatic-proxy-pool",
          allowedFormats: "openai",
        },
      }),
      prisma.relayChannel.create({
        data: {
          name: `Hidden Member ${shortSuffix}`,
          visibilityMode: "hidden",
          allowedFormats: "openai",
        },
      }),
    ]);
    relayChannelIds.push(automaticPool.id, hiddenMember.id);

    const [automaticToken, orderedToken] = await Promise.all([
      prisma.relayToken.create({
        data: {
          userId: targetUserId,
          token: `balance_auto_pool_${shortSuffix}_${Date.now()}`,
          routingMode: "automatic-pool",
          automaticProxyPoolChannelId: automaticPool.id,
        },
      }),
      prisma.relayToken.create({
        data: {
          userId: targetUserId,
          token: `balance_hidden_member_${shortSuffix}_${Date.now()}`,
        },
      }),
    ]);
    relayTokenIds.push(automaticToken.id, orderedToken.id);

    const automaticLogicalRequest = await prisma.relayLogicalRequest.create({
      data: {
        relayTokenId: automaticToken.id,
        requestId: `balance-request-${shortSuffix}-${Date.now()}`,
      },
    });

    const [automaticUsage, unresolvedUsage] = await Promise.all([
      prisma.relayUsage.create({
        data: {
          relayTokenId: automaticToken.id,
          logicalRequestId: automaticLogicalRequest.id,
          executionChannelId: hiddenMember.id,
          displayChannelId: hiddenMember.id,
          displayChannelName: hiddenMember.name,
          path: "/relay/proxy/v1/chat/completions",
          method: "POST",
          statusCode: 200,
          ipAddress: "127.0.0.1",
        },
      }),
      prisma.relayUsage.create({
        data: {
          relayTokenId: orderedToken.id,
          executionChannelId: hiddenMember.id,
          displayChannelId: hiddenMember.id,
          displayChannelName: hiddenMember.name,
          path: "/relay/proxy/v1/chat/completions",
          method: "POST",
          statusCode: 200,
          ipAddress: "127.0.0.1",
        },
      }),
    ]);

    const [automaticTransaction, unresolvedTransaction] = await Promise.all([
      prisma.balanceTransaction.create({
        data: {
          userId: targetUserId,
          type: "api_usage",
          amount: -0.1,
          balanceBefore: 10,
          balanceAfter: 9.9,
          relatedId: automaticUsage.id,
          displayChannelId: hiddenMember.id,
          displayChannelName: hiddenMember.name,
        },
      }),
      prisma.balanceTransaction.create({
        data: {
          userId: targetUserId,
          type: "api_usage",
          amount: -0.1,
          balanceBefore: 9.9,
          balanceAfter: 9.8,
          relatedId: unresolvedUsage.id,
          displayChannelId: hiddenMember.id,
          displayChannelName: hiddenMember.name,
        },
      }),
    ]);

    const response = await request(app)
      .get(`/v1/balance/transactions/all?userId=${targetUserId}&limit=100&offset=0`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    const recordById = new Map(
      (response.body.data.records as Array<Record<string, unknown>>).map((record) => [record.id, record]),
    );
    expect(recordById.get(automaticTransaction.id)?.displayChannelName).toBe(automaticPool.name);
    expect(recordById.get(automaticTransaction.id)?.requestId).toBe(automaticLogicalRequest.requestId);
    expect(recordById.get(unresolvedTransaction.id)?.displayChannelName).toBeUndefined();
  });

  it("rejects balance transaction queries larger than 30 days", async () => {
    const tooEarlyStartTime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const endTime = new Date().toISOString();
    const validStartTime = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();

    const myTransactionsResponse = await request(app)
      .get(
        `/v1/balance/transactions?startTime=${encodeURIComponent(tooEarlyStartTime)}&endTime=${encodeURIComponent(endTime)}`,
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(myTransactionsResponse.status).toBe(422);
    expect(JSON.stringify(myTransactionsResponse.body)).toContain("query time range must not exceed 30 days");

    const allTransactionsResponse = await request(app)
      .get(
        `/v1/balance/transactions/all?userId=${targetUserId}&startTime=${encodeURIComponent(tooEarlyStartTime)}&endTime=${encodeURIComponent(endTime)}`,
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(allTransactionsResponse.status).toBe(422);

    const validRangeResponse = await request(app)
      .get(
        `/v1/balance/transactions?startTime=${encodeURIComponent(validStartTime)}&endTime=${encodeURIComponent(endTime)}`,
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(validRangeResponse.status).toBe(200);
  });
});
