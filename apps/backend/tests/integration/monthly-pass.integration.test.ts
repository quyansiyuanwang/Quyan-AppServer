import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/config/database";
import { hashPassword } from "../../src/util/crypto";
import { Permission } from "../../src/constant/permission";
import { MANAGED_STATUS } from "../../src/constant/status";
import { MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS } from "../../src/constant/monthly-pass";
import type { Express } from "express";
import { randomUUID } from "crypto";
import { withReplayProtection } from "../util/replay-protection-test-helper";
import { createRelayAIMockPlugin, RelayAIMockPlugin } from "../util/relay-ai-mock-plugin";

describe("月卡功能 + 中转模拟AI输出 集成测试", () => {
  let app: Express;
  let accessToken = "";
  let testGroupId = "";
  let testUserId = "";
  let boundaryUserId = "";

  let relayChannelId = "";
  let relayTokenId = "";
  let relayTokenValue = "";
  let boundaryRelayTokenId = "";
  let boundaryRelayTokenValue = "";

  let amountTemplateId = "";
  let requestTemplateId = "";
  let userPassId = "";

  let relayAIMockPlugin: RelayAIMockPlugin | null = null;

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const shortSuffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)}`;
  const testGroupUsername = `tmg_${shortSuffix}`;
  const testUsername = `tmu_${shortSuffix}`;
  const boundaryUsername = `tmb_${shortSuffix}`;
  const relayModel = `test-monthly-model-${suffix}`;
  const relayModelId = `test-monthly-model-id-${suffix}`;
  const templateNameAmount = `test_mp_amount_${suffix}`;
  const templateNameRequest = `test_mp_request_${suffix}`;
  const templateNameRequestBad = `test_mp_request_bad_${suffix}`;
  const templateNameAmountMax = `test_mp_amount_max_${suffix}`;
  const templateNameRequestMax = `test_mp_request_max_${suffix}`;
  const templateNameWindowMax = `test_mp_window_max_${suffix}`;
  const templateNameAmountOverflow = `test_mp_amount_over_${suffix}`;
  const templateNameRequestOverflow = `test_mp_request_over_${suffix}`;
  const templateNameWindowOverflow = `test_mp_window_over_${suffix}`;
  const templateNameModelMismatch = `test_mp_model_mismatch_${suffix}`;
  const templateNameTemplateDisable = `test_mp_template_disable_${suffix}`;
  const templateNameFallbackA = `test_mp_fallback_a_${suffix}`;
  const templateNameFallbackB = `test_mp_fallback_b_${suffix}`;
  const templateNameTokenPartial = `test_mp_token_partial_${suffix}`;
  const templateNameChannelMismatch = `test_mp_channel_mismatch_${suffix}`;

  const postWithReplay = (path: string, body: Record<string, unknown>) =>
    withReplayProtection(request(app).post(path), body, path);

  const putWithReplay = (path: string, body: Record<string, unknown>) =>
    withReplayProtection(request(app).put(path), body, path);

  const deleteWithReplay = (path: string, body: Record<string, unknown> = {}) =>
    withReplayProtection(request(app).delete(path), body, path);

  const loginBody = {
    username: testUsername,
    password: "test_password",
    agreedToLegalPolicies: true,
  };

  const reauthenticate = async () => {
    const loginResponse = await postWithReplay("/v1/auth/login", loginBody).send(loginBody);
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body?.data?.access_token).toBeTruthy();
    accessToken = loginResponse.body.data.access_token;
    return accessToken;
  };

  beforeAll(async () => {
    app = createApp();

    relayAIMockPlugin = createRelayAIMockPlugin({
      defaultModel: relayModel,
      contentPrefix: "模拟AI输出-",
    });
    await relayAIMockPlugin.start();

    testGroupId = (
      await prisma.group.create({
        data: {
          username: testGroupUsername,
          name: "月卡集成测试组",
          level: 1,
          permissions: JSON.stringify([
            Permission.MONTHLY_PASS_TEMPLATE_READ,
            Permission.MONTHLY_PASS_TEMPLATE_WRITE,
            Permission.MONTHLY_PASS_ASSIGNMENT_READ,
            Permission.MONTHLY_PASS_ASSIGNMENT_WRITE,
            Permission.MONTHLY_PASS_USAGE_READ,
          ]),
        },
      })
    ).id;

    testUserId = (
      await prisma.user.create({
        data: {
          username: testUsername,
          password: hashPassword("test_password"),
          name: "月卡集成测试用户",
          email: `monthly_${suffix}@test.com`,
          groupId: testGroupId,
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;

    boundaryUserId = (
      await prisma.user.create({
        data: {
          username: boundaryUsername,
          password: hashPassword("test_password"),
          name: "月卡边界测试用户",
          email: `monthly_boundary_${suffix}@test.com`,
          groupId: testGroupId,
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;

    await reauthenticate();

    relayChannelId = (
      await prisma.relayChannel.create({
        data: {
          name: `test_monthly_channel_${suffix}`,
          openaiUpstreamUrl: relayAIMockPlugin.baseUrl,
          openaiUpstreamApiKey: "test-openai-key",
          allowedFormats: "all",
          multiplier: 1,
        },
      })
    ).id;

    relayTokenValue = `rlt_${randomUUID().replace(/-/g, "")}`;
    relayTokenId = (
      await prisma.relayToken.create({
        data: {
          userId: testUserId,
          name: `test_monthly_token_${suffix}`,
          token: relayTokenValue,
          channelId: relayChannelId,
        },
      })
    ).id;

    boundaryRelayTokenValue = `rlt_${randomUUID().replace(/-/g, "")}`;
    boundaryRelayTokenId = (
      await prisma.relayToken.create({
        data: {
          userId: boundaryUserId,
          name: `test_monthly_boundary_token_${suffix}`,
          token: boundaryRelayTokenValue,
          channelId: relayChannelId,
        },
      })
    ).id;

    await prisma.modelPricing.create({
      data: {
        model: relayModel,
        provider: relayModelId,
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

    if (testUserId) {
      await prisma.monthlyPassUsage.deleteMany({ where: { userId: testUserId } });
      await prisma.userMonthlyPass.deleteMany({ where: { userId: testUserId } });
      await prisma.balanceTransaction.deleteMany({ where: { userId: testUserId } });
      await prisma.balanceAccount.deleteMany({ where: { userId: testUserId } });
    }

    if (boundaryUserId) {
      await prisma.monthlyPassUsage.deleteMany({ where: { userId: boundaryUserId } });
      await prisma.userMonthlyPass.deleteMany({ where: { userId: boundaryUserId } });
      await prisma.balanceTransaction.deleteMany({ where: { userId: boundaryUserId } });
      await prisma.balanceAccount.deleteMany({ where: { userId: boundaryUserId } });
    }

    const relayTokenIds = [relayTokenId, boundaryRelayTokenId].filter((id) => Boolean(id));
    if (relayTokenIds.length > 0)
      await prisma.relayUsage.deleteMany({
        where: {
          relayTokenId: {
            in: relayTokenIds,
          },
        },
      });
    if (relayTokenIds.length > 0)
      await prisma.relayToken.deleteMany({
        where: {
          id: {
            in: relayTokenIds,
          },
        },
      });
    if (relayChannelId) await prisma.relayChannel.deleteMany({ where: { id: relayChannelId } });

    await prisma.monthlyPassTemplate.deleteMany({
      where: {
        name: {
          in: [
            templateNameAmount,
            templateNameRequest,
            templateNameRequestBad,
            templateNameAmountMax,
            templateNameRequestMax,
            templateNameWindowMax,
            templateNameAmountOverflow,
            templateNameRequestOverflow,
            templateNameWindowOverflow,
            templateNameModelMismatch,
            templateNameTemplateDisable,
            templateNameFallbackA,
            templateNameFallbackB,
            templateNameTokenPartial,
            templateNameChannelMismatch,
          ],
        },
      },
    });

    await prisma.modelPricing.deleteMany({ where: { model: relayModel } });
    if (testUserId) await prisma.user.deleteMany({ where: { id: testUserId } });
    if (boundaryUserId) await prisma.user.deleteMany({ where: { id: boundaryUserId } });
    if (testGroupId) await prisma.group.deleteMany({ where: { id: testGroupId } });
  });

  it("创建金额月卡模板成功", async () => {
    const body = {
      name: templateNameAmount,
      description: "用于月卡集成测试",
      defaultQuota: 5,
      quotaUnit: "amount",
    };

    const response = await postWithReplay("/v1/monthly-passes/templates", body)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.code).toBe(0);
    expect(response.body.data.name).toBe(templateNameAmount);
    amountTemplateId = response.body.data.id;
  });

  it("按次模板输入小数应被拒绝", async () => {
    const body = {
      name: templateNameRequestBad,
      defaultQuota: 10.5,
      quotaUnit: "request",
    };

    const response = await postWithReplay("/v1/monthly-passes/templates", body)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body);

    expect([400, 422]).toContain(response.status);
  });

  it("创建按次月卡模板成功（整数额度）", async () => {
    const body = {
      name: templateNameRequest,
      defaultQuota: 20,
      dailyQuota: 5,
      quotaUnit: "request",
      quotaWindowHours: 24,
    };

    const response = await postWithReplay("/v1/monthly-passes/templates", body)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.code).toBe(0);
    expect(response.body.data.quotaUnit).toBe("request");
    expect(Number.isInteger(Number(response.body.data.defaultQuota))).toBe(true);
    requestTemplateId = response.body.data.id;
  });

  it("模板发布流：发布、重复发布拒绝、已发布列表可见、下架后不可见", async () => {
    const listBeforePublishResponse = await request(app)
      .get("/v1/monthly-passes/templates/published")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(listBeforePublishResponse.status).toBe(200);
    expect(listBeforePublishResponse.body.code).toBe(0);
    expect(listBeforePublishResponse.body.data.some((item: { id: string }) => item.id === amountTemplateId)).toBe(
      false,
    );

    const publishResponse = await postWithReplay(`/v1/monthly-passes/templates/${amountTemplateId}/publish`, {})
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body.code).toBe(0);
    expect(publishResponse.body.data.id).toBe(amountTemplateId);
    expect(publishResponse.body.data.publishStatus).toBe("published");
    expect(publishResponse.body.data.publishedAt).toBeTruthy();
    expect(publishResponse.body.data.status).toBe(MANAGED_STATUS.ENABLED);

    const duplicatePublishResponse = await postWithReplay(
      `/v1/monthly-passes/templates/${amountTemplateId}/publish`,
      {},
    )
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(duplicatePublishResponse.status).toBe(400);

    const listAfterPublishResponse = await request(app)
      .get("/v1/monthly-passes/templates/published")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(listAfterPublishResponse.status).toBe(200);
    expect(listAfterPublishResponse.body.code).toBe(0);
    expect(
      listAfterPublishResponse.body.data.some(
        (item: { id: string; publishStatus: string; publishedAt?: string }) =>
          item.id === amountTemplateId && item.publishStatus === "published" && Boolean(item.publishedAt),
      ),
    ).toBe(true);

    const unpublishResponse = await postWithReplay(`/v1/monthly-passes/templates/${amountTemplateId}/unpublish`, {})
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(unpublishResponse.status).toBe(200);
    expect(unpublishResponse.body.code).toBe(0);
    expect(unpublishResponse.body.data.id).toBe(amountTemplateId);
    expect(unpublishResponse.body.data.publishStatus).toBe("draft");
    expect(unpublishResponse.body.data.publishedAt ?? null).toBeNull();

    const duplicateUnpublishResponse = await postWithReplay(
      `/v1/monthly-passes/templates/${amountTemplateId}/unpublish`,
      {},
    )
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(duplicateUnpublishResponse.status).toBe(400);

    const listAfterUnpublishResponse = await request(app)
      .get("/v1/monthly-passes/templates/published")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(listAfterUnpublishResponse.status).toBe(200);
    expect(listAfterUnpublishResponse.body.code).toBe(0);
    expect(listAfterUnpublishResponse.body.data.some((item: { id: string }) => item.id === amountTemplateId)).toBe(
      false,
    );

    const republishResponse = await postWithReplay(`/v1/monthly-passes/templates/${amountTemplateId}/publish`, {})
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(republishResponse.status).toBe(200);
    expect(republishResponse.body.code).toBe(0);
    expect(republishResponse.body.data.publishStatus).toBe("published");
  });

  it("额度上限边界：amount=999999.9999可创建，1000000应拒绝", async () => {
    const maxBody = {
      name: templateNameAmountMax,
      defaultQuota: 999999.9999,
      quotaUnit: "amount",
    };

    const maxResponse = await postWithReplay("/v1/monthly-passes/templates", maxBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(maxBody);

    expect(maxResponse.status).toBe(200);
    expect(maxResponse.body.code).toBe(0);
    expect(Number(maxResponse.body.data.defaultQuota)).toBeCloseTo(999999.9999, 4);

    const overflowBody = {
      name: templateNameAmountOverflow,
      defaultQuota: 1000000,
      quotaUnit: "amount",
    };

    const overflowResponse = await postWithReplay("/v1/monthly-passes/templates", overflowBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(overflowBody);

    expect([400, 422]).toContain(overflowResponse.status);
  });

  it("额度上限边界：request=999999可创建，1000000应拒绝", async () => {
    const maxBody = {
      name: templateNameRequestMax,
      defaultQuota: 999999,
      quotaUnit: "request",
    };

    const maxResponse = await postWithReplay("/v1/monthly-passes/templates", maxBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(maxBody);

    expect(maxResponse.status).toBe(200);
    expect(maxResponse.body.code).toBe(0);
    expect(Number.isInteger(Number(maxResponse.body.data.defaultQuota))).toBe(true);
    expect(Number(maxResponse.body.data.defaultQuota)).toBe(999999);

    const overflowBody = {
      name: templateNameRequestOverflow,
      defaultQuota: 1000000,
      quotaUnit: "request",
    };

    const overflowResponse = await postWithReplay("/v1/monthly-passes/templates", overflowBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(overflowBody);

    expect([400, 422]).toContain(overflowResponse.status);
  });

  it(`窗口上限边界：quotaWindowHours=${MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS}可创建，${MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS + 1}应拒绝`, async () => {
    const maxBody = {
      name: templateNameWindowMax,
      defaultQuota: 10,
      dailyQuota: 1,
      quotaUnit: "request",
      quotaWindowHours: MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS,
    };

    const maxResponse = await postWithReplay("/v1/monthly-passes/templates", maxBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(maxBody);

    expect(maxResponse.status).toBe(200);
    expect(maxResponse.body.code).toBe(0);
    expect(Number(maxResponse.body.data.quotaWindowHours)).toBe(MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS);

    const overflowBody = {
      name: templateNameWindowOverflow,
      defaultQuota: 10,
      dailyQuota: 1,
      quotaUnit: "request",
      quotaWindowHours: MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS + 1,
    };

    const overflowResponse = await postWithReplay("/v1/monthly-passes/templates", overflowBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(overflowBody);

    expect([400, 422]).toContain(overflowResponse.status);
  });

  it("分配月卡并查询列表", async () => {
    const assignBody = {
      userId: testUserId,
      templateId: amountTemplateId,
      startAt: new Date(Date.now() - 60 * 1000).toISOString(),
      endAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      totalQuota: 5,
      quotaUnit: "amount",
      note: "集成测试分配",
    };

    const assignResponse = await postWithReplay("/v1/monthly-passes/user-passes", assignBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(assignBody);

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.code).toBe(0);
    expect(assignResponse.body.data.userId).toBe(testUserId);
    userPassId = assignResponse.body.data.id;

    const listResponse = await request(app)
      .get(`/v1/monthly-passes/user-passes?page=1&pageSize=20&userId=${testUserId}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.code).toBe(0);
    expect(Array.isArray(listResponse.body.data.records)).toBe(true);
    expect(listResponse.body.data.records.some((item: any) => item.id === userPassId)).toBe(true);

    const myResponse = await request(app)
      .get("/v1/monthly-passes/me?page=1&pageSize=20")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(myResponse.status).toBe(200);
    expect(myResponse.body.code).toBe(0);
    expect(myResponse.body.data.records.some((item: any) => item.id === userPassId)).toBe(true);
  });

  it("更新分配信息成功", async () => {
    const body = {
      totalQuota: 6,
      note: "updated-by-test",
    };

    const response = await putWithReplay(`/v1/monthly-passes/user-passes/${userPassId}`, body)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.code).toBe(0);
    expect(response.body.data.note).toBe("updated-by-test");
    expect(Number(response.body.data.totalQuota)).toBe(6);
  });

  it("中转接口模拟AI输出，并生成月卡使用流水", async () => {
    const relayRequestBody = {
      model: relayModelId,
      messages: [{ role: "user", content: "你好，帮我随便说点什么" }],
      stream: false,
    };

    const relayResponse = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${relayTokenValue}`)
      .send(relayRequestBody);

    expect(relayResponse.status).toBe(200);
    expect(relayResponse.body?.choices?.[0]?.message?.content).toContain("模拟AI输出-");

    const usageResponse = await request(app)
      .get(`/v1/monthly-passes/usages?page=1&pageSize=20&userId=${testUserId}&model=${encodeURIComponent(relayModel)}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(usageResponse.status).toBe(200);
    expect(usageResponse.body.code).toBe(0);
    expect(Array.isArray(usageResponse.body.data.records)).toBe(true);
    expect(usageResponse.body.data.records.length).toBeGreaterThan(0);
    expect(usageResponse.body.data.records[0].model).toBe(relayModel);
  });

  it("超额使用边界：request额度=1时第二次请求应失败", async () => {
    const assignBody = {
      userId: boundaryUserId,
      templateId: requestTemplateId,
      startAt: new Date(Date.now() - 60 * 1000).toISOString(),
      endAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      totalQuota: 1,
      dailyQuota: 1,
      quotaUnit: "request",
      note: "boundary-overuse",
    };

    const assignResponse = await postWithReplay("/v1/monthly-passes/user-passes", assignBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(assignBody);

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.code).toBe(0);
    const boundaryUserPassId = String(assignResponse.body.data.id);

    const relayRequestBody = {
      model: relayModelId,
      messages: [{ role: "user", content: "first request should consume all request quota" }],
      stream: false,
    };

    const firstRelayResponse = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send(relayRequestBody);

    expect(firstRelayResponse.status).toBe(200);

    const passAfterFirst = await prisma.userMonthlyPass.findUnique({ where: { id: boundaryUserPassId } });
    expect(Number(passAfterFirst?.remainingQuota || 0)).toBe(0);

    const relayUsageCountBeforeSecond = await prisma.relayUsage.count({
      where: { relayTokenId: boundaryRelayTokenId },
    });

    const secondRelayResponse = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "second request should exceed quota" }],
        stream: false,
      });

    expect(secondRelayResponse.status).toBe(400);
    expect(String(secondRelayResponse.body?.message || "")).toContain("Insufficient balance");

    const relayUsageCountAfterSecond = await prisma.relayUsage.count({
      where: { relayTokenId: boundaryRelayTokenId },
    });
    expect(relayUsageCountAfterSecond).toBe(relayUsageCountBeforeSecond);

    const monthlyPassUsageCount = await prisma.monthlyPassUsage.count({
      where: { userMonthlyPassId: boundaryUserPassId },
    });
    expect(monthlyPassUsageCount).toBe(1);
  });

  it("时间窗口边界：dailyQuota窗口超时后应可再次使用", async () => {
    const assignBody = {
      userId: boundaryUserId,
      templateId: requestTemplateId,
      startAt: new Date(Date.now() - 60 * 1000).toISOString(),
      endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      totalQuota: 2,
      dailyQuota: 1,
      quotaUnit: "request",
      quotaWindowHours: 1,
      note: "boundary-window-timeout",
    };

    const assignResponse = await postWithReplay("/v1/monthly-passes/user-passes", assignBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(assignBody);

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.code).toBe(0);
    const windowPassId = String(assignResponse.body.data.id);

    const relayRequestBody = {
      model: relayModelId,
      messages: [{ role: "user", content: "window timeout boundary request" }],
      stream: false,
    };

    const firstRelayResponse = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send(relayRequestBody);
    expect(firstRelayResponse.status).toBe(200);

    const secondRelayResponse = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "second call should be blocked by daily window" }],
        stream: false,
      });
    expect(secondRelayResponse.status).toBe(400);
    expect(String(secondRelayResponse.body?.message || "")).toContain("Insufficient balance");

    const firstWindowUsage = await prisma.monthlyPassUsage.findFirst({
      where: { userMonthlyPassId: windowPassId },
      orderBy: { createTime: "desc" },
    });
    expect(firstWindowUsage).toBeTruthy();

    await prisma.monthlyPassUsage.updateMany({
      where: { userMonthlyPassId: windowPassId },
      data: {
        createTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    });

    const thirdRelayResponse = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "third call should pass after window timeout" }],
        stream: false,
      });
    expect(thirdRelayResponse.status).toBe(200);

    const usageCount = await prisma.monthlyPassUsage.count({
      where: { userMonthlyPassId: windowPassId },
    });
    expect(usageCount).toBe(2);

    const passAfterThird = await prisma.userMonthlyPass.findUnique({ where: { id: windowPassId } });
    expect(Number(passAfterThird?.remainingQuota || 0)).toBe(0);
  });

  it("超时使用边界：已过期月卡请求应失败", async () => {
    const assignBody = {
      userId: boundaryUserId,
      templateId: requestTemplateId,
      startAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      endAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      totalQuota: 1,
      dailyQuota: 1,
      quotaUnit: "request",
      note: "boundary-expired",
    };

    const assignResponse = await postWithReplay("/v1/monthly-passes/user-passes", assignBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(assignBody);

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.code).toBe(0);
    const expiredUserPassId = String(assignResponse.body.data.id);

    const relayUsageCountBefore = await prisma.relayUsage.count({
      where: { relayTokenId: boundaryRelayTokenId },
    });

    const relayResponse = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "expired pass should not cover this" }],
        stream: false,
      });

    expect(relayResponse.status).toBe(400);
    expect(String(relayResponse.body?.message || "")).toContain("Insufficient balance");

    const relayUsageCountAfter = await prisma.relayUsage.count({
      where: { relayTokenId: boundaryRelayTokenId },
    });
    expect(relayUsageCountAfter).toBe(relayUsageCountBefore);

    const expiredPassUsageCount = await prisma.monthlyPassUsage.count({
      where: { userMonthlyPassId: expiredUserPassId },
    });
    expect(expiredPassUsageCount).toBe(0);
  });

  it("生效时间边界：startAt未到时不覆盖，调整到生效后可覆盖", async () => {
    const startAtFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const endAtFuture = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const assignBody = {
      userId: boundaryUserId,
      templateId: requestTemplateId,
      startAt: startAtFuture,
      endAt: endAtFuture,
      totalQuota: 1,
      dailyQuota: 1,
      quotaUnit: "request",
      note: "boundary-start-at-future",
    };

    const assignResponse = await postWithReplay("/v1/monthly-passes/user-passes", assignBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(assignBody);

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.code).toBe(0);
    const futurePassId = String(assignResponse.body.data.id);

    const relayBeforeEffective = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "future startAt should not cover" }],
        stream: false,
      });

    expect(relayBeforeEffective.status).toBe(400);
    expect(String(relayBeforeEffective.body?.message || "")).toContain("Insufficient balance");

    const updateBody = {
      startAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      endAt: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
    };

    const updateResponse = await putWithReplay(`/v1/monthly-passes/user-passes/${futurePassId}`, updateBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(updateBody);

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.code).toBe(0);

    const relayAfterEffective = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "updated startAt should cover now" }],
        stream: false,
      });

    expect(relayAfterEffective.status).toBe(200);

    const usageCount = await prisma.monthlyPassUsage.count({ where: { userMonthlyPassId: futurePassId } });
    expect(usageCount).toBe(1);
  });

  it("Token额度边界：totalQuota=21时第一请求成功，第二请求失败", async () => {
    const assignBody = {
      userId: boundaryUserId,
      templateId: requestTemplateId,
      startAt: new Date(Date.now() - 60 * 1000).toISOString(),
      endAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      totalQuota: 21,
      dailyQuota: 21,
      quotaUnit: "token",
      note: "boundary-token-exact",
    };

    const assignResponse = await postWithReplay("/v1/monthly-passes/user-passes", assignBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(assignBody);

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.code).toBe(0);
    const tokenPassId = String(assignResponse.body.data.id);

    const firstRelayResponse = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "token boundary first call" }],
        stream: false,
      });

    expect(firstRelayResponse.status).toBe(200);

    const passAfterFirst = await prisma.userMonthlyPass.findUnique({ where: { id: tokenPassId } });
    expect(Number(passAfterFirst?.remainingQuota || 0)).toBe(0);

    const secondRelayResponse = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "token boundary second call" }],
        stream: false,
      });

    expect(secondRelayResponse.status).toBe(400);
    expect(String(secondRelayResponse.body?.message || "")).toContain("Insufficient balance");

    const usageCount = await prisma.monthlyPassUsage.count({ where: { userMonthlyPassId: tokenPassId } });
    expect(usageCount).toBe(1);
  });

  it("状态边界：status=0的月卡不应继续覆盖", async () => {
    const assignBody = {
      userId: boundaryUserId,
      templateId: requestTemplateId,
      startAt: new Date(Date.now() - 60 * 1000).toISOString(),
      endAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      totalQuota: 2,
      dailyQuota: 2,
      quotaUnit: "request",
      note: "boundary-status-disabled",
    };

    const assignResponse = await postWithReplay("/v1/monthly-passes/user-passes", assignBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(assignBody);

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.code).toBe(0);
    const statusPassId = String(assignResponse.body.data.id);

    const relayBeforeDisable = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "status boundary first call" }],
        stream: false,
      });

    expect(relayBeforeDisable.status).toBe(200);

    const disableBody = {
      status: 0,
    };

    const disableResponse = await putWithReplay(`/v1/monthly-passes/user-passes/${statusPassId}`, disableBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(disableBody);

    expect(disableResponse.status).toBe(200);
    expect(disableResponse.body.code).toBe(0);
    expect(disableResponse.body.data.status).toBe(0);

    const relayAfterDisable = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "status boundary second call" }],
        stream: false,
      });

    expect(relayAfterDisable.status).toBe(400);
    expect(String(relayAfterDisable.body?.message || "")).toContain("Insufficient balance");

    const usageCount = await prisma.monthlyPassUsage.count({ where: { userMonthlyPassId: statusPassId } });
    expect(usageCount).toBe(1);
  });

  it("模型匹配边界：不存在的 allowedModels 不应保存", async () => {
    const createTemplateBody = {
      name: templateNameModelMismatch,
      defaultQuota: 2,
      dailyQuota: 2,
      quotaUnit: "request",
      allowedModels: ["another-model-not-match"],
    };

    const templateResponse = await postWithReplay("/v1/monthly-passes/templates", createTemplateBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(createTemplateBody);

    expect(templateResponse.status).toBe(400);
    expect(String(templateResponse.body?.message || "")).toContain("Unknown or inactive monthly pass models");
    await expect(
      prisma.monthlyPassTemplate.findUnique({ where: { name: templateNameModelMismatch } }),
    ).resolves.toBeNull();
  });

  it("模板状态边界：模板禁用后对应月卡不应继续覆盖", async () => {
    const createTemplateBody = {
      name: templateNameTemplateDisable,
      defaultQuota: 2,
      dailyQuota: 2,
      quotaUnit: "request",
    };

    const templateResponse = await postWithReplay("/v1/monthly-passes/templates", createTemplateBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(createTemplateBody);

    expect(templateResponse.status).toBe(200);
    expect(templateResponse.body.code).toBe(0);
    const templateId = String(templateResponse.body.data.id);

    const assignBody = {
      userId: boundaryUserId,
      templateId,
      startAt: new Date(Date.now() - 60 * 1000).toISOString(),
      endAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      totalQuota: 2,
      dailyQuota: 2,
      quotaUnit: "request",
      note: "boundary-template-disabled",
    };

    const assignResponse = await postWithReplay("/v1/monthly-passes/user-passes", assignBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(assignBody);

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.code).toBe(0);
    const passId = String(assignResponse.body.data.id);

    const firstRelay = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "template enabled should cover" }],
        stream: false,
      });

    expect(firstRelay.status).toBe(200);

    const disableTemplateBody = {
      status: 0,
    };

    const disableTemplateResponse = await putWithReplay(
      `/v1/monthly-passes/templates/${templateId}`,
      disableTemplateBody,
    )
      .set("Authorization", `Bearer ${accessToken}`)
      .send(disableTemplateBody);

    expect(disableTemplateResponse.status).toBe(200);
    expect(disableTemplateResponse.body.code).toBe(0);
    expect(disableTemplateResponse.body.data.status).toBe(0);

    const secondRelay = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "template disabled should stop coverage" }],
        stream: false,
      });

    expect(secondRelay.status).toBe(400);
    expect(String(secondRelay.body?.message || "")).toContain("Insufficient balance");

    const usageCount = await prisma.monthlyPassUsage.count({ where: { userMonthlyPassId: passId } });
    expect(usageCount).toBe(1);
  });

  it("多月卡回退边界：第一个候选耗尽后应自动使用第二个候选", async () => {
    const templateABody = {
      name: templateNameFallbackA,
      defaultQuota: 1,
      dailyQuota: 1,
      quotaUnit: "request",
    };
    const templateBBody = {
      name: templateNameFallbackB,
      defaultQuota: 1,
      dailyQuota: 1,
      quotaUnit: "request",
    };

    const [templateAResponse, templateBResponse] = await Promise.all([
      postWithReplay("/v1/monthly-passes/templates", templateABody)
        .set("Authorization", `Bearer ${accessToken}`)
        .send(templateABody),
      postWithReplay("/v1/monthly-passes/templates", templateBBody)
        .set("Authorization", `Bearer ${accessToken}`)
        .send(templateBBody),
    ]);

    expect(templateAResponse.status).toBe(200);
    expect(templateBResponse.status).toBe(200);
    const templateAId = String(templateAResponse.body.data.id);
    const templateBId = String(templateBResponse.body.data.id);

    const now = Date.now();
    const firstEndAt = new Date(now + 30 * 60 * 1000).toISOString();
    const secondEndAt = new Date(now + 90 * 60 * 1000).toISOString();

    const assignAResponse = await postWithReplay("/v1/monthly-passes/user-passes", {
      userId: boundaryUserId,
      templateId: templateAId,
      startAt: new Date(now - 60 * 1000).toISOString(),
      endAt: firstEndAt,
      totalQuota: 1,
      dailyQuota: 1,
      quotaUnit: "request",
      note: "boundary-fallback-a",
    })
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        userId: boundaryUserId,
        templateId: templateAId,
        startAt: new Date(now - 60 * 1000).toISOString(),
        endAt: firstEndAt,
        totalQuota: 1,
        dailyQuota: 1,
        quotaUnit: "request",
        note: "boundary-fallback-a",
      });

    const assignBResponse = await postWithReplay("/v1/monthly-passes/user-passes", {
      userId: boundaryUserId,
      templateId: templateBId,
      startAt: new Date(now - 60 * 1000).toISOString(),
      endAt: secondEndAt,
      totalQuota: 1,
      dailyQuota: 1,
      quotaUnit: "request",
      note: "boundary-fallback-b",
    })
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        userId: boundaryUserId,
        templateId: templateBId,
        startAt: new Date(now - 60 * 1000).toISOString(),
        endAt: secondEndAt,
        totalQuota: 1,
        dailyQuota: 1,
        quotaUnit: "request",
        note: "boundary-fallback-b",
      });

    expect(assignAResponse.status).toBe(200);
    expect(assignBResponse.status).toBe(200);

    const passAId = String(assignAResponse.body.data.id);
    const passBId = String(assignBResponse.body.data.id);

    const firstRelay = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "fallback first call" }],
        stream: false,
      });
    expect(firstRelay.status).toBe(200);

    const secondRelay = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "fallback second call" }],
        stream: false,
      });
    expect(secondRelay.status).toBe(200);

    const thirdRelay = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "fallback third call should fail" }],
        stream: false,
      });
    expect(thirdRelay.status).toBe(400);
    expect(String(thirdRelay.body?.message || "")).toContain("Insufficient balance");

    const passAUsageCount = await prisma.monthlyPassUsage.count({ where: { userMonthlyPassId: passAId } });
    const passBUsageCount = await prisma.monthlyPassUsage.count({ where: { userMonthlyPassId: passBId } });
    expect(passAUsageCount).toBe(1);
    expect(passBUsageCount).toBe(1);
  });

  it("Token部分覆盖边界：月卡仅覆盖部分成本且余额不足时应整体失败且不记账", async () => {
    const createTemplateBody = {
      name: templateNameTokenPartial,
      defaultQuota: 10,
      dailyQuota: 10,
      quotaUnit: "token",
    };

    const templateResponse = await postWithReplay("/v1/monthly-passes/templates", createTemplateBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(createTemplateBody);

    expect(templateResponse.status).toBe(200);
    expect(templateResponse.body.code).toBe(0);
    const templateId = String(templateResponse.body.data.id);

    const assignBody = {
      userId: boundaryUserId,
      templateId,
      startAt: new Date(Date.now() - 60 * 1000).toISOString(),
      endAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      totalQuota: 10,
      dailyQuota: 10,
      quotaUnit: "token",
      note: "boundary-token-partial",
    };

    const assignResponse = await postWithReplay("/v1/monthly-passes/user-passes", assignBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(assignBody);

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.code).toBe(0);
    const passId = String(assignResponse.body.data.id);

    const relayUsageCountBefore = await prisma.relayUsage.count({
      where: { relayTokenId: boundaryRelayTokenId },
    });

    const relayResponse = await request(app)
      .post("/relay/proxy/v1/chat/completions")
      .set("Authorization", `Bearer ${boundaryRelayTokenValue}`)
      .send({
        model: relayModelId,
        messages: [{ role: "user", content: "token partial coverage but no balance" }],
        stream: false,
      });

    expect(relayResponse.status).toBe(400);
    expect(String(relayResponse.body?.message || "")).toContain("Insufficient balance");

    const relayUsageCountAfter = await prisma.relayUsage.count({
      where: { relayTokenId: boundaryRelayTokenId },
    });
    expect(relayUsageCountAfter).toBe(relayUsageCountBefore);

    const monthlyUsageCount = await prisma.monthlyPassUsage.count({ where: { userMonthlyPassId: passId } });
    expect(monthlyUsageCount).toBe(0);

    const passAfter = await prisma.userMonthlyPass.findUnique({ where: { id: passId } });
    expect(Number(passAfter?.usedQuota || 0)).toBe(0);
    expect(Number(passAfter?.remainingQuota || 0)).toBe(10);
  });

  it("更新模板参数边界：request单位下 dailyQuota 小数应被拒绝", async () => {
    const body = {
      quotaUnit: "request",
      dailyQuota: 1.5,
    };

    const response = await putWithReplay(`/v1/monthly-passes/templates/${requestTemplateId}`, body)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body);

    expect([400, 422]).toContain(response.status);
  });

  it("分配参数边界：endAt 不晚于 startAt 应被拒绝", async () => {
    const startAt = new Date(Date.now() + 60 * 1000).toISOString();
    const body = {
      userId: testUserId,
      templateId: requestTemplateId,
      startAt,
      endAt: startAt,
      totalQuota: 1,
      quotaUnit: "request",
    };

    const response = await postWithReplay("/v1/monthly-passes/user-passes", body)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body);

    expect([400, 422]).toContain(response.status);
  });

  it("查询参数覆盖：模板列表支持 status/keyword/pageSize 过滤", async () => {
    const disabledTemplateListResponse = await request(app)
      .get(
        `/v1/monthly-passes/templates?page=1&pageSize=5&status=0&keyword=${encodeURIComponent(templateNameTemplateDisable)}`,
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(disabledTemplateListResponse.status).toBe(200);
    expect(disabledTemplateListResponse.body.code).toBe(0);
    expect(disabledTemplateListResponse.body.data.pageSize).toBe(5);
    expect(disabledTemplateListResponse.body.data.records.length).toBeLessThanOrEqual(5);
    expect(
      disabledTemplateListResponse.body.data.records.some(
        (item: { name: string; status: number }) =>
          String(item.name).includes(templateNameTemplateDisable) && item.status === 0,
      ),
    ).toBe(true);
  });

  it("查询参数覆盖：用户月卡列表支持 userId/templateId/status 过滤", async () => {
    const assignBody = {
      userId: boundaryUserId,
      templateId: requestTemplateId,
      startAt: new Date(Date.now() - 60 * 1000).toISOString(),
      endAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      totalQuota: 1,
      dailyQuota: 1,
      quotaUnit: "request",
      note: "query-filter-pass",
    };

    const assignResponse = await postWithReplay("/v1/monthly-passes/user-passes", assignBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(assignBody);
    expect(assignResponse.status).toBe(200);

    const userPassIdForQuery = String(assignResponse.body.data.id);

    const listResponse = await request(app)
      .get(
        `/v1/monthly-passes/user-passes?page=1&pageSize=20&userId=${boundaryUserId}&templateId=${requestTemplateId}&status=1`,
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.code).toBe(0);
    expect(listResponse.body.data.records.some((item: { id: string }) => item.id === userPassIdForQuery)).toBe(true);
  });

  it("查询参数边界：usage 查询非法日期应拒绝，合法日期应返回结果", async () => {
    const invalidDateResponse = await request(app)
      .get(`/v1/monthly-passes/usages?page=1&pageSize=20&startTime=${encodeURIComponent("not-a-date")}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect([400, 422]).toContain(invalidDateResponse.status);

    const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const endTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const validDateResponse = await request(app)
      .get(
        `/v1/monthly-passes/usages?page=1&pageSize=20&userId=${testUserId}&templateId=${amountTemplateId}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`,
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(validDateResponse.status).toBe(200);
    expect(validDateResponse.body.code).toBe(0);
    expect(Array.isArray(validDateResponse.body.data.records)).toBe(true);
  });

  it("查询参数边界：usage 查询 endTime 非法日期应拒绝", async () => {
    const invalidDateResponse = await request(app)
      .get(`/v1/monthly-passes/usages?page=1&pageSize=20&endTime=${encodeURIComponent("invalid-end-time")}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect([400, 422]).toContain(invalidDateResponse.status);
  });

  it("查询参数边界：模板列表 page=0 应归一化为 page=1", async () => {
    const response = await request(app)
      .get("/v1/monthly-passes/templates?page=0&pageSize=20")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.code).toBe(0);
    expect(response.body.data.page).toBe(1);
  });

  it("更新分配参数边界：startAt/endAt 同时更新且 endAt<=startAt 应拒绝", async () => {
    const startAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const body = {
      startAt,
      endAt: startAt,
    };

    const response = await putWithReplay(`/v1/monthly-passes/user-passes/${userPassId}`, body)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body);

    expect([400, 422]).toContain(response.status);
  });

  it("路径参数边界：更新不存在分配应返回404", async () => {
    const body = {
      note: "update-not-found",
    };

    const response = await putWithReplay("/v1/monthly-passes/user-passes/non-existent-user-pass-id", body)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body);

    expect(response.status).toBe(404);
  });

  it("我的月卡查询参数：status 过滤应生效", async () => {
    const assignBody = {
      userId: testUserId,
      templateId: requestTemplateId,
      startAt: new Date(Date.now() - 60 * 1000).toISOString(),
      endAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      totalQuota: 1,
      dailyQuota: 1,
      quotaUnit: "request",
      note: "me-status-filter",
    };

    const assignResponse = await postWithReplay("/v1/monthly-passes/user-passes", assignBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(assignBody);

    expect(assignResponse.status).toBe(200);
    const myPassId = String(assignResponse.body.data.id);

    const disableBody = {
      status: 0,
    };

    const disableResponse = await putWithReplay(`/v1/monthly-passes/user-passes/${myPassId}`, disableBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(disableBody);

    expect(disableResponse.status).toBe(200);
    expect(disableResponse.body.data.status).toBe(0);

    const myDisabledResponse = await request(app)
      .get("/v1/monthly-passes/me?page=1&pageSize=20&status=0")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(myDisabledResponse.status).toBe(200);
    expect(myDisabledResponse.body.code).toBe(0);
    expect(
      myDisabledResponse.body.data.records.some(
        (item: { id: string; status: number }) => item.id === myPassId && item.status === 0,
      ),
    ).toBe(true);
  });

  it("渠道匹配边界：不存在的 allowedChannels 不应保存", async () => {
    const templateBody = {
      name: templateNameChannelMismatch,
      defaultQuota: 2,
      dailyQuota: 2,
      quotaUnit: "request",
      allowedChannels: ["another-channel-not-match"],
    };

    const templateResponse = await postWithReplay("/v1/monthly-passes/templates", templateBody)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(templateBody);

    expect(templateResponse.status).toBe(400);
    expect(String(templateResponse.body?.message || "")).toContain(
      "Unknown, inactive, or inaccessible monthly pass channels",
    );
    await expect(
      prisma.monthlyPassTemplate.findUnique({ where: { name: templateNameChannelMismatch } }),
    ).resolves.toBeNull();
  });

  it("路径参数边界：删除不存在模板应返回404", async () => {
    await reauthenticate();

    const response = await deleteWithReplay("/v1/monthly-passes/templates/non-existent-template-id")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(response.status).toBe(404);
  });

  it("删除分配和模板成功", async () => {
    await reauthenticate();

    const deletePassResponse = await deleteWithReplay(`/v1/monthly-passes/user-passes/${userPassId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(deletePassResponse.status).toBe(200);
    expect(deletePassResponse.body.code).toBe(0);

    const deleteAmountTemplateResponse = await deleteWithReplay(`/v1/monthly-passes/templates/${amountTemplateId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});
    expect(deleteAmountTemplateResponse.status).toBe(200);
    expect(deleteAmountTemplateResponse.body.code).toBe(0);

    const deleteRequestTemplateResponse = await deleteWithReplay(`/v1/monthly-passes/templates/${requestTemplateId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});
    expect(deleteRequestTemplateResponse.status).toBe(200);
    expect(deleteRequestTemplateResponse.body.code).toBe(0);
  });
});
