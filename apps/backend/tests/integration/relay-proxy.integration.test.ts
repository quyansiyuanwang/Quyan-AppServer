import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "crypto";
import { createApp } from "../../src/app";
import { prisma } from "../../src/config/database";
import { hashPassword } from "../../src/util/crypto";
import { createRelayAIMockPlugin, RelayAIMockPlugin } from "../util/relay-ai-mock-plugin";

const RELAY_LOG_PERSISTENCE_TEST_TIMEOUT_MS = 15000;

describe("中转 AI 集成测试（插件化模拟上游）", () => {
  let app: Express;
  let relayAIMockPlugin: RelayAIMockPlugin | null = null;
  const apiLogRequestIds: string[] = [];

  let testGroupId = "";
  let testUserId = "";
  let openaiRelayChannelId = "";
  let openaiRelayTokenId = "";
  let openaiRelayTokenValue = "";
  let openaiFailoverPrimaryChannelId = "";
  let openaiFailoverSecondaryChannelId = "";
  let openaiFailoverTokenId = "";
  let openaiFailoverTokenValue = "";

  let anthropicRelayChannelId = "";
  let anthropicRelayTokenId = "";
  let anthropicRelayTokenValue = "";

  let geminiRelayChannelId = "";
  let geminiRelayTokenId = "";
  let geminiRelayTokenValue = "";

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const shortSuffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)}`;
  const openaiRelayModel = `test-relay-openai-${suffix}`;
  const openaiRelayModelId = `test-relay-openai-id-${suffix}`;
  const anthropicRelayModel = `test-relay-anthropic-${suffix}`;
  const anthropicRelayModelId = `test-relay-anthropic-id-${suffix}`;
  const geminiRelayModel = `test-relay-gemini-${suffix}`;
  const geminiRelayModelId = `test-relay-gemini-id-${suffix}`;
  const testGroupUsername = `trg_${shortSuffix}`;
  const testUsername = `tru_${shortSuffix}`;

  const waitForUsageCount = async (tokenId: string, expectedCount: number): Promise<void> => {
    for (let i = 0; i < 20; i += 1) {
      const count = await prisma.relayUsage.count({ where: { relayTokenId: tokenId } });
      if (count >= expectedCount) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  const getLatestUsage = async (tokenId: string, expectedCount: number) => {
    await waitForUsageCount(tokenId, expectedCount);
    const records = await prisma.relayUsage.findMany({
      where: { relayTokenId: tokenId },
      orderBy: { createTime: "asc" },
    });

    expect(records.length).toBe(expectedCount);
    return records[records.length - 1];
  };

  const getLatestBalanceTransaction = async (userId: string, expectedCount: number) => {
    for (let i = 0; i < 20; i += 1) {
      const count = await prisma.balanceTransaction.count({ where: { userId } });
      if (count >= expectedCount) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const records = await prisma.balanceTransaction.findMany({
      where: { userId },
      orderBy: { createTime: "asc" },
    });

    expect(records.length).toBe(expectedCount);
    return records[records.length - 1];
  };

  const getApiLogByRequestId = async (requestId: string) => {
    for (let i = 0; i < 60; i += 1) {
      const log = await prisma.aPILog.findUnique({ where: { requestID: requestId } });
      if (log) return log;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return null;
  };

  beforeAll(async () => {
    app = createApp();

    relayAIMockPlugin = createRelayAIMockPlugin({
      defaultModel: openaiRelayModelId,
      contentPrefix: "模拟AI输出-",
    });
    await relayAIMockPlugin.start();

    testGroupId = (
      await prisma.group.create({
        data: {
          username: testGroupUsername,
          name: "中转集成测试组",
          level: 1,
          permissions: JSON.stringify([]),
        },
      })
    ).id;

    testUserId = (
      await prisma.user.create({
        data: {
          username: testUsername,
          password: hashPassword("test_password"),
          name: "中转集成测试用户",
          email: `relay_${suffix}@test.com`,
          groupId: testGroupId,
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;

    await prisma.balanceAccount.create({
      data: {
        userId: testUserId,
        balance: 100,
        totalRecharged: 100,
        totalUsed: 0,
      },
    });

    openaiRelayChannelId = (
      await prisma.relayChannel.create({
        data: {
          name: `test_relay_openai_channel_${suffix}`,
          openaiUpstreamUrl: relayAIMockPlugin.baseUrl,
          openaiUpstreamApiKey: "test-openai-key",
          allowedFormats: "openai",
          multiplier: 1,
        },
      })
    ).id;

    anthropicRelayChannelId = (
      await prisma.relayChannel.create({
        data: {
          name: `test_relay_anthropic_channel_${suffix}`,
          anthropicUpstreamUrl: relayAIMockPlugin.baseUrl,
          anthropicUpstreamApiKey: "test-anthropic-key",
          allowedFormats: "anthropic",
          multiplier: 1,
        },
      })
    ).id;

    geminiRelayChannelId = (
      await prisma.relayChannel.create({
        data: {
          name: `test_relay_gemini_channel_${suffix}`,
          geminiUpstreamUrl: relayAIMockPlugin.baseUrl,
          geminiUpstreamApiKey: "test-gemini-key",
          allowedFormats: "gemini",
          multiplier: 1,
        },
      })
    ).id;

    openaiRelayTokenValue = `rlt_${randomUUID().replace(/-/g, "")}`;
    openaiRelayTokenId = (
      await prisma.relayToken.create({
        data: {
          userId: testUserId,
          name: `test_relay_openai_token_${suffix}`,
          token: openaiRelayTokenValue,
          channelId: openaiRelayChannelId,
        },
      })
    ).id;

    openaiFailoverPrimaryChannelId = (
      await prisma.relayChannel.create({
        data: {
          name: `test_relay_openai_failover_primary_${suffix}`,
          openaiUpstreamUrl: relayAIMockPlugin.baseUrl,
          openaiUpstreamApiKey: "test-openai-failover-primary-key",
          allowedFormats: "openai",
          multiplier: 1,
        },
      })
    ).id;

    openaiFailoverSecondaryChannelId = (
      await prisma.relayChannel.create({
        data: {
          name: `test_relay_openai_failover_secondary_${suffix}`,
          openaiUpstreamUrl: relayAIMockPlugin.baseUrl,
          openaiUpstreamApiKey: "test-openai-failover-secondary-key",
          allowedFormats: "openai",
          multiplier: 1,
        },
      })
    ).id;

    openaiFailoverTokenValue = `rlt_${randomUUID().replace(/-/g, "")}`;
    openaiFailoverTokenId = (
      await prisma.relayToken.create({
        data: {
          userId: testUserId,
          name: `test_relay_openai_failover_token_${suffix}`,
          token: openaiFailoverTokenValue,
          channelId: openaiFailoverPrimaryChannelId,
          failoverConfig: {
            create: {
              enabled: true,
              maxRetries: 1,
              retryStatusCodes: ["5xx"],
            },
          },
          channelConfigs: {
            create: [
              {
                channelId: openaiFailoverPrimaryChannelId,
                priority: 0,
              },
              {
                channelId: openaiFailoverSecondaryChannelId,
                priority: 1,
              },
            ],
          },
        },
      })
    ).id;

    anthropicRelayTokenValue = `rlt_${randomUUID().replace(/-/g, "")}`;
    anthropicRelayTokenId = (
      await prisma.relayToken.create({
        data: {
          userId: testUserId,
          name: `test_relay_anthropic_token_${suffix}`,
          token: anthropicRelayTokenValue,
          channelId: anthropicRelayChannelId,
        },
      })
    ).id;

    geminiRelayTokenValue = `rlt_${randomUUID().replace(/-/g, "")}`;
    geminiRelayTokenId = (
      await prisma.relayToken.create({
        data: {
          userId: testUserId,
          name: `test_relay_gemini_token_${suffix}`,
          token: geminiRelayTokenValue,
          channelId: geminiRelayChannelId,
        },
      })
    ).id;

    await prisma.modelPricing.create({
      data: {
        model: openaiRelayModel,
        provider: openaiRelayModelId,
        pricingType: "token-based",
        inputPrice: 10,
        outputPrice: 10,
        supportedFormats: "openai",
        status: 1,
      },
    });

    await prisma.modelPricing.create({
      data: {
        model: anthropicRelayModel,
        provider: anthropicRelayModelId,
        pricingType: "token-based",
        inputPrice: 10,
        outputPrice: 10,
        supportedFormats: "anthropic",
        status: 1,
      },
    });

    await prisma.modelPricing.create({
      data: {
        model: geminiRelayModel,
        provider: geminiRelayModelId,
        pricingType: "token-based",
        inputPrice: 10,
        outputPrice: 10,
        supportedFormats: "gemini",
        status: 1,
      },
    });
  });

  afterAll(async () => {
    if (relayAIMockPlugin) await relayAIMockPlugin.stop();

    if (apiLogRequestIds.length > 0)
      await prisma.aPILog.deleteMany({
        where: { requestID: { in: apiLogRequestIds } },
      });

    const relayTokenIds = [openaiRelayTokenId, openaiFailoverTokenId, anthropicRelayTokenId, geminiRelayTokenId].filter(
      (id) => Boolean(id),
    );
    const relayChannelIds = [
      openaiRelayChannelId,
      openaiFailoverPrimaryChannelId,
      openaiFailoverSecondaryChannelId,
      anthropicRelayChannelId,
      geminiRelayChannelId,
    ].filter((id) => Boolean(id));

    if (relayTokenIds.length > 0)
      await prisma.relayUsage.deleteMany({ where: { relayTokenId: { in: relayTokenIds } } });
    if (relayTokenIds.length > 0)
      await prisma.relayChannelSwitchLog.deleteMany({ where: { relayTokenId: { in: relayTokenIds } } });
    if (relayTokenIds.length > 0)
      await prisma.relayTokenChannelConfig.deleteMany({ where: { relayTokenId: { in: relayTokenIds } } });
    if (relayTokenIds.length > 0)
      await prisma.relayTokenFailoverConfig.deleteMany({ where: { relayTokenId: { in: relayTokenIds } } });
    if (relayTokenIds.length > 0) await prisma.relayToken.deleteMany({ where: { id: { in: relayTokenIds } } });
    if (relayChannelIds.length > 0) await prisma.relayChannel.deleteMany({ where: { id: { in: relayChannelIds } } });

    await prisma.modelPricing.deleteMany({
      where: {
        model: {
          in: [openaiRelayModel, anthropicRelayModel, geminiRelayModel],
        },
      },
    });

    if (testUserId) await prisma.balanceTransaction.deleteMany({ where: { userId: testUserId } });
    if (testUserId) await prisma.balanceAccount.deleteMany({ where: { userId: testUserId } });
    if (testUserId) await prisma.user.deleteMany({ where: { id: testUserId } });
    if (testGroupId) await prisma.group.deleteMany({ where: { id: testGroupId } });
  });

  it(
    "OpenAI 非流式中转返回模拟输出并记录 usage",
    async () => {
      const beforeCount = await prisma.relayUsage.count({ where: { relayTokenId: openaiRelayTokenId } });

      const relayResponse = await request(app)
        .post("/relay/proxy/v1/chat/completions")
        .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
        .send({
          model: openaiRelayModelId,
          messages: [{ role: "user", content: "你好，给一段简单回答" }],
          stream: false,
        });

      expect(relayResponse.status).toBe(200);
      expect(relayResponse.body?.choices?.[0]?.message?.content).toContain("模拟AI输出-");

      const requestId = String(relayResponse.headers["x-request-id"] || "");
      expect(requestId).toBeTruthy();
      apiLogRequestIds.push(requestId);

      const apiLog = await getApiLogByRequestId(requestId);
      expect(apiLog).toBeNull();

      const usage = await getLatestUsage(openaiRelayTokenId, beforeCount + 1);
      expect(usage?.isStreaming).toBe(false);
      expect(usage?.totalTokens ?? 0).toBeGreaterThan(0);
    },
    RELAY_LOG_PERSISTENCE_TEST_TIMEOUT_MS,
  );

  it("OpenAI 非流式上游错误会记录 usage 和 0 元消费流水，但不扣减余额", async () => {
    const beforeUsageCount = await prisma.relayUsage.count({ where: { relayTokenId: openaiRelayTokenId } });
    const beforeTransactionCount = await prisma.balanceTransaction.count({ where: { userId: testUserId } });
    const balanceBefore = await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: testUserId } });

    relayAIMockPlugin!.useOpenAI(async () => ({
      status: 502,
      body: { error: { message: "forced upstream failure for zero-charge integration" } },
    }));

    try {
      const relayResponse = await request(app)
        .post("/relay/proxy/v1/chat/completions")
        .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
        .send({
          model: openaiRelayModelId,
          messages: [{ role: "user", content: "请返回一个上游错误" }],
          stream: false,
        });

      expect(relayResponse.status).toBe(502);
      expect(String(relayResponse.body?.error?.message || "")).toContain(
        "forced upstream failure for zero-charge integration",
      );

      const usage = await getLatestUsage(openaiRelayTokenId, beforeUsageCount + 1);
      expect(usage?.statusCode).toBe(502);
      expect(usage?.isStreaming).toBe(false);
      expect(usage?.totalTokens).toBe(0);

      const latestTransaction = await getLatestBalanceTransaction(testUserId, beforeTransactionCount + 1);
      expect(latestTransaction.type).toBe("api_usage");
      expect(Number(latestTransaction.amount)).toBe(0);
      expect(Number(latestTransaction.balanceBefore)).toBe(Number(latestTransaction.balanceAfter));
      expect(String(latestTransaction.description || "")).toContain("未扣费");
      expect(latestTransaction.relatedId).toBe(usage?.id);

      const balanceAfter = await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: testUserId } });
      expect(Number(balanceAfter.balance)).toBe(Number(balanceBefore.balance));
      expect(Number(balanceAfter.totalUsed)).toBe(Number(balanceBefore.totalUsed));
    } finally {
      relayAIMockPlugin!.useOpenAI(async (ctx) => ({
        ...(ctx.body.stream === true
          ? relayAIMockPlugin!["buildOpenAIStreamReply"](ctx as any)
          : { body: relayAIMockPlugin!["buildOpenAIBody"](ctx as any) }),
      }));
    }
  });

  it("OpenAI 请求模型必须使用 provider（模型ID），不接受 model 字段", async () => {
    const strictModel = `test-relay-openai-strict-${suffix}`;
    const strictProvider = `test-relay-provider-${suffix}`;

    await prisma.modelPricing.create({
      data: {
        model: strictModel,
        provider: strictProvider,
        pricingType: "token-based",
        inputPrice: 10,
        outputPrice: 10,
        supportedFormats: "openai",
        status: 1,
      },
    });

    try {
      // Should accept request by provider (model ID)
      const acceptedByProvider = await request(app)
        .post("/relay/proxy/v1/chat/completions")
        .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
        .send({
          model: strictProvider,
          messages: [{ role: "user", content: "provider should be accepted as model ID" }],
          stream: false,
        });

      expect(acceptedByProvider.status).toBe(200);

      // Should reject request by model name
      const rejectedByModel = await request(app)
        .post("/relay/proxy/v1/chat/completions")
        .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
        .send({
          model: strictModel,
          messages: [{ role: "user", content: "model name should be rejected" }],
          stream: false,
        });

      expect(rejectedByModel.status).toBe(400);
      expect(String(rejectedByModel.body?.message || "")).toContain("not configured");
    } finally {
      await prisma.modelPricing.deleteMany({ where: { model: strictModel } });
    }
  });

  it("Relay token allow-list 必须按模型ID（provider）匹配", async () => {
    const strictModel = `test-relay-openai-id-only-${suffix}`;
    const strictProvider = `test-relay-provider-id-only-${suffix}`;

    await prisma.modelPricing.create({
      data: {
        model: strictModel,
        provider: strictProvider,
        pricingType: "token-based",
        inputPrice: 10,
        outputPrice: 10,
        supportedFormats: "openai",
        status: 1,
      },
    });

    try {
      // Set token allowlist to model ID (correct behavior)
      await prisma.relayToken.update({
        where: { id: openaiRelayTokenId },
        data: { allowedModels: strictProvider },
      });

      // Should accept request by model ID
      const acceptedByModelId = await request(app)
        .post("/relay/proxy/v1/chat/completions")
        .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
        .send({
          model: strictProvider,
          messages: [{ role: "user", content: "token allow-list should accept model ID" }],
          stream: false,
        });

      expect(acceptedByModelId.status).toBe(200);

      // Set token allowlist to different model ID - should reject
      await prisma.relayToken.update({
        where: { id: openaiRelayTokenId },
        data: { allowedModels: "different-model-id" },
      });

      const rejectedByDifferentId = await request(app)
        .post("/relay/proxy/v1/chat/completions")
        .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
        .send({
          model: strictProvider,
          messages: [{ role: "user", content: "should be rejected" }],
          stream: false,
        });

      expect(rejectedByDifferentId.status).toBe(400);
      expect(String(rejectedByDifferentId.body?.message || "")).toContain("Relay token does not allow model");
    } finally {
      await prisma.relayToken.update({
        where: { id: openaiRelayTokenId },
        data: { allowedModels: null },
      });
      await prisma.modelPricing.deleteMany({ where: { model: strictModel } });
    }
  });

  it("渠道白名单应该使用模型ID（provider）进行匹配", async () => {
    const strictModel = `test-relay-openai-channel-id-${suffix}`;
    const strictProvider = `test-relay-provider-channel-id-${suffix}`;

    await prisma.modelPricing.create({
      data: {
        model: strictModel,
        provider: strictProvider,
        pricingType: "token-based",
        inputPrice: 10,
        outputPrice: 10,
        supportedFormats: "openai",
        status: 1,
      },
    });

    try {
      // Set channel allowlist to model name (not model ID)
      await prisma.relayChannel.update({
        where: { id: openaiRelayChannelId },
        data: { allowedModels: JSON.stringify([strictModel]) },
      });

      await prisma.relayToken.update({
        where: { id: openaiRelayTokenId },
        data: { allowedModels: null },
      });

      // Should accept request by model ID
      const acceptedByModelId = await request(app)
        .post("/relay/proxy/v1/chat/completions")
        .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
        .send({
          model: strictProvider,
          messages: [{ role: "user", content: "channel should accept model ID" }],
          stream: false,
        });

      expect(acceptedByModelId.status).toBe(200);

      // Set channel allowlist to different model ID - should reject
      await prisma.relayChannel.update({
        where: { id: openaiRelayChannelId },
        data: { allowedModels: JSON.stringify(["different-model-id"]) },
      });

      const rejectedByDifferentId = await request(app)
        .post("/relay/proxy/v1/chat/completions")
        .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
        .send({
          model: strictProvider,
          messages: [{ role: "user", content: "should be rejected" }],
          stream: false,
        });

      expect(rejectedByDifferentId.status).toBe(400);
      expect(String(rejectedByDifferentId.body?.message || "")).toContain("does not support model");
    } finally {
      await prisma.relayChannel.update({
        where: { id: openaiRelayChannelId },
        data: { allowedModels: null },
      });
      await prisma.relayToken.update({
        where: { id: openaiRelayTokenId },
        data: { allowedModels: null },
      });
      await prisma.modelPricing.deleteMany({ where: { model: strictModel } });
    }
  });

  it("OpenAI models 列表只返回当前 token 在 openai 格式下真实可请求的模型", async () => {
    const extraOpenAIModel = `test-relay-openai-list-${suffix}`;
    const extraOpenAIModelId = `test-relay-openai-list-id-${suffix}`;

    await prisma.modelPricing.create({
      data: {
        model: extraOpenAIModel,
        provider: extraOpenAIModelId,
        pricingType: "token-based",
        inputPrice: 10,
        outputPrice: 10,
        supportedFormats: "openai",
        status: 1,
      },
    });

    try {
      const relayResponse = await request(app)
        .get("/relay/proxy/v1/models")
        .set("Authorization", `Bearer ${openaiRelayTokenValue}`);

      expect(relayResponse.status).toBe(200);

      const modelIds = (relayResponse.body?.data || []).map((item: { id: string }) => item.id).sort();
      expect(modelIds).toEqual([extraOpenAIModelId, openaiRelayModelId].sort());
      expect(modelIds).not.toContain(anthropicRelayModelId);
      expect(modelIds).not.toContain(geminiRelayModelId);
    } finally {
      await prisma.modelPricing.deleteMany({ where: { model: extraOpenAIModel } });
    }
  });

  it("OpenAI models 列表在 token 白名单为空时仍受渠道白名单约束", async () => {
    const allowedOpenAIModel = `test-relay-openai-allowed-${suffix}`;
    const allowedOpenAIModelId = `test-relay-openai-allowed-id-${suffix}`;
    const blockedOpenAIModel = `test-relay-openai-blocked-${suffix}`;
    const blockedOpenAIModelId = `test-relay-openai-blocked-id-${suffix}`;

    await prisma.modelPricing.createMany({
      data: [
        {
          model: allowedOpenAIModel,
          provider: allowedOpenAIModelId,
          pricingType: "token-based",
          inputPrice: 10,
          outputPrice: 10,
          supportedFormats: "openai",
          status: 1,
        },
        {
          model: blockedOpenAIModel,
          provider: blockedOpenAIModelId,
          pricingType: "token-based",
          inputPrice: 10,
          outputPrice: 10,
          supportedFormats: "openai",
          status: 1,
        },
      ],
    });

    try {
      await prisma.relayChannel.update({
        where: { id: openaiRelayChannelId },
        data: { allowedModels: JSON.stringify([openaiRelayModel, allowedOpenAIModel]) },
      });

      await prisma.relayToken.update({
        where: { id: openaiRelayTokenId },
        data: { allowedModels: null },
      });

      const relayResponse = await request(app)
        .get("/relay/proxy/v1/models")
        .set("Authorization", `Bearer ${openaiRelayTokenValue}`);

      expect(relayResponse.status).toBe(200);

      const modelIds = (relayResponse.body?.data || []).map((item: { id: string }) => item.id).sort();
      expect(modelIds).toEqual([allowedOpenAIModelId, openaiRelayModelId].sort());
      expect(modelIds).not.toContain(blockedOpenAIModelId);
      expect(modelIds).not.toContain(anthropicRelayModelId);
      expect(modelIds).not.toContain(geminiRelayModelId);
    } finally {
      await prisma.relayChannel.update({
        where: { id: openaiRelayChannelId },
        data: { allowedModels: null },
      });
      await prisma.relayToken.update({
        where: { id: openaiRelayTokenId },
        data: { allowedModels: null },
      });
      await prisma.modelPricing.deleteMany({
        where: {
          model: {
            in: [allowedOpenAIModel, blockedOpenAIModel],
          },
        },
      });
    }
  });

  it("OpenAI models 列表会将渠道白名单中的 legacy modelId 归一化为 canonical model name", async () => {
    const strictModel = `test-relay-openai-models-legacy-id-${suffix}`;
    const strictProvider = `test-relay-provider-models-legacy-id-${suffix}`;

    await prisma.modelPricing.create({
      data: {
        model: strictModel,
        provider: strictProvider,
        pricingType: "token-based",
        inputPrice: 10,
        outputPrice: 10,
        supportedFormats: "openai",
        status: 1,
      },
    });

    try {
      await prisma.relayChannel.update({
        where: { id: openaiRelayChannelId },
        data: { allowedModels: JSON.stringify([strictModel]) },
      });

      await prisma.relayToken.update({
        where: { id: openaiRelayTokenId },
        data: { allowedModels: null },
      });

      const relayResponse = await request(app)
        .get("/relay/proxy/models")
        .set("Authorization", `Bearer ${openaiRelayTokenValue}`);

      expect(relayResponse.status).toBe(200);

      const modelIds = (relayResponse.body?.data || []).map((item: { id: string }) => item.id);
      expect(modelIds).toEqual([strictProvider]);
    } finally {
      await prisma.relayChannel.update({
        where: { id: openaiRelayChannelId },
        data: { allowedModels: null },
      });
      await prisma.relayToken.update({
        where: { id: openaiRelayTokenId },
        data: { allowedModels: null },
      });
      await prisma.modelPricing.deleteMany({ where: { model: strictModel } });
    }
  });

  it("OpenAI models 列表只返回渠道白名单与 token 白名单的交集", async () => {
    const channelOnlyModel = `test-relay-openai-channel-only-${suffix}`;
    const sharedModel = `test-relay-openai-shared-${suffix}`;

    await prisma.modelPricing.createMany({
      data: [
        {
          model: channelOnlyModel,
          pricingType: "token-based",
          inputPrice: 10,
          outputPrice: 10,
          supportedFormats: "openai",
          status: 1,
        },
        {
          model: sharedModel,
          pricingType: "token-based",
          inputPrice: 10,
          outputPrice: 10,
          supportedFormats: "openai",
          status: 1,
        },
      ],
    });

    try {
      await prisma.relayChannel.update({
        where: { id: openaiRelayChannelId },
        data: { allowedModels: JSON.stringify([channelOnlyModel, sharedModel]) },
      });

      await prisma.relayToken.update({
        where: { id: openaiRelayTokenId },
        data: { allowedModels: `${sharedModel},${openaiRelayModel}` },
      });

      const relayResponse = await request(app)
        .get("/relay/proxy/v1/models")
        .set("Authorization", `Bearer ${openaiRelayTokenValue}`);

      expect(relayResponse.status).toBe(200);

      const modelIds = (relayResponse.body?.data || []).map((item: { id: string }) => item.id);
      expect(modelIds).toEqual([sharedModel]);
    } finally {
      await prisma.relayChannel.update({
        where: { id: openaiRelayChannelId },
        data: { allowedModels: null },
      });
      await prisma.relayToken.update({
        where: { id: openaiRelayTokenId },
        data: { allowedModels: null },
      });
      await prisma.modelPricing.deleteMany({
        where: {
          model: {
            in: [channelOnlyModel, sharedModel],
          },
        },
      });
    }
  });

  it("Anthropic 和 Gemini only 渠道访问 OpenAI models 列表时返回格式错误", async () => {
    const anthropicResponse = await request(app)
      .get("/relay/proxy/v1/models")
      .set("Authorization", `Bearer ${anthropicRelayTokenValue}`);

    expect(anthropicResponse.status).toBe(400);
    expect(String(anthropicResponse.body?.message || "")).toContain("Channel does not support openai format requests");

    const geminiResponse = await request(app)
      .get("/relay/proxy/v1/models")
      .set("Authorization", `Bearer ${geminiRelayTokenValue}`);

    expect(geminiResponse.status).toBe(400);
    expect(String(geminiResponse.body?.message || "")).toContain("Channel does not support openai format requests");
  });

  it(
    "OpenAI 流式 chat/completions 返回 SSE 并记录 streaming usage",
    async () => {
      const beforeCount = await prisma.relayUsage.count({ where: { relayTokenId: openaiRelayTokenId } });

      const relayResponse = await request(app)
        .post("/relay/proxy/v1/chat/completions")
        .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
        .send({
          model: openaiRelayModelId,
          messages: [{ role: "user", content: "请用流式返回" }],
          stream: true,
        });

      expect(relayResponse.status).toBe(200);
      expect(String(relayResponse.headers["content-type"] || "")).toContain("text/event-stream");
      expect(relayResponse.text).toContain("chat.completion.chunk");
      expect(relayResponse.text).toContain("data: [DONE]");

      const requestId = String(relayResponse.headers["x-request-id"] || "");
      expect(requestId).toBeTruthy();
      apiLogRequestIds.push(requestId);

      const apiLog = await getApiLogByRequestId(requestId);
      expect(apiLog).toBeNull();

      const usage = await getLatestUsage(openaiRelayTokenId, beforeCount + 1);
      expect(usage?.isStreaming).toBe(true);
      expect(usage?.totalTokens ?? 0).toBeGreaterThan(0);
    },
    RELAY_LOG_PERSISTENCE_TEST_TIMEOUT_MS,
  );

  it("OpenAI 流式上游错误会记录 usage 和 0 元消费流水，但不扣减余额", async () => {
    const beforeUsageCount = await prisma.relayUsage.count({ where: { relayTokenId: openaiRelayTokenId } });
    const beforeTransactionCount = await prisma.balanceTransaction.count({ where: { userId: testUserId } });
    const balanceBefore = await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: testUserId } });

    relayAIMockPlugin!.useOpenAI(async (ctx) => {
      if (ctx.body.stream === true)
        return {
          status: 503,
          body: { error: { message: "forced stream upstream failure for zero-charge integration" } },
        };

      return { body: relayAIMockPlugin!["buildOpenAIBody"](ctx as any) };
    });

    try {
      const relayResponse = await request(app)
        .post("/relay/proxy/v1/chat/completions")
        .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
        .send({
          model: openaiRelayModelId,
          messages: [{ role: "user", content: "请流式返回一个上游错误" }],
          stream: true,
        });

      expect(relayResponse.status).toBe(503);
      expect(String(relayResponse.headers["content-type"] || "")).toContain("application/json");
      expect(String(relayResponse.body?.error?.message || "")).toContain(
        "forced stream upstream failure for zero-charge integration",
      );

      const usage = await getLatestUsage(openaiRelayTokenId, beforeUsageCount + 1);
      expect(usage?.statusCode).toBe(503);
      expect(usage?.isStreaming).toBe(true);
      expect(usage?.totalTokens).toBe(0);

      const latestTransaction = await getLatestBalanceTransaction(testUserId, beforeTransactionCount + 1);
      expect(latestTransaction.type).toBe("api_usage");
      expect(Number(latestTransaction.amount)).toBe(0);
      expect(Number(latestTransaction.balanceBefore)).toBe(Number(latestTransaction.balanceAfter));
      expect(String(latestTransaction.description || "")).toContain("未扣费");
      expect(latestTransaction.relatedId).toBe(usage?.id);

      const balanceAfter = await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: testUserId } });
      expect(Number(balanceAfter.balance)).toBe(Number(balanceBefore.balance));
      expect(Number(balanceAfter.totalUsed)).toBe(Number(balanceBefore.totalUsed));
    } finally {
      relayAIMockPlugin!.useOpenAI(async (ctx) => ({
        ...(ctx.body.stream === true
          ? relayAIMockPlugin!["buildOpenAIStreamReply"](ctx as any)
          : { body: relayAIMockPlugin!["buildOpenAIBody"](ctx as any) }),
      }));
    }
  });

  it("OpenAI 流式 responses 返回 response.completed 并提取 usage", async () => {
    const beforeCount = await prisma.relayUsage.count({ where: { relayTokenId: openaiRelayTokenId } });

    const relayResponse = await request(app)
      .post("/relay/proxy/v1/responses")
      .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
      .send({
        model: openaiRelayModelId,
        input: "stream responses test",
        stream: true,
      });

    expect(relayResponse.status).toBe(200);
    expect(String(relayResponse.headers["content-type"] || "")).toContain("text/event-stream");
    expect(relayResponse.text).toContain("response.completed");
    expect(relayResponse.text).toContain("data: [DONE]");

    const usage = await getLatestUsage(openaiRelayTokenId, beforeCount + 1);
    expect(usage?.isStreaming).toBe(true);
    expect(usage?.requestTokens ?? 0).toBeGreaterThan(0);
    expect(usage?.responseTokens ?? 0).toBeGreaterThan(0);
  });

  it("OpenAI 非流式请求在首个分组返回 503 时自动切换到下一个分组", async () => {
    const beforeUsageCount = await prisma.relayUsage.count({ where: { relayTokenId: openaiFailoverTokenId } });
    const beforeSwitchCount = await prisma.relayChannelSwitchLog.count({
      where: { relayTokenId: openaiFailoverTokenId },
    });

    relayAIMockPlugin!.useOpenAI(async (ctx) => {
      const authHeader = String(ctx.headers.authorization || "");
      if (authHeader === "Bearer test-openai-failover-primary-key")
        return {
          status: 503,
          body: { error: { message: "primary unavailable for failover test" } },
        };

      return {
        body: {
          id: "chatcmpl_failover_ok",
          object: "chat.completion",
          model: ctx.model,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "secondary-success-response",
              },
            },
          ],
          usage: {
            prompt_tokens: 8,
            completion_tokens: 6,
            total_tokens: 14,
          },
        },
      };
    });

    try {
      const relayResponse = await request(app)
        .post("/relay/proxy/v1/chat/completions")
        .set("Authorization", `Bearer ${openaiFailoverTokenValue}`)
        .send({
          model: openaiRelayModelId,
          messages: [{ role: "user", content: "请自动切换到下一个分组" }],
          stream: false,
        });

      expect(relayResponse.status).toBe(200);
      expect(relayResponse.body?.choices?.[0]?.message?.content).toContain("secondary-success-response");

      // Now expects 2 usage records: failed attempt + successful attempt
      await waitForUsageCount(openaiFailoverTokenId, beforeUsageCount + 2);
      const usageRecords = await prisma.relayUsage.findMany({
        where: { relayTokenId: openaiFailoverTokenId },
        orderBy: { createTime: "asc" },
      });
      expect(usageRecords.length).toBe(beforeUsageCount + 2);

      // First record should be the failed attempt
      const failedUsage = usageRecords[usageRecords.length - 2];
      expect(failedUsage?.statusCode).toBe(503);

      // Second record should be the successful attempt
      const successUsage = usageRecords[usageRecords.length - 1];
      expect(successUsage?.statusCode).toBe(200);

      const switchLogs = await prisma.relayChannelSwitchLog.findMany({
        where: { relayTokenId: openaiFailoverTokenId },
        orderBy: { createTime: "asc" },
      });
      expect(switchLogs.length).toBe(beforeSwitchCount + 1);
      const latestSwitchLog = switchLogs[switchLogs.length - 1];
      expect(latestSwitchLog.fromChannelId).toBe(openaiFailoverPrimaryChannelId);
      expect(latestSwitchLog.toChannelId).toBe(openaiFailoverSecondaryChannelId);
      expect(latestSwitchLog.triggerStatusCode).toBe(503);
      expect(String(latestSwitchLog.triggerError || "")).toContain("primary unavailable");

      const channelConfigs = await prisma.relayTokenChannelConfig.findMany({
        where: { relayTokenId: openaiFailoverTokenId },
        orderBy: { priority: "asc" },
      });
      expect(channelConfigs[0]?.failureCount ?? 0).toBeGreaterThan(0);
      expect(channelConfigs[1]?.successCount ?? 0).toBeGreaterThan(0);
    } finally {
      relayAIMockPlugin!.useOpenAI(async (ctx) => ({
        ...(ctx.body.stream === true
          ? relayAIMockPlugin!["buildOpenAIStreamReply"](ctx as any)
          : { body: relayAIMockPlugin!["buildOpenAIBody"](ctx as any) }),
      }));
    }
  });

  it("OpenAI 流式请求在首包前收到 503 时自动切换到下一个分组并继续返回 SSE", async () => {
    const beforeUsageCount = await prisma.relayUsage.count({ where: { relayTokenId: openaiFailoverTokenId } });
    const beforeSwitchCount = await prisma.relayChannelSwitchLog.count({
      where: { relayTokenId: openaiFailoverTokenId },
    });

    relayAIMockPlugin!.useOpenAI(async (ctx) => {
      const authHeader = String(ctx.headers.authorization || "");
      if (authHeader === "Bearer test-openai-failover-primary-key")
        return {
          status: 503,
          body: { error: { message: "primary streaming unavailable" } },
        };

      if (ctx.body.stream === true)
        return {
          streamChunks: [
            `data: ${JSON.stringify({
              id: "chatcmpl_stream_ok",
              object: "chat.completion.chunk",
              model: ctx.model,
              choices: [{ index: 0, delta: { role: "assistant", content: "secondary-stream-" }, finish_reason: null }],
            })}\n\n`,
            `data: ${JSON.stringify({
              id: "chatcmpl_stream_ok",
              object: "chat.completion.chunk",
              model: ctx.model,
              choices: [{ index: 0, delta: { content: "success" }, finish_reason: null }],
            })}\n\n`,
            `data: ${JSON.stringify({
              id: "chatcmpl_stream_ok",
              object: "chat.completion.chunk",
              model: ctx.model,
              choices: [],
              usage: { prompt_tokens: 9, completion_tokens: 7, total_tokens: 16 },
            })}\n\n`,
            "data: [DONE]\n\n",
          ],
        };

      return {
        body: {
          id: "chatcmpl_failover_nonstream_fallback",
          object: "chat.completion",
          model: ctx.model,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "secondary-non-stream-fallback",
              },
            },
          ],
          usage: {
            prompt_tokens: 8,
            completion_tokens: 6,
            total_tokens: 14,
          },
        },
      };
    });

    try {
      const relayResponse = await request(app)
        .post("/relay/proxy/v1/chat/completions")
        .set("Authorization", `Bearer ${openaiFailoverTokenValue}`)
        .send({
          model: openaiRelayModelId,
          messages: [{ role: "user", content: "请流式切换到下一个分组" }],
          stream: true,
        });

      expect(relayResponse.status).toBe(200);
      expect(String(relayResponse.headers["content-type"] || "")).toContain("text/event-stream");
      expect(relayResponse.text).toContain('"content":"secondary-stream-"');
      expect(relayResponse.text).toContain('"content":"success"');
      expect(relayResponse.text).toContain("data: [DONE]");

      const usage = await getLatestUsage(openaiFailoverTokenId, beforeUsageCount + 1);
      expect(usage?.isStreaming).toBe(true);
      expect(usage?.statusCode).toBe(200);

      const switchLogs = await prisma.relayChannelSwitchLog.findMany({
        where: { relayTokenId: openaiFailoverTokenId },
        orderBy: { createTime: "asc" },
      });
      expect(switchLogs.length).toBe(beforeSwitchCount + 1);
      const latestSwitchLog = switchLogs[switchLogs.length - 1];
      expect(latestSwitchLog.triggerStatusCode).toBe(503);
      expect(String(latestSwitchLog.triggerError || "")).toContain("primary streaming unavailable");
    } finally {
      relayAIMockPlugin!.useOpenAI(async (ctx) => ({
        ...(ctx.body.stream === true
          ? relayAIMockPlugin!["buildOpenAIStreamReply"](ctx as any)
          : { body: relayAIMockPlugin!["buildOpenAIBody"](ctx as any) }),
      }));
    }
  });

  it("Anthropic 非流式 messages 请求成功并记录 usage", async () => {
    const beforeCount = await prisma.relayUsage.count({ where: { relayTokenId: anthropicRelayTokenId } });

    const relayResponse = await request(app)
      .post("/relay/proxy/v1/messages")
      .set("Authorization", `Bearer ${anthropicRelayTokenValue}`)
      .send({
        model: anthropicRelayModelId,
        max_tokens: 64,
        messages: [{ role: "user", content: "请简短回复" }],
      });

    expect(relayResponse.status).toBe(200);
    expect(relayResponse.body?.type).toBe("message");
    expect(relayResponse.body?.content?.[0]?.text).toContain("模拟AI输出-");

    const usage = await getLatestUsage(anthropicRelayTokenId, beforeCount + 1);
    expect(usage?.isStreaming).toBe(false);
    expect(usage?.totalTokens ?? 0).toBeGreaterThan(0);
  });

  it("Anthropic 流式 messages 返回 SSE 并记录 streaming usage", async () => {
    const beforeCount = await prisma.relayUsage.count({ where: { relayTokenId: anthropicRelayTokenId } });

    const relayResponse = await request(app)
      .post("/relay/proxy/v1/messages")
      .set("Authorization", `Bearer ${anthropicRelayTokenValue}`)
      .send({
        model: anthropicRelayModelId,
        max_tokens: 64,
        stream: true,
        messages: [{ role: "user", content: "请流式回复" }],
      });

    expect(relayResponse.status).toBe(200);
    expect(String(relayResponse.headers["content-type"] || "")).toContain("text/event-stream");
    expect(relayResponse.text).toContain("message_start");
    expect(relayResponse.text).toContain("data: [DONE]");

    const usage = await getLatestUsage(anthropicRelayTokenId, beforeCount + 1);
    expect(usage?.isStreaming).toBe(true);
    expect(usage?.requestTokens ?? 0).toBeGreaterThan(0);
    expect(usage?.responseTokens ?? 0).toBeGreaterThan(0);
  });

  it("Gemini 非流式 generateContent 请求成功并记录 usage", async () => {
    const beforeCount = await prisma.relayUsage.count({ where: { relayTokenId: geminiRelayTokenId } });

    const relayResponse = await request(app)
      .post(`/relay/proxy/v1/models/${geminiRelayModelId}:generateContent`)
      .set("Authorization", `Bearer ${geminiRelayTokenValue}`)
      .send({
        contents: [{ parts: [{ text: "请回复一段简短内容" }] }],
      });

    expect(relayResponse.status).toBe(200);
    expect(relayResponse.body?.candidates?.[0]?.content?.parts?.[0]?.text).toContain("模拟AI输出-");

    const usage = await getLatestUsage(geminiRelayTokenId, beforeCount + 1);
    expect(usage?.isStreaming).toBe(false);
    expect(usage?.totalTokens ?? 0).toBeGreaterThan(0);
  });

  it("Gemini 流式 streamGenerateContent 返回分块并记录 streaming usage", async () => {
    const beforeCount = await prisma.relayUsage.count({ where: { relayTokenId: geminiRelayTokenId } });

    const relayResponse = await request(app)
      .post(`/relay/proxy/v1/models/${geminiRelayModelId}:streamGenerateContent`)
      .set("Authorization", `Bearer ${geminiRelayTokenValue}`)
      .send({
        contents: [{ parts: [{ text: "请以流式返回" }] }],
      });

    expect(relayResponse.status).toBe(200);
    expect(String(relayResponse.headers["content-type"] || "")).toContain("text/event-stream");
    expect(relayResponse.text).toContain("usageMetadata");

    const usage = await getLatestUsage(geminiRelayTokenId, beforeCount + 1);
    expect(usage?.isStreaming).toBe(true);
    expect(usage?.requestTokens ?? 0).toBeGreaterThan(0);
    expect(usage?.responseTokens ?? 0).toBeGreaterThan(0);
  });
});
