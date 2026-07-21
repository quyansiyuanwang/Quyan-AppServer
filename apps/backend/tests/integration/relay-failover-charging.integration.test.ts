import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import { prisma } from "../../src/config/database";
import { hashPassword } from "../../src/util/crypto";
import { createRelayAIMockPlugin, RelayAIMockPlugin } from "../util/relay-ai-mock-plugin";

describe("Relay Failover Charging Integration Tests", () => {
  let app: Express;
  let relayAIMockPlugin: RelayAIMockPlugin | null = null;
  let secondaryMockPlugin: RelayAIMockPlugin | null = null;

  let testGroupId = "";
  let testUserId = "";
  let primaryChannelId = "";
  let secondaryChannelId = "";
  let failoverTokenId = "";
  let failoverTokenValue = "";

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const shortSuffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)}`;
  const testModel = `test-failover-model-${suffix}`;
  const testModelId = `test-failover-model-id-${suffix}`;
  const testGroupUsername = `tfg_${shortSuffix}`;
  const testUsername = `tfu_${shortSuffix}`;
  const secondaryOnlyMonthlyPassTemplateName = `test_failover_mp_secondary_${suffix}`;
  const primaryOnlyMonthlyPassTemplateName = `test_failover_mp_primary_${suffix}`;

  const resetFailoverBillingState = async () => {
    relayAIMockPlugin?.clearErrorMode();
    secondaryMockPlugin?.clearErrorMode();

    await prisma.monthlyPassUsage.deleteMany({ where: { userId: testUserId } });
    await prisma.userMonthlyPass.deleteMany({ where: { userId: testUserId } });
    await prisma.monthlyPassTemplate.deleteMany({
      where: {
        name: {
          in: [secondaryOnlyMonthlyPassTemplateName, primaryOnlyMonthlyPassTemplateName],
        },
      },
    });
    await prisma.relayUsage.deleteMany({ where: { relayTokenId: failoverTokenId } });
    await prisma.balanceTransaction.deleteMany({ where: { userId: testUserId } });
    await prisma.relayChannelSwitchLog.deleteMany({ where: { relayTokenId: failoverTokenId } });
    await prisma.balanceAccount.update({
      where: { userId: testUserId },
      data: {
        balance: 1000,
        totalRecharged: 1000,
        totalUsed: 0,
      },
    });
  };

  const assignMonthlyPassForTest = async (templateName: string, allowedChannels: string[]) => {
    const template = await prisma.monthlyPassTemplate.create({
      data: {
        name: templateName,
        defaultQuota: 10,
        quotaUnit: "amount",
        allowedModels: JSON.stringify([testModel]),
        allowedChannels: JSON.stringify(allowedChannels),
      },
    });

    const userPass = await prisma.userMonthlyPass.create({
      data: {
        userId: testUserId,
        templateId: template.id,
        startAt: new Date(Date.now() - 60 * 1000),
        endAt: new Date(Date.now() + 60 * 60 * 1000),
        totalQuota: 10,
        remainingQuota: 10,
        usedQuota: 0,
        quotaUnit: "amount",
      },
    });

    return { template, userPass };
  };

  beforeAll(async () => {
    app = createApp();

    // Create primary mock server (will return 500 errors)
    relayAIMockPlugin = createRelayAIMockPlugin({
      defaultModel: testModelId,
      contentPrefix: "Primary-",
    });
    await relayAIMockPlugin.start();

    // Create secondary mock server (will succeed)
    secondaryMockPlugin = createRelayAIMockPlugin({
      defaultModel: testModelId,
      contentPrefix: "Secondary-",
    });
    await secondaryMockPlugin.start();

    // Create test group
    testGroupId = (
      await prisma.group.create({
        data: {
          username: testGroupUsername,
          name: "Failover Test Group",
          level: 1,
          permissions: JSON.stringify([]),
        },
      })
    ).id;

    // Create test user
    testUserId = (
      await prisma.user.create({
        data: {
          username: testUsername,
          password: hashPassword("test_password"),
          name: "Failover Test User",
          groupId: testGroupId,
          permissionAdds: JSON.stringify([]),
          permissionRemoves: JSON.stringify([]),
        },
      })
    ).id;

    // Create balance account
    await prisma.balanceAccount.create({
      data: {
        userId: testUserId,
        balance: 1000,
        totalRecharged: 1000,
        totalUsed: 0,
      },
    });

    // Create model pricing (token-based)
    await prisma.modelPricing.create({
      data: {
        model: testModel,
        provider: testModelId,
        pricingType: "token-based",
        inputPrice: 1,
        outputPrice: 2,
        supportedFormats: "openai",
      },
    });

    // Create per-request pricing model
    await prisma.modelPricing.create({
      data: {
        model: `${testModel}-per-request`,
        provider: `${testModelId}-per-request`,
        pricingType: "per-request",
        inputPrice: 0,
        outputPrice: 0,
        fixedPrice: 0.5,
        supportedFormats: "openai",
      },
    });

    // Create primary channel (will fail)
    primaryChannelId = (
      await prisma.relayChannel.create({
        data: {
          name: "Primary Channel (Fails)",
          openaiUpstreamUrl: relayAIMockPlugin.baseUrl,
          openaiUpstreamApiKey: "test-key-primary",
          multiplier: 1.0,
          allowedFormats: "openai",
          allowedModels: JSON.stringify([testModel, `${testModel}-per-request`]),
        },
      })
    ).id;

    // Create secondary channel (will succeed)
    secondaryChannelId = (
      await prisma.relayChannel.create({
        data: {
          name: "Secondary Channel (Success)",
          openaiUpstreamUrl: secondaryMockPlugin.baseUrl,
          openaiUpstreamApiKey: "test-key-secondary",
          multiplier: 1.0,
          allowedFormats: "openai",
          allowedModels: JSON.stringify([testModel, `${testModel}-per-request`]),
        },
      })
    ).id;

    // Create relay token with failover config
    const tokenRecord = await prisma.relayToken.create({
      data: {
        userId: testUserId,
        name: "Failover Test Token",
        token: `rlt_failover_test_${suffix}`,
        channelId: null, // Use multi-channel config instead of legacy single channel
      },
    });
    failoverTokenId = tokenRecord.id;
    failoverTokenValue = tokenRecord.token;

    // Create failover config
    await prisma.relayTokenFailoverConfig.create({
      data: {
        relayTokenId: failoverTokenId,
        enabled: true,
        maxRetries: 2,
        retryStatusCodes: ["5xx"],
      },
    });

    // Create channel configs (primary first, secondary as backup)
    await prisma.relayTokenChannelConfig.createMany({
      data: [
        {
          relayTokenId: failoverTokenId,
          channelId: primaryChannelId,
          priority: 0,
        },
        {
          relayTokenId: failoverTokenId,
          channelId: secondaryChannelId,
          priority: 1,
        },
      ],
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.monthlyPassUsage.deleteMany({ where: { userId: testUserId } });
    await prisma.userMonthlyPass.deleteMany({ where: { userId: testUserId } });
    await prisma.monthlyPassTemplate.deleteMany({
      where: {
        name: {
          in: [secondaryOnlyMonthlyPassTemplateName, primaryOnlyMonthlyPassTemplateName],
        },
      },
    });
    await prisma.relayTokenChannelConfig.deleteMany({ where: { relayTokenId: failoverTokenId } });
    await prisma.relayTokenFailoverConfig.deleteMany({ where: { relayTokenId: failoverTokenId } });
    await prisma.relayUsage.deleteMany({ where: { relayTokenId: failoverTokenId } });
    await prisma.balanceTransaction.deleteMany({ where: { userId: testUserId } });
    await prisma.relayToken.deleteMany({ where: { id: failoverTokenId } });
    await prisma.relayChannel.deleteMany({ where: { id: { in: [primaryChannelId, secondaryChannelId] } } });
    await prisma.modelPricing.deleteMany({ where: { model: { startsWith: testModel } } });
    await prisma.balanceAccount.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
    await prisma.group.deleteMany({ where: { id: testGroupId } });

    if (relayAIMockPlugin) await relayAIMockPlugin.stop();
    if (secondaryMockPlugin) await secondaryMockPlugin.stop();
  });

  it("should record failed attempt with primary channel and successful attempt with secondary channel (token-based pricing)", async () => {
    // Clear both servers first
    relayAIMockPlugin!.clearErrorMode();
    secondaryMockPlugin!.clearErrorMode();

    // Configure primary server to return 500 error
    relayAIMockPlugin!.setErrorMode(500, "Internal Server Error");

    // Make request
    const response = await request(app)
      .post("/relay/proxy/chat/completions")
      .set("Authorization", `Bearer ${failoverTokenValue}`)
      .send({
        model: testModelId,
        messages: [{ role: "user", content: "test" }],
      });

    expect(response.status).toBe(200);
    expect(response.body.choices[0].message.content).toContain("Secondary-");

    // Wait for usage records
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check usage records
    const usageRecords = await prisma.relayUsage.findMany({
      where: { relayTokenId: failoverTokenId },
      orderBy: { createTime: "asc" },
    });

    expect(usageRecords.length).toBe(2);

    // First record: failed attempt on primary channel
    expect(usageRecords[0].statusCode).toBe(500);
    expect(usageRecords[0].totalTokens).toBe(0);

    // Second record: successful attempt on secondary channel
    expect(usageRecords[1].statusCode).toBe(200);
    expect(usageRecords[1].totalTokens).toBeGreaterThan(0);

    // Check balance transactions
    const transactions = await prisma.balanceTransaction.findMany({
      where: { userId: testUserId },
      orderBy: { createTime: "asc" },
    });

    expect(transactions.length).toBe(2);

    // First transaction: zero charge with the logical display-channel snapshot
    expect(transactions[0].amount.toNumber()).toBe(0);
    expect(transactions[0].displayChannelName).toBe("Primary Channel (Fails)");

    // Second transaction: actual charge with the logical display-channel snapshot
    expect(transactions[1].amount.toNumber()).toBeLessThan(0);
    expect(transactions[1].displayChannelName).toBe("Secondary Channel (Success)");

    // Check switch log
    const switchLogs = await prisma.relayChannelSwitchLog.findMany({
      where: { relayTokenId: failoverTokenId },
    });

    expect(switchLogs.length).toBe(1);
    expect(switchLogs[0].fromChannelId).toBe(primaryChannelId);
    expect(switchLogs[0].toChannelId).toBe(secondaryChannelId);
    expect(switchLogs[0].triggerStatusCode).toBe(500);
  });

  it("should record failed attempt with primary channel and successful attempt with secondary channel (per-request pricing)", async () => {
    // Clean up previous test data
    await prisma.relayUsage.deleteMany({ where: { relayTokenId: failoverTokenId } });
    await prisma.balanceTransaction.deleteMany({ where: { userId: testUserId } });
    await prisma.relayChannelSwitchLog.deleteMany({ where: { relayTokenId: failoverTokenId } });

    // Configure primary server to return 500 error
    relayAIMockPlugin!.setErrorMode(500, "Internal Server Error");
    // Ensure secondary server is working normally
    secondaryMockPlugin!.clearErrorMode();

    // Make request with per-request pricing model
    const response = await request(app)
      .post("/relay/proxy/chat/completions")
      .set("Authorization", `Bearer ${failoverTokenValue}`)
      .send({
        model: `${testModelId}-per-request`,
        messages: [{ role: "user", content: "test" }],
      });

    expect(response.status).toBe(200);
    expect(response.body.choices[0].message.content).toContain("Secondary-");

    // Wait for usage records
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check usage records
    const usageRecords = await prisma.relayUsage.findMany({
      where: { relayTokenId: failoverTokenId },
      orderBy: { createTime: "asc" },
    });

    expect(usageRecords.length).toBe(2);

    // First record: failed attempt on primary channel
    expect(usageRecords[0].statusCode).toBe(500);
    expect(usageRecords[0].totalTokens).toBe(0);

    // Second record: successful attempt on secondary channel
    expect(usageRecords[1].statusCode).toBe(200);

    // Check balance transactions
    const transactions = await prisma.balanceTransaction.findMany({
      where: { userId: testUserId },
      orderBy: { createTime: "asc" },
    });

    expect(transactions.length).toBe(2);

    // First transaction: zero charge with the logical display-channel snapshot
    expect(transactions[0].amount.toNumber()).toBe(0);
    expect(transactions[0].displayChannelName).toBe("Primary Channel (Fails)");
    expect(transactions[0].inputRate?.toNumber()).toBe(0);
    expect(transactions[0].outputRate?.toNumber()).toBe(0);

    // Second transaction: fixed charge with the logical display-channel snapshot
    expect(transactions[1].amount.toNumber()).toBe(-0.5); // Fixed price
    expect(transactions[1].displayChannelName).toBe("Secondary Channel (Success)");
    expect(transactions[1].inputRate?.toNumber()).toBe(0);
    expect(transactions[1].outputRate?.toNumber()).toBe(0);
  });

  it("should record all failed attempts when all channels fail", async () => {
    // Clean up previous test data
    await prisma.relayUsage.deleteMany({ where: { relayTokenId: failoverTokenId } });
    await prisma.balanceTransaction.deleteMany({ where: { userId: testUserId } });
    await prisma.relayChannelSwitchLog.deleteMany({ where: { relayTokenId: failoverTokenId } });

    // Configure both servers to return 500 error
    relayAIMockPlugin!.setErrorMode(500, "Primary Server Error");
    secondaryMockPlugin!.setErrorMode(503, "Secondary Server Error");

    // Make request
    const response = await request(app)
      .post("/relay/proxy/chat/completions")
      .set("Authorization", `Bearer ${failoverTokenValue}`)
      .send({
        model: testModelId,
        messages: [{ role: "user", content: "test" }],
      });

    // Should return error
    expect(response.status).toBeGreaterThanOrEqual(400);

    // Wait for usage records
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check usage records - should have 2 failed attempts
    const usageRecords = await prisma.relayUsage.findMany({
      where: { relayTokenId: failoverTokenId },
      orderBy: { createTime: "asc" },
    });

    expect(usageRecords.length).toBe(2);

    // First record: failed attempt on primary channel
    expect(usageRecords[0].statusCode).toBe(500);
    expect(usageRecords[0].totalTokens).toBe(0);

    // Second record: failed attempt on secondary channel
    expect(usageRecords[1].statusCode).toBe(503);
    expect(usageRecords[1].totalTokens).toBe(0);

    // Check balance transactions - both should be zero charge
    const transactions = await prisma.balanceTransaction.findMany({
      where: { userId: testUserId },
      orderBy: { createTime: "asc" },
    });

    expect(transactions.length).toBe(2);
    expect(transactions[0].amount.toNumber()).toBe(0);
    expect(transactions[0].displayChannelName).toBe("Primary Channel (Fails)");
    expect(transactions[1].amount.toNumber()).toBe(0);
    expect(transactions[1].displayChannelName).toBe("Secondary Channel (Success)");

    // Check switch log
    const switchLogs = await prisma.relayChannelSwitchLog.findMany({
      where: { relayTokenId: failoverTokenId },
    });

    expect(switchLogs.length).toBe(1);
    expect(switchLogs[0].fromChannelId).toBe(primaryChannelId);
    expect(switchLogs[0].toChannelId).toBe(secondaryChannelId);
    expect(switchLogs[0].triggerStatusCode).toBe(500);
  });

  it("should not failover when status code does not match retry configuration", async () => {
    // Clean up previous test data
    await prisma.relayUsage.deleteMany({ where: { relayTokenId: failoverTokenId } });
    await prisma.balanceTransaction.deleteMany({ where: { userId: testUserId } });
    await prisma.relayChannelSwitchLog.deleteMany({ where: { relayTokenId: failoverTokenId } });

    // Configure primary server to return 400 error (not in retry list)
    relayAIMockPlugin!.setErrorMode(400, "Bad Request");

    // Make request
    const response = await request(app)
      .post("/relay/proxy/chat/completions")
      .set("Authorization", `Bearer ${failoverTokenValue}`)
      .send({
        model: testModelId,
        messages: [{ role: "user", content: "test" }],
      });

    // Should return 400 error without failover
    expect(response.status).toBe(400);

    // Wait for usage records
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check usage records - should have only 1 record
    const usageRecords = await prisma.relayUsage.findMany({
      where: { relayTokenId: failoverTokenId },
      orderBy: { createTime: "asc" },
    });

    expect(usageRecords.length).toBe(1);
    expect(usageRecords[0].statusCode).toBe(400);

    // Check balance transactions - should have only 1 transaction
    const transactions = await prisma.balanceTransaction.findMany({
      where: { userId: testUserId },
      orderBy: { createTime: "asc" },
    });

    expect(transactions.length).toBe(1);
    expect(transactions[0].amount.toNumber()).toBe(0);
    expect(transactions[0].displayChannelName).toBe("Primary Channel (Fails)");

    // Check switch log - should be empty
    const switchLogs = await prisma.relayChannelSwitchLog.findMany({
      where: { relayTokenId: failoverTokenId },
    });

    expect(switchLogs.length).toBe(0);
  });

  it("should not failover when failover is disabled", async () => {
    // Clean up previous test data
    await prisma.relayUsage.deleteMany({ where: { relayTokenId: failoverTokenId } });
    await prisma.balanceTransaction.deleteMany({ where: { userId: testUserId } });
    await prisma.relayChannelSwitchLog.deleteMany({ where: { relayTokenId: failoverTokenId } });

    // Disable failover
    await prisma.relayTokenFailoverConfig.update({
      where: { relayTokenId: failoverTokenId },
      data: { enabled: false },
    });

    // Configure primary server to return 500 error
    relayAIMockPlugin!.setErrorMode(500, "Internal Server Error");

    // Make request
    const response = await request(app)
      .post("/relay/proxy/chat/completions")
      .set("Authorization", `Bearer ${failoverTokenValue}`)
      .send({
        model: testModelId,
        messages: [{ role: "user", content: "test" }],
      });

    // Should return 500 error without failover
    expect(response.status).toBe(500);

    // Wait for usage records
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check usage records - should have only 1 record
    const usageRecords = await prisma.relayUsage.findMany({
      where: { relayTokenId: failoverTokenId },
      orderBy: { createTime: "asc" },
    });

    expect(usageRecords.length).toBe(1);
    expect(usageRecords[0].statusCode).toBe(500);

    // Check balance transactions - should have only 1 transaction
    const transactions = await prisma.balanceTransaction.findMany({
      where: { userId: testUserId },
      orderBy: { createTime: "asc" },
    });

    expect(transactions.length).toBe(1);
    expect(transactions[0].amount.toNumber()).toBe(0);
    expect(transactions[0].displayChannelName).toBe("Primary Channel (Fails)");

    // Check switch log - should be empty
    const switchLogs = await prisma.relayChannelSwitchLog.findMany({
      where: { relayTokenId: failoverTokenId },
    });

    expect(switchLogs.length).toBe(0);

    // Re-enable failover for other tests
    await prisma.relayTokenFailoverConfig.update({
      where: { relayTokenId: failoverTokenId },
      data: { enabled: true },
    });
  });

  it("rejects insufficient balance before contacting any failover channel", async () => {
    // Clean up previous test data
    await prisma.relayUsage.deleteMany({ where: { relayTokenId: failoverTokenId } });
    await prisma.balanceTransaction.deleteMany({ where: { userId: testUserId } });
    await prisma.relayChannelSwitchLog.deleteMany({ where: { relayTokenId: failoverTokenId } });

    // Set balance to zero: the proxy must reject before contacting the primary channel.
    await prisma.balanceAccount.update({
      where: { userId: testUserId },
      data: { balance: 0 },
    });

    // These upstream settings must be irrelevant because no upstream call is allowed.
    relayAIMockPlugin!.setErrorMode(500, "Internal Server Error");
    // Secondary server will succeed
    secondaryMockPlugin!.clearErrorMode();

    // Make request
    const response = await request(app)
      .post("/relay/proxy/chat/completions")
      .set("Authorization", `Bearer ${failoverTokenValue}`)
      .send({
        model: testModelId,
        messages: [{ role: "user", content: "test" }],
      });

    // Should return insufficient balance error
    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Insufficient balance");

    // No attempt is billed or logged because no upstream request was issued.
    const usageRecords = await prisma.relayUsage.findMany({
      where: { relayTokenId: failoverTokenId },
      orderBy: { createTime: "asc" },
    });

    expect(usageRecords).toHaveLength(0);

    // No failover is attempted when the request is ineligible to start.
    const switchLogs = await prisma.relayChannelSwitchLog.findMany({
      where: { relayTokenId: failoverTokenId },
    });
    expect(switchLogs).toHaveLength(0);

    // Restore balance for other tests
    await prisma.balanceAccount.update({
      where: { userId: testUserId },
      data: { balance: 1000 },
    });
  });

  it("records the full charge when a started request exceeds the remaining positive balance", async () => {
    await resetFailoverBillingState();
    await prisma.balanceAccount.update({
      where: { userId: testUserId },
      data: { balance: 0.1, totalRecharged: 0.1, totalUsed: 0 },
    });

    const response = await request(app)
      .post("/relay/proxy/chat/completions")
      .set("Authorization", `Bearer ${failoverTokenValue}`)
      .send({
        model: `${testModelId}-per-request`,
        messages: [{ role: "user", content: "charge beyond the remaining balance" }],
      });

    expect(response.status).toBe(200);

    const [account, usage, transaction] = await Promise.all([
      prisma.balanceAccount.findUniqueOrThrow({ where: { userId: testUserId } }),
      prisma.relayUsage.findFirstOrThrow({
        where: { relayTokenId: failoverTokenId, statusCode: 200 },
        orderBy: { createTime: "desc" },
      }),
      prisma.balanceTransaction.findFirstOrThrow({
        where: { userId: testUserId, type: "api_usage", amount: { lt: 0 } },
        orderBy: { createTime: "desc" },
      }),
    ]);

    expect(account.balance.toNumber()).toBe(-0.4);
    expect(transaction.amount.toNumber()).toBe(-0.5);
    expect(transaction.relatedId).toBe(usage.id);
  });

  it("should apply monthly pass using the failover channel when backup channel is allowed", async () => {
    await resetFailoverBillingState();
    const { userPass } = await assignMonthlyPassForTest(secondaryOnlyMonthlyPassTemplateName, [secondaryChannelId]);

    relayAIMockPlugin!.setErrorMode(500, "Internal Server Error");
    secondaryMockPlugin!.clearErrorMode();

    const response = await request(app)
      .post("/relay/proxy/chat/completions")
      .set("Authorization", `Bearer ${failoverTokenValue}`)
      .send({
        model: testModelId,
        messages: [{ role: "user", content: "test failover monthly pass on backup channel" }],
      });

    expect(response.status).toBe(200);
    expect(response.body.choices[0].message.content).toContain("Secondary-");

    await new Promise((resolve) => setTimeout(resolve, 500));

    const monthlyPassUsages = await prisma.monthlyPassUsage.findMany({
      where: { userMonthlyPassId: userPass.id },
      orderBy: { createTime: "asc" },
    });
    expect(monthlyPassUsages.length).toBe(1);
    expect(monthlyPassUsages[0].channelId).toBe(secondaryChannelId);
    expect(monthlyPassUsages[0].displayChannelName).toBe("Secondary Channel (Success)");
    expect(monthlyPassUsages[0].coveredAmount.toNumber()).toBeGreaterThan(0);

    const passAfter = await prisma.userMonthlyPass.findUnique({ where: { id: userPass.id } });
    expect(passAfter).not.toBeNull();
    expect(passAfter!.usedQuota.toNumber()).toBeGreaterThan(0);
    expect(passAfter!.remainingQuota.toNumber()).toBeLessThan(10);

    const transactions = await prisma.balanceTransaction.findMany({
      where: { userId: testUserId },
      orderBy: { createTime: "asc" },
    });
    expect(transactions.length).toBe(2);
    expect(transactions[0].amount.toNumber()).toBe(0);
    expect(transactions[0].displayChannelName).toBe("Primary Channel (Fails)");
    expect(transactions[1].type).toBe("monthly_pass_coverage");
    expect(transactions[1].amount.toNumber()).toBe(0);
    expect(transactions[1].displayChannelName).toBe("Secondary Channel (Success)");

    const chargedTransactions = transactions.filter((item) => item.amount.toNumber() < 0);
    expect(chargedTransactions.length).toBe(0);

    const switchLogs = await prisma.relayChannelSwitchLog.findMany({
      where: { relayTokenId: failoverTokenId },
    });
    expect(switchLogs.length).toBe(1);
    expect(switchLogs[0].fromChannelId).toBe(primaryChannelId);
    expect(switchLogs[0].toChannelId).toBe(secondaryChannelId);
  });

  it("should charge balance when only the primary channel is covered but failover succeeds on backup channel", async () => {
    await resetFailoverBillingState();
    const { userPass } = await assignMonthlyPassForTest(primaryOnlyMonthlyPassTemplateName, [primaryChannelId]);

    relayAIMockPlugin!.setErrorMode(500, "Internal Server Error");
    secondaryMockPlugin!.clearErrorMode();

    const response = await request(app)
      .post("/relay/proxy/chat/completions")
      .set("Authorization", `Bearer ${failoverTokenValue}`)
      .send({
        model: testModelId,
        messages: [{ role: "user", content: "test failover should charge balance on backup channel" }],
      });

    expect(response.status).toBe(200);
    expect(response.body.choices[0].message.content).toContain("Secondary-");

    await new Promise((resolve) => setTimeout(resolve, 500));

    const monthlyPassUsageCount = await prisma.monthlyPassUsage.count({ where: { userMonthlyPassId: userPass.id } });
    expect(monthlyPassUsageCount).toBe(0);

    const passAfter = await prisma.userMonthlyPass.findUnique({ where: { id: userPass.id } });
    expect(passAfter).not.toBeNull();
    expect(passAfter!.usedQuota.toNumber()).toBe(0);
    expect(passAfter!.remainingQuota.toNumber()).toBe(10);

    const transactions = await prisma.balanceTransaction.findMany({
      where: { userId: testUserId },
      orderBy: { createTime: "asc" },
    });
    expect(transactions.length).toBe(2);
    expect(transactions[0].amount.toNumber()).toBe(0);
    expect(transactions[0].displayChannelName).toBe("Primary Channel (Fails)");
    expect(transactions[1].amount.toNumber()).toBeLessThan(0);
    expect(transactions[1].displayChannelName).toBe("Secondary Channel (Success)");
    expect(transactions[1].type).toBe("api_usage");

    const switchLogs = await prisma.relayChannelSwitchLog.findMany({
      where: { relayTokenId: failoverTokenId },
    });
    expect(switchLogs.length).toBe(1);
    expect(switchLogs[0].fromChannelId).toBe(primaryChannelId);
    expect(switchLogs[0].toChannelId).toBe(secondaryChannelId);
  });
});
