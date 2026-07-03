import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../../src/app";
import { prisma } from "../../../src/config/database";
import { hashPassword } from "../../../src/util/crypto";
import { withReplayProtection } from "../../util/replay-protection-test-helper";

describe("Chat Conversation API Integration", () => {
  let app: Express;
  let accessToken = "";
  let userId = "";
  let groupId = "";
  let conversationId = "";

  const shortSuffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)}`;
  const username = `ccu_${shortSuffix}`;
  const groupUsername = `ccg_${shortSuffix}`;

  beforeAll(async () => {
    app = createApp();

    const group = await prisma.group.create({
      data: {
        username: groupUsername,
        name: "Chat Conversation Test Group",
        level: 10,
        permissions: JSON.stringify([]),
      },
    });
    groupId = group.id;

    const user = await prisma.user.create({
      data: {
        username,
        password: hashPassword("test_password"),
        groupId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    userId = user.id;

    const loginBody = {
      username,
      password: "test_password",
      agreedToLegalPolicies: true,
    };
    const loginRes = await withReplayProtection(request(app).post("/v1/auth/login"), loginBody, "/v1/auth/login").send(
      loginBody,
    );
    accessToken = loginRes.body.data.access_token;
  });

  afterAll(async () => {
    if (conversationId)
      await prisma.message.deleteMany({
        where: { conversationId },
      });

    if (conversationId)
      await prisma.conversation.deleteMany({
        where: { id: conversationId },
      });

    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.group.deleteMany({ where: { id: groupId } });
  });

  it("supports conversation CRUD and message listing", async () => {
    const createRes = await withReplayProtection(
      request(app).post("/v1/chat/conversations").set("Authorization", `Bearer ${accessToken}`),
      { title: "My Conversation" },
      "/v1/chat/conversations",
    ).send({ title: "My Conversation" });

    expect(createRes.status).toBe(200);
    expect(createRes.body.data.id).toBeTruthy();
    conversationId = createRes.body.data.id;

    const listRes = await request(app).get("/v1/chat/conversations").set("Authorization", `Bearer ${accessToken}`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.data.conversations)).toBe(true);
    expect(listRes.body.data.conversations.some((item: { id: string }) => item.id === conversationId)).toBe(true);

    const getRes = await request(app)
      .get(`/v1/chat/conversations/${conversationId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.id).toBe(conversationId);

    const updateRes = await withReplayProtection(
      request(app).put(`/v1/chat/conversations/${conversationId}`).set("Authorization", `Bearer ${accessToken}`),
      { title: "Updated Title" },
      `/v1/chat/conversations/${conversationId}`,
    ).send({ title: "Updated Title" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.title).toBe("Updated Title");

    const messagesRes = await request(app)
      .get(`/v1/chat/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(messagesRes.status).toBe(200);
    expect(Array.isArray(messagesRes.body.data)).toBe(true);

    const deleteRes = await withReplayProtection(
      request(app).delete(`/v1/chat/conversations/${conversationId}`).set("Authorization", `Bearer ${accessToken}`),
      {},
      `/v1/chat/conversations/${conversationId}`,
    ).send({});
    expect(deleteRes.status).toBe(200);

    const getAfterDeleteRes = await request(app)
      .get(`/v1/chat/conversations/${conversationId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(getAfterDeleteRes.status).toBe(404);
  });
});
