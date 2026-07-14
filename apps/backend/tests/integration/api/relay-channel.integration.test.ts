import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../../src/app";
import { prisma } from "../../../src/config/database";
import { hashPassword } from "../../../src/util/crypto";
import { Permission } from "../../../src/constant/permission";
import { withReplayProtection } from "../../util/replay-protection-test-helper";

describe("Relay Channel API Integration", () => {
  let app: Express;
  let accessToken = "";
  let testUserId = "";
  let testGroupId = "";
  let createdChannelId = "";
  let readOnlyAccessToken = "";
  let readOnlyUserId = "";
  let readOnlyGroupId = "";

  const shortSuffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)}`;
  const username = `rcu_${shortSuffix}`;
  const groupName = `rcg_${shortSuffix}`;
  const readOnlyUsername = `rcr_${shortSuffix}`;
  const readOnlyGroupName = `rcrg_${shortSuffix}`;
  const channelName = `rcc_${shortSuffix}`;

  const postWithReplay = (path: string, body: Record<string, unknown>) =>
    withReplayProtection(request(app).post(path), body, path).set("Authorization", `Bearer ${accessToken}`).send(body);

  const putWithReplay = (path: string, body: Record<string, unknown>) =>
    withReplayProtection(request(app).put(path), body, path).set("Authorization", `Bearer ${accessToken}`).send(body);

  const deleteWithReplay = (path: string, body: Record<string, unknown> = {}) =>
    withReplayProtection(request(app).delete(path), body, path)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body);

  beforeAll(async () => {
    app = createApp();

    const group = await prisma.group.create({
      data: {
        username: groupName,
        name: "Relay Channel API Test Group",
        level: 1,
        permissions: JSON.stringify([
          Permission.RELAY_CHANNEL_CREATE,
          Permission.RELAY_CHANNEL_READ,
          Permission.RELAY_CHANNEL_UPDATE,
          Permission.RELAY_CHANNEL_DELETE,
        ]),
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

    const loginBody = {
      username,
      password: "test_password",
      agreedToLegalPolicies: true,
    };
    const loginRes = await withReplayProtection(request(app).post("/v1/auth/login"), loginBody, "/v1/auth/login").send(
      loginBody,
    );
    accessToken = loginRes.body.data.access_token;

    const readOnlyGroup = await prisma.group.create({
      data: {
        username: readOnlyGroupName,
        name: "Relay Channel Readonly Test Group",
        level: 1,
        permissions: JSON.stringify([Permission.RELAY_CHANNEL_READ]),
      },
    });
    readOnlyGroupId = readOnlyGroup.id;

    const readOnlyUser = await prisma.user.create({
      data: {
        username: readOnlyUsername,
        password: hashPassword("test_password"),
        groupId: readOnlyGroupId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    readOnlyUserId = readOnlyUser.id;

    const readOnlyLoginBody = {
      username: readOnlyUsername,
      password: "test_password",
      agreedToLegalPolicies: true,
    };
    const readOnlyLoginRes = await withReplayProtection(
      request(app).post("/v1/auth/login"),
      readOnlyLoginBody,
      "/v1/auth/login",
    ).send(readOnlyLoginBody);
    readOnlyAccessToken = readOnlyLoginRes.body.data.access_token;
  });

  afterAll(async () => {
    await prisma.relayChannelMember.deleteMany({
      where: {
        OR: [
          { relayChannel: { name: { contains: channelName } } },
          { memberChannel: { name: { contains: channelName } } },
        ],
      },
    });
    await prisma.relayToken.deleteMany({ where: { userId: testUserId } });
    await prisma.relayChannel.deleteMany({ where: { name: { contains: channelName } } });
    await prisma.user.deleteMany({ where: { id: readOnlyUserId } });
    await prisma.group.deleteMany({ where: { id: readOnlyGroupId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
    await prisma.group.deleteMany({ where: { id: testGroupId } });
  });

  it("creates, reads, updates, and deletes relay channel", async () => {
    const createBody = {
      name: channelName,
      openaiUpstreamUrl: "https://upstream.example.com",
      openaiUpstreamApiKey: "test-openai-key",
      allowedFormats: "openai",
      multiplier: 1,
      addUserIdentifier: true,
    };

    const createRes = await postWithReplay("/v1/relay-channels", createBody);
    expect(createRes.status).toBe(200);
    expect(createRes.body?.data?.id).toBeTruthy();
    createdChannelId = createRes.body.data.id;

    const listRes = await request(app).get("/v1/relay-channels").set("Authorization", `Bearer ${accessToken}`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data.some((item: { id: string }) => item.id === createdChannelId)).toBe(true);
    expect(listRes.body.data.find((item: { id: string }) => item.id === createdChannelId)?.enabled).toBe(true);

    const getRes = await request(app)
      .get(`/v1/relay-channels/${createdChannelId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.id).toBe(createdChannelId);

    const updateRes = await putWithReplay(`/v1/relay-channels/${createdChannelId}`, {
      name: `${channelName}_updated`,
      multiplier: 1.5,
      allowedFormats: "openai",
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.multiplier).toBe(1.5);

    const disableRes = await withReplayProtection(
      request(app).patch(`/v1/relay-channels/${createdChannelId}/toggle`),
      {},
      `/v1/relay-channels/${createdChannelId}/toggle`,
    )
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.data.enabled).toBe(false);

    const activeListAfterDisableRes = await request(app)
      .get("/v1/relay-channels")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(activeListAfterDisableRes.status).toBe(200);
    expect(activeListAfterDisableRes.body.data.some((item: { id: string }) => item.id === createdChannelId)).toBe(
      false,
    );

    const visibleListRes = await request(app)
      .get("/v1/relay-channels")
      .query({ includeDisabled: true })
      .set("Authorization", `Bearer ${accessToken}`);
    expect(visibleListRes.status).toBe(200);
    expect(
      visibleListRes.body.data.some((item: { id: string; enabled: boolean }) => item.id === createdChannelId),
    ).toBe(true);

    const enableRes = await withReplayProtection(
      request(app).patch(`/v1/relay-channels/${createdChannelId}/toggle`),
      {},
      `/v1/relay-channels/${createdChannelId}/toggle`,
    )
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});
    expect(enableRes.status).toBe(200);
    expect(enableRes.body.data.enabled).toBe(true);

    const deleteRes = await deleteWithReplay(`/v1/relay-channels/${createdChannelId}`);
    expect(deleteRes.status).toBe(200);

    const toggleAfterDeleteRes = await withReplayProtection(
      request(app).patch(`/v1/relay-channels/${createdChannelId}/toggle`),
      {},
      `/v1/relay-channels/${createdChannelId}/toggle`,
    )
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});
    expect(toggleAfterDeleteRes.status).toBe(404);

    const getAfterDeleteRes = await request(app)
      .get(`/v1/relay-channels/${createdChannelId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(getAfterDeleteRes.status).toBe(404);
  });

  it("rejects channel creation with duplicate model IDs in allowedModels", async () => {
    // First, create model pricing entries with same model ID
    const modelId = "test-model-id";
    const model1 = await prisma.modelPricing.create({
      data: {
        model: "test-model-premium",
        provider: modelId,
        inputPrice: 0.01,
        outputPrice: 0.02,
      },
    });
    const model2 = await prisma.modelPricing.create({
      data: {
        model: "test-model-standard",
        provider: modelId,
        inputPrice: 0.005,
        outputPrice: 0.01,
      },
    });

    try {
      const createBody = {
        name: `${channelName}_duplicate_test`,
        openaiUpstreamUrl: "https://upstream.example.com",
        openaiUpstreamApiKey: "test-openai-key",
        allowedFormats: "openai",
        multiplier: 1,
        addUserIdentifier: true,
        allowedModels: JSON.stringify(["test-model-premium", "test-model-standard"]),
      };

      const createRes = await postWithReplay("/v1/relay-channels", createBody);
      expect(createRes.status).toBe(400);
      expect(createRes.body.message).toContain("duplicate model IDs");
      expect(createRes.body.message).toContain(modelId);
    } finally {
      await prisma.modelPricing.deleteMany({ where: { id: { in: [model1.id, model2.id] } } });
    }
  });

  it("rejects channel update with duplicate model IDs in allowedModels", async () => {
    // Create a valid channel first
    const createBody = {
      name: `${channelName}_update_duplicate_test`,
      openaiUpstreamUrl: "https://upstream.example.com",
      openaiUpstreamApiKey: "test-openai-key",
      allowedFormats: "openai",
      multiplier: 1,
      addUserIdentifier: true,
    };

    const createRes = await postWithReplay("/v1/relay-channels", createBody);
    expect(createRes.status).toBe(200);
    const channelId = createRes.body.data.id;

    // Create model pricing entries with same model ID
    const modelId = "test-model-id-update";
    const model1 = await prisma.modelPricing.create({
      data: {
        model: "test-model-premium-update",
        provider: modelId,
        inputPrice: 0.01,
        outputPrice: 0.02,
      },
    });
    const model2 = await prisma.modelPricing.create({
      data: {
        model: "test-model-standard-update",
        provider: modelId,
        inputPrice: 0.005,
        outputPrice: 0.01,
      },
    });

    try {
      const updateBody = {
        allowedModels: JSON.stringify(["test-model-premium-update", "test-model-standard-update"]),
      };

      const updateRes = await putWithReplay(`/v1/relay-channels/${channelId}`, updateBody);
      expect(updateRes.status).toBe(400);
      expect(updateRes.body.message).toContain("duplicate model IDs");
      expect(updateRes.body.message).toContain(modelId);
    } finally {
      await prisma.modelPricing.deleteMany({ where: { id: { in: [model1.id, model2.id] } } });
      await deleteWithReplay(`/v1/relay-channels/${channelId}`);
    }
  });

  it("allows channel creation with unique model IDs", async () => {
    // Create model pricing entries with different model IDs
    const model1 = await prisma.modelPricing.create({
      data: {
        model: "test-model-unique-1",
        provider: "test-model-id-1",
        inputPrice: 0.01,
        outputPrice: 0.02,
      },
    });
    const model2 = await prisma.modelPricing.create({
      data: {
        model: "test-model-unique-2",
        provider: "test-model-id-2",
        inputPrice: 0.005,
        outputPrice: 0.01,
      },
    });

    try {
      const createBody = {
        name: `${channelName}_unique_test`,
        openaiUpstreamUrl: "https://upstream.example.com",
        openaiUpstreamApiKey: "test-openai-key",
        allowedFormats: "openai",
        multiplier: 1,
        addUserIdentifier: true,
        allowedModels: JSON.stringify(["test-model-unique-1", "test-model-unique-2"]),
      };

      const createRes = await postWithReplay("/v1/relay-channels", createBody);
      expect(createRes.status).toBe(200);
      expect(createRes.body.data.id).toBeTruthy();

      await deleteWithReplay(`/v1/relay-channels/${createRes.body.data.id}`);
    } finally {
      await prisma.modelPricing.deleteMany({ where: { id: { in: [model1.id, model2.id] } } });
    }
  });

  it("creates pooled channels with persisted auto allowed-model mode and pool members", async () => {
    const member1 = await prisma.relayChannel.create({
      data: {
        name: `${channelName}_pool_member_1`,
        openaiUpstreamUrl: "https://member-1.example.com",
        openaiUpstreamApiKey: "member-1-key",
        allowedFormats: "openai",
        multiplier: 1,
      },
    });
    const member2 = await prisma.relayChannel.create({
      data: {
        name: `${channelName}_pool_member_2`,
        openaiUpstreamUrl: "https://member-2.example.com",
        openaiUpstreamApiKey: "member-2-key",
        allowedFormats: "openai",
        multiplier: 1,
      },
    });

    const createBody = {
      name: `${channelName}_pooled_auto`,
      channelType: "pooled",
      routingStrategy: "round-robin",
      allowedFormats: "openai",
      routingConfig: {
        maxRetries: 2,
        retryStatusCodes: ["4xx", "5xx"],
        healthScoreThreshold: null,
        latencyThresholdMs: null,
        circuitBreakerThreshold: null,
        allowedModelsMode: "auto",
      },
      poolMembers: [
        {
          memberChannelId: member1.id,
          priority: 1,
          weight: 3,
          enabled: true,
        },
        {
          memberChannelId: member2.id,
          priority: 2,
          weight: 1,
          enabled: true,
        },
      ],
    };

    const createRes = await postWithReplay("/v1/relay-channels", createBody);
    expect(createRes.status).toBe(200);

    const pooledChannelId = createRes.body.data.id as string;
    expect(createRes.body.data.channelType).toBe("pooled");
    expect(createRes.body.data.routingConfig.allowedModelsMode).toBe("auto");

    const persisted = await prisma.relayChannel.findUnique({
      where: { id: pooledChannelId },
      include: { poolMembers: { orderBy: { priority: "asc" } } },
    });
    expect(persisted).toBeTruthy();
    expect(persisted?.channelType).toBe("pooled");
    expect((persisted?.routingConfig as Record<string, unknown>)?.allowedModelsMode).toBe("auto");
    expect(persisted?.poolMembers).toHaveLength(2);
    expect(persisted?.poolMembers.map((member) => member.memberChannelId)).toEqual([member1.id, member2.id]);

    const getRes = await request(app)
      .get(`/v1/relay-channels/${pooledChannelId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.poolMembers).toHaveLength(2);

    await deleteWithReplay(`/v1/relay-channels/${pooledChannelId}`);
  });

  it("persists explicit null threshold clearing on update", async () => {
    const createRes = await postWithReplay("/v1/relay-channels", {
      name: `${channelName}_threshold_clear`,
      openaiUpstreamUrl: "https://threshold.example.com",
      openaiUpstreamApiKey: "threshold-key",
      allowedFormats: "openai",
      routingConfig: {
        maxRetries: 2,
        healthScoreThreshold: 0.9,
        latencyThresholdMs: 800,
        circuitBreakerThreshold: 5,
      },
    });
    expect(createRes.status).toBe(200);

    const channelId = createRes.body.data.id as string;

    const updateRes = await putWithReplay(`/v1/relay-channels/${channelId}`, {
      routingConfig: {
        maxRetries: 2,
        healthScoreThreshold: null,
        latencyThresholdMs: null,
        circuitBreakerThreshold: null,
      },
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.routingConfig.healthScoreThreshold).toBeNull();
    expect(updateRes.body.data.routingConfig.latencyThresholdMs).toBeNull();
    expect(updateRes.body.data.routingConfig.circuitBreakerThreshold).toBeNull();

    const persisted = await prisma.relayChannel.findUnique({ where: { id: channelId } });
    expect((persisted?.routingConfig as Record<string, unknown>)?.healthScoreThreshold).toBeNull();
    expect((persisted?.routingConfig as Record<string, unknown>)?.latencyThresholdMs).toBeNull();
    expect((persisted?.routingConfig as Record<string, unknown>)?.circuitBreakerThreshold).toBeNull();

    await deleteWithReplay(`/v1/relay-channels/${channelId}`);
  });

  it("hides private channels from readonly users but exposes group-whitelisted channels", async () => {
    const privateCreateRes = await postWithReplay("/v1/relay-channels", {
      name: `${channelName}_private_visibility`,
      openaiUpstreamUrl: "https://private.example.com",
      openaiUpstreamApiKey: "private-key",
      allowedFormats: "openai",
      visibilityMode: "private",
    });
    expect(privateCreateRes.status).toBe(200);
    const privateChannelId = privateCreateRes.body.data.id as string;

    const whitelistCreateRes = await postWithReplay("/v1/relay-channels", {
      name: `${channelName}_group_visibility`,
      openaiUpstreamUrl: "https://group.example.com",
      openaiUpstreamApiKey: "group-key",
      allowedFormats: "openai",
      visibilityMode: "whitelist",
      visibilityConfig: {
        groupIds: [readOnlyGroupId],
      },
    });
    expect(whitelistCreateRes.status).toBe(200);
    const whitelistChannelId = whitelistCreateRes.body.data.id as string;

    const readonlyListRes = await request(app)
      .get("/v1/relay-channels")
      .set("Authorization", `Bearer ${readOnlyAccessToken}`);
    expect(readonlyListRes.status).toBe(200);
    expect(readonlyListRes.body.data.some((item: { id: string }) => item.id === privateChannelId)).toBe(false);
    expect(readonlyListRes.body.data.some((item: { id: string }) => item.id === whitelistChannelId)).toBe(true);

    const readonlyPrivateGetRes = await request(app)
      .get(`/v1/relay-channels/${privateChannelId}`)
      .set("Authorization", `Bearer ${readOnlyAccessToken}`);
    expect(readonlyPrivateGetRes.status).toBe(404);

    const readonlyWhitelistGetRes = await request(app)
      .get(`/v1/relay-channels/${whitelistChannelId}`)
      .set("Authorization", `Bearer ${readOnlyAccessToken}`);
    expect(readonlyWhitelistGetRes.status).toBe(200);

    await deleteWithReplay(`/v1/relay-channels/${privateChannelId}`);
    await deleteWithReplay(`/v1/relay-channels/${whitelistChannelId}`);
  });
});
