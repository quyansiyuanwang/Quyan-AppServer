import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { createApp } from "../../src/app";
import { prisma } from "../../src/config/database";
import { hashPassword } from "../../src/util/crypto";
import { createRelayAIMockPlugin, RelayAIMockPlugin } from "../util/relay-ai-mock-plugin";

describe("中转 AI 图片接口集成测试", () => {
  let app: Express;
  let relayAIMockPlugin: RelayAIMockPlugin | null = null;

  let testGroupId = "";
  let testUserId = "";
  let openaiRelayChannelId = "";
  let openaiRelayTokenId = "";
  let openaiRelayTokenValue = "";

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const shortSuffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)}`;
  const openaiRelayModel = `test-relay-openai-image-${suffix}`;
  const openaiRelayModelId = `test-relay-openai-image-id-${suffix}`;
  const testGroupUsername = `trg_img_${shortSuffix}`;
  const testUsername = `tru_img_${shortSuffix}`;

  const testImagePath = join(__dirname, "../fixtures/test-image-small.png");
  let testImageBuffer: Buffer;

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

  beforeAll(async () => {
    app = createApp();

    // 读取测试图片
    testImageBuffer = readFileSync(testImagePath);

    // 创建mock插件，支持图片接口
    relayAIMockPlugin = createRelayAIMockPlugin({
      defaultModel: openaiRelayModelId,
      contentPrefix: "模拟图片输出-",
    });

    // 添加图片接口的mock处理器
    relayAIMockPlugin.useOpenAI(async (ctx) => {
      // 图片生成接口 (文生图)
      if (ctx.pathname.includes("/images/generations"))
        return {
          body: {
            created: Math.floor(Date.now() / 1000),
            data: [
              {
                url: `https://mock-image-url.com/${randomUUID()}.png`,
                revised_prompt: ctx.body.prompt || "mock image generation",
              },
            ],
          },
        };

      // 图片编辑接口 (图生图)
      if (ctx.pathname.includes("/images/edits"))
        return {
          body: {
            created: Math.floor(Date.now() / 1000),
            data: [
              {
                url: `https://mock-edited-image-url.com/${randomUUID()}.png`,
              },
            ],
          },
        };

      // 默认chat/completions处理
      const content = `模拟AI输出-${randomUUID().slice(0, 8)}`;
      return {
        body: {
          id: `chatcmpl_mock_${randomUUID().slice(0, 8)}`,
          object: "chat.completion",
          model: ctx.model,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content,
              },
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 9,
            total_tokens: 21,
          },
        },
      };
    });

    await relayAIMockPlugin.start();

    testGroupId = (
      await prisma.group.create({
        data: {
          username: testGroupUsername,
          name: "图片中转集成测试组",
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
          name: "图片中转集成测试用户",
          email: `relay_img_${suffix}@test.com`,
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
          name: `test_relay_openai_image_channel_${suffix}`,
          openaiUpstreamUrl: relayAIMockPlugin.baseUrl,
          openaiUpstreamApiKey: "test-openai-key",
          allowedFormats: "openai",
          multiplier: 1,
        },
      })
    ).id;

    openaiRelayTokenValue = `rlt_${randomUUID().replace(/-/g, "")}`;
    openaiRelayTokenId = (
      await prisma.relayToken.create({
        data: {
          userId: testUserId,
          name: `test_relay_openai_image_token_${suffix}`,
          token: openaiRelayTokenValue,
          channelId: openaiRelayChannelId,
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
  });

  afterAll(async () => {
    if (relayAIMockPlugin) await relayAIMockPlugin.stop();

    if (openaiRelayTokenId) await prisma.relayUsage.deleteMany({ where: { relayTokenId: openaiRelayTokenId } });
    if (openaiRelayTokenId) await prisma.relayToken.deleteMany({ where: { id: openaiRelayTokenId } });
    if (openaiRelayChannelId) await prisma.relayChannel.deleteMany({ where: { id: openaiRelayChannelId } });

    await prisma.modelPricing.deleteMany({
      where: { model: openaiRelayModel },
    });

    if (testUserId) await prisma.balanceTransaction.deleteMany({ where: { userId: testUserId } });
    if (testUserId) await prisma.balanceAccount.deleteMany({ where: { userId: testUserId } });
    if (testUserId) await prisma.user.deleteMany({ where: { id: testUserId } });
    if (testGroupId) await prisma.group.deleteMany({ where: { id: testGroupId } });
  });

  it("文生图: POST /images/generations 返回图片URL", async () => {
    const beforeCount = await prisma.relayUsage.count({ where: { relayTokenId: openaiRelayTokenId } });

    const relayResponse = await request(app)
      .post("/relay/proxy/images/generations")
      .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
      .send({
        model: openaiRelayModelId,
        prompt: "A beautiful sunset over the ocean",
        n: 1,
        size: "1024x1024",
      });

    expect(relayResponse.status).toBe(200);
    expect(relayResponse.body?.data).toBeDefined();
    expect(relayResponse.body?.data?.length).toBeGreaterThan(0);
    expect(relayResponse.body?.data?.[0]?.url).toContain("mock-image-url.com");

    const usage = await getLatestUsage(openaiRelayTokenId, beforeCount + 1);
    expect(usage).toBeDefined();
  });

  it("文生图: POST /v1/images/generations 支持版本号路径", async () => {
    const beforeCount = await prisma.relayUsage.count({ where: { relayTokenId: openaiRelayTokenId } });

    const relayResponse = await request(app)
      .post("/relay/proxy/v1/images/generations")
      .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
      .send({
        model: openaiRelayModelId,
        prompt: "A cat sitting on a chair",
        n: 1,
        size: "512x512",
      });

    expect(relayResponse.status).toBe(200);
    expect(relayResponse.body?.data).toBeDefined();
    expect(relayResponse.body?.data?.[0]?.url).toBeDefined();

    const usage = await getLatestUsage(openaiRelayTokenId, beforeCount + 1);
    expect(usage).toBeDefined();
  });

  it("文生图: POST /v2/images/generations 支持任意版本号", async () => {
    const beforeCount = await prisma.relayUsage.count({ where: { relayTokenId: openaiRelayTokenId } });

    const relayResponse = await request(app)
      .post("/relay/proxy/v2/images/generations")
      .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
      .send({
        model: openaiRelayModelId,
        prompt: "A dog playing in the park",
      });

    expect(relayResponse.status).toBe(200);
    expect(relayResponse.body?.data).toBeDefined();

    const usage = await getLatestUsage(openaiRelayTokenId, beforeCount + 1);
    expect(usage).toBeDefined();
  });

  it("图生图: POST /images/edits 使用JSON格式请求", async () => {
    const beforeCount = await prisma.relayUsage.count({ where: { relayTokenId: openaiRelayTokenId } });

    // 注意：实际的OpenAI API使用multipart/form-data，但为了测试简化，我们使用JSON
    const relayResponse = await request(app)
      .post("/relay/proxy/images/edits")
      .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
      .send({
        model: openaiRelayModelId,
        prompt: "Add a hat to the person",
        image: testImageBuffer.toString("base64"),
        n: 1,
        size: "1024x1024",
      });

    expect(relayResponse.status).toBe(200);
    expect(relayResponse.body?.data).toBeDefined();
    expect(relayResponse.body?.data?.[0]?.url).toContain("mock-edited-image-url.com");

    const usage = await getLatestUsage(openaiRelayTokenId, beforeCount + 1);
    expect(usage).toBeDefined();
  });

  it("图生图: POST /v1/images/edits 支持版本号路径", async () => {
    const beforeCount = await prisma.relayUsage.count({ where: { relayTokenId: openaiRelayTokenId } });

    const relayResponse = await request(app)
      .post("/relay/proxy/v1/images/edits")
      .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
      .send({
        model: openaiRelayModelId,
        prompt: "Change background to beach",
        image: testImageBuffer.toString("base64"),
      });

    expect(relayResponse.status).toBe(200);
    expect(relayResponse.body?.data).toBeDefined();

    const usage = await getLatestUsage(openaiRelayTokenId, beforeCount + 1);
    expect(usage).toBeDefined();
  });

  it("图生文: POST /chat/completions 使用vision模型分析图片", async () => {
    const beforeCount = await prisma.relayUsage.count({ where: { relayTokenId: openaiRelayTokenId } });

    // 将图片转为base64
    const base64Image = testImageBuffer.toString("base64");

    const relayResponse = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
      .send({
        model: openaiRelayModelId,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "What's in this image?",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                },
              },
            ],
          },
        ],
      });

    expect(relayResponse.status).toBe(200);
    expect(relayResponse.body?.choices?.[0]?.message?.content).toContain("模拟AI输出-");

    const usage = await getLatestUsage(openaiRelayTokenId, beforeCount + 1);
    expect(usage?.isStreaming).toBe(false);
    expect(usage?.totalTokens ?? 0).toBeGreaterThan(0);
  });

  it("图生文: 支持多张图片分析", async () => {
    const beforeCount = await prisma.relayUsage.count({ where: { relayTokenId: openaiRelayTokenId } });

    const base64Image = testImageBuffer.toString("base64");

    const relayResponse = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${openaiRelayTokenValue}`)
      .send({
        model: openaiRelayModelId,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Compare these two images",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                },
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                },
              },
            ],
          },
        ],
      });

    expect(relayResponse.status).toBe(200);
    expect(relayResponse.body?.choices?.[0]?.message?.content).toBeDefined();

    const usage = await getLatestUsage(openaiRelayTokenId, beforeCount + 1);
    expect(usage).toBeDefined();
  });

  it("图片接口: 无效token返回401", async () => {
    const relayResponse = await request(app)
      .post("/relay/proxy/images/generations")
      .set("Authorization", "Bearer invalid_token")
      .send({
        model: openaiRelayModelId,
        prompt: "Test prompt",
      });

    expect(relayResponse.status).toBe(401);
  });

  it("图片接口: 缺少Authorization header返回401", async () => {
    const relayResponse = await request(app).post("/relay/proxy/images/generations").send({
      model: openaiRelayModelId,
      prompt: "Test prompt",
    });

    expect(relayResponse.status).toBe(401);
  });
});
