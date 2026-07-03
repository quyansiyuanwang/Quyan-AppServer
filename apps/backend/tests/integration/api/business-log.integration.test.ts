import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../../src/app";
import { prisma } from "../../../src/config/database";
import { hashPassword } from "../../../src/util/crypto";
import { Permission } from "../../../src/constant/permission";
import { OperationCategory, OperationType } from "../../../src/constant/operation-type";
import { withReplayProtection } from "../../util/replay-protection-test-helper";

describe("Business Log API Integration", () => {
  let app: Express;
  let accessToken = "";
  let testUserId = "";
  let testGroupId = "";
  let createdChannelId = "";
  let createdManagedUserId = "";

  const shortSuffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)}`;
  const username = `blu_${shortSuffix}`;
  const groupUsername = `blg_${shortSuffix}`;
  const channelName = `blc_${shortSuffix}`;
  const loginRequestId = `login-${shortSuffix}`;
  const relayRequestId = `relay-${shortSuffix}`;
  const userCreateRequestId = `user-create-${shortSuffix}`;
  const createdUsername = `blt_${shortSuffix}`;

  const postWithReplay = (path: string, body: Record<string, unknown>, requestId?: string) => {
    const req = withReplayProtection(request(app).post(path), body, path).set("Authorization", `Bearer ${accessToken}`);
    if (requestId) req.set("x-request-id", requestId);
    return req.send(body);
  };

  beforeAll(async () => {
    app = createApp();

    const group = await prisma.group.create({
      data: {
        username: groupUsername,
        name: "Business Log API Test Group",
        level: 1,
        permissions: JSON.stringify([
          Permission.SYSTEM_BUSINESS_LOG_READ,
          Permission.RELAY_CHANNEL_CREATE,
          Permission.RELAY_CHANNEL_READ,
          Permission.RELAY_CHANNEL_DELETE,
          Permission.USER_CREATE,
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
    const loginRes = await withReplayProtection(request(app).post("/v1/auth/login"), loginBody, "/v1/auth/login")
      .set("x-request-id", loginRequestId)
      .send(loginBody);

    expect(loginRes.status).toBe(200);
    accessToken = loginRes.body.data.access_token;
  });

  afterAll(async () => {
    await prisma.businessLog.deleteMany({
      where: {
        OR: [
          { actorUserId: testUserId },
          { targetUserId: testUserId },
          ...(createdManagedUserId ? [{ targetUserId: createdManagedUserId }] : []),
        ],
      },
    });
    await prisma.relayToken.deleteMany({ where: { userId: testUserId } });
    await prisma.relayChannel.deleteMany({ where: { name: { contains: channelName } } });
    if (createdManagedUserId) await prisma.user.deleteMany({ where: { id: createdManagedUserId } });

    await prisma.user.deleteMany({ where: { id: testUserId } });
    await prisma.group.deleteMany({ where: { id: testGroupId } });
  });

  it("returns filter options from backend managed enums", async () => {
    const res = await request(app).get("/v1/business-logs/options").set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.operationTypes).toContain(OperationType.LOGIN_SUCCESS);
    expect(res.body.data.operationTypes).toContain(OperationType.RELAY_CHANNEL_CREATE);
    expect(res.body.data.operationCategories).toContain(OperationCategory.AUTH);
    expect(res.body.data.operationCategories).toContain(OperationCategory.RELAY);
  });

  it("rejects invalid enum filters", async () => {
    const res = await request(app)
      .get("/v1/business-logs")
      .query({ operationType: "NOT_A_REAL_OPERATION" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(422);
  });

  it("returns target usernames and request metadata in queried logs", async () => {
    const createUserBody = {
      username: createdUsername,
      password: "target_password",
      email: `${createdUsername}@example.com`,
      groupId: testGroupId,
    };

    const createUserRes = await postWithReplay("/v1/users/create", createUserBody, userCreateRequestId);
    expect(createUserRes.status).toBe(201);
    const createdUserSiteRequestId = String(createUserRes.headers["x-request-id"] || "");
    expect(createdUserSiteRequestId).toBeTruthy();
    createdManagedUserId = createUserRes.body.data.id;

    const createBody = {
      name: channelName,
      openaiUpstreamUrl: "https://upstream.example.com",
      openaiUpstreamApiKey: "test-openai-key",
      allowedFormats: "openai",
      multiplier: 1,
      addUserIdentifier: true,
    };

    const createRes = await postWithReplay("/v1/relay-channels", createBody, relayRequestId);
    expect(createRes.status).toBe(200);
    const relayCreateSiteRequestId = String(createRes.headers["x-request-id"] || "");
    expect(relayCreateSiteRequestId).toBeTruthy();
    createdChannelId = createRes.body.data.id;

    const userCreateLogsRes = await request(app)
      .get("/v1/business-logs")
      .query({
        page: 1,
        pageSize: 20,
        operationType: OperationType.USER_CREATE,
        actor: username,
      })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(userCreateLogsRes.status).toBe(200);
    const userCreateLog = (userCreateLogsRes.body.data.logs as Array<Record<string, unknown>>).find(
      (log) => log.requestId === createdUserSiteRequestId,
    );
    expect(userCreateLog).toBeTruthy();
    expect(userCreateLog).toMatchObject({
      operationType: OperationType.USER_CREATE,
      operationCategory: OperationCategory.USER_MANAGEMENT,
      actorUserId: testUserId,
      actorUsername: username,
      targetUserId: createdManagedUserId,
      targetUsername: createdUsername,
      requestId: createdUserSiteRequestId,
    });

    const relayLogsRes = await request(app)
      .get("/v1/business-logs")
      .query({
        page: 1,
        pageSize: 20,
        operationType: OperationType.RELAY_CHANNEL_CREATE,
        actor: username,
      })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(relayLogsRes.status).toBe(200);
    const relayLog = (relayLogsRes.body.data.logs as Array<Record<string, unknown>>).find(
      (log) => log.requestId === relayCreateSiteRequestId,
    );
    expect(relayLog).toBeTruthy();
    expect(relayLog).toMatchObject({
      operationType: OperationType.RELAY_CHANNEL_CREATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId: testUserId,
      actorUsername: username,
      targetResourceId: createdChannelId,
      requestId: relayCreateSiteRequestId,
    });
    expect(relayLog?.ipAddress).toBeTruthy();
  });
});
