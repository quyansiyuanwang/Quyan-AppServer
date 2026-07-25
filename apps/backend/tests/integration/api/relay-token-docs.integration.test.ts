import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../../src/app";
import { prisma } from "../../../src/config/database";
import { hashPassword } from "../../../src/util/crypto";
import { MANAGED_STATUS } from "../../../src/constant/status";

describe("Relay Token Docs Helper Integration", () => {
  let app: Express;
  let testGroupId = "";
  let testUserId = "";
  let relayTokenId = "";
  let balanceAccountId = "";
  const relayUsageIds: string[] = [];
  const relayTokenValue = `rlt_docs_${Date.now().toString(16)}`;

  const shortSuffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)}`;
  const groupUsername = `rtdg_${shortSuffix}`;
  const username = `rtdu_${shortSuffix}`;

  beforeAll(async () => {
    app = createApp();

    const group = await prisma.group.create({
      data: {
        username: groupUsername,
        name: "Relay Token Docs Helper Test Group",
        level: 1,
        permissions: JSON.stringify([]),
      },
    });
    testGroupId = group.id;

    const user = await prisma.user.create({
      data: {
        username,
        password: hashPassword("test_password"),
        groupId: testGroupId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    testUserId = user.id;

    const balanceAccount = await prisma.balanceAccount.create({
      data: {
        userId: testUserId,
        balance: 23.45,
        totalRecharged: 23.45,
      },
    });
    balanceAccountId = balanceAccount.id;

    const relayToken = await prisma.relayToken.create({
      data: {
        userId: testUserId,
        name: "Docs Helper Token",
        token: relayTokenValue,
        status: MANAGED_STATUS.ENABLED,
        quotaLimit: 99,
        allowedModels: "gpt-5.4",
        quotaWindows: {
          create: [
            {
              quotaLimit: 10,
              quotaUnit: "amount",
              quotaWindowHours: 24,
            },
            {
              quotaLimit: 3,
              quotaUnit: "request",
              quotaWindowHours: 24,
            },
            {
              quotaLimit: 400,
              quotaUnit: "token",
              quotaWindowHours: 24,
            },
          ],
        },
      },
    });
    relayTokenId = relayToken.id;

    const recentUsageOne = await prisma.relayUsage.create({
      data: {
        relayTokenId,
        requestTokens: 60,
        responseTokens: 140,
        totalTokens: 200,
        path: "/relay/proxy/v1/chat/completions",
        method: "POST",
        statusCode: 200,
        ipAddress: "127.0.0.1",
      },
    });
    relayUsageIds.push(recentUsageOne.id);

    const recentUsageTwo = await prisma.relayUsage.create({
      data: {
        relayTokenId,
        requestTokens: 100,
        responseTokens: 200,
        totalTokens: 300,
        path: "/relay/proxy/v1/messages",
        method: "POST",
        statusCode: 200,
        ipAddress: "127.0.0.2",
      },
    });
    relayUsageIds.push(recentUsageTwo.id);

    const staleUsage = await prisma.relayUsage.create({
      data: {
        relayTokenId,
        requestTokens: 999,
        responseTokens: 999,
        totalTokens: 1998,
        path: "/relay/proxy/v1/chat/completions",
        method: "POST",
        statusCode: 200,
        ipAddress: "127.0.0.3",
        createTime: new Date(Date.now() - 26 * 60 * 60 * 1000),
      },
    });
    relayUsageIds.push(staleUsage.id);

    await prisma.relayLogicalRequest.createMany({
      data: [
        { relayTokenId, requestId: `docs-recent-one-${shortSuffix}`, countedAt: new Date() },
        { relayTokenId, requestId: `docs-recent-two-${shortSuffix}`, countedAt: new Date() },
      ],
    });

    await prisma.balanceTransaction.createMany({
      data: [
        {
          userId: testUserId,
          type: "api_usage",
          amount: -5,
          balanceBefore: 23.45,
          balanceAfter: 18.45,
          relatedId: recentUsageOne.id,
          description: "docs helper usage one",
        },
        {
          userId: testUserId,
          type: "api_usage",
          amount: -2.5,
          balanceBefore: 18.45,
          balanceAfter: 15.95,
          relatedId: recentUsageTwo.id,
          description: "docs helper usage two",
        },
        {
          userId: testUserId,
          type: "api_usage",
          amount: -99,
          balanceBefore: 15.95,
          balanceAfter: -83.05,
          relatedId: staleUsage.id,
          description: "docs helper stale usage",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.balanceTransaction.deleteMany({ where: { relatedId: { in: relayUsageIds } } });
    await prisma.relayUsage.deleteMany({ where: { relayTokenId } });
    await prisma.relayToken.deleteMany({ where: { id: relayTokenId } });
    await prisma.balanceAccount.deleteMany({ where: { id: balanceAccountId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
    await prisma.group.deleteMany({ where: { id: testGroupId } });
  });

  it("returns current relay token quota summary when called with an rlt bearer token", async () => {
    const response = await request(app)
      .get("/v2/relay/tokens/current/quota-summary")
      .set("Authorization", `Bearer ${relayTokenValue}`);

    expect(response.status).toBe(200);
    expect(response.body.code).toBe(0);
    expect(response.body.data).toMatchObject({
      scopedSummary: {
        relayTokenId,
        tokenName: "Docs Helper Token",
        quotaLimit: 99,
        usedQuota: 0,
        remainingQuota: 99,
        requestCount: 0,
        totalTokens: 0,
      },
      balance: 23.45,
      allowedModels: "gpt-5.4",
      quotaWindows: [
        {
          quotaLimit: 10,
          quotaUnit: "amount",
          quotaWindowHours: 24,
          usedQuota: 7.5,
          remainingQuota: 2.5,
          quotaUsagePercent: 75,
          isQuotaExceeded: false,
        },
        {
          quotaLimit: 3,
          quotaUnit: "request",
          quotaWindowHours: 24,
          usedQuota: 2,
          remainingQuota: 1,
          quotaUsagePercent: 66.66666666666666,
          isQuotaExceeded: false,
        },
        {
          quotaLimit: 400,
          quotaUnit: "token",
          quotaWindowHours: 24,
          usedQuota: 500,
          remainingQuota: 0,
          quotaUsagePercent: 125,
          isQuotaExceeded: true,
        },
      ],
    });
  });

  it("injects the relay token quota helper into the docs page", async () => {
    const response = await request(app).get("/docs/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Relay Token 额度助手");
    expect(response.text).toContain("/v1/relay/tokens/current/quota-summary");
  });
});
