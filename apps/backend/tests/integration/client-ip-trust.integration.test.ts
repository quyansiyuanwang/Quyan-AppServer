import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/config/database";
import { hashPassword } from "../../src/util/crypto";
import { Permission } from "../../src/constant/permission";
import { withReplayProtection } from "../util/replay-protection-test-helper";

const SPOOFED_FORWARDED_IP = "198.51.100.73";

describe("客户端 IP 信任边界集成测试", () => {
  let app: Express;
  let userId: string;
  let groupId: string;
  let accessToken: string;

  beforeAll(async () => {
    app = createApp();

    const group = await prisma.group.create({
      data: {
        username: "t_ip_trust_grp",
        name: "客户端 IP 信任边界测试组",
        level: 5,
        permissions: JSON.stringify([Permission.SYSTEM_STATS_READ]),
      },
    });
    groupId = group.id;

    const user = await prisma.user.create({
      data: {
        username: "t_ip_trust_user",
        password: hashPassword("client_ip_trust_password"),
        groupId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    userId = user.id;

    const loginBody = {
      username: "t_ip_trust_user",
      password: "client_ip_trust_password",
      agreedToLegalPolicies: true,
    };
    const loginResponse = await withReplayProtection(request(app).post("/v1/auth/login"), loginBody, "/v1/auth/login")
      .send(loginBody)
      .expect(200);
    accessToken = loginResponse.body.data.access_token;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.group.deleteMany({ where: { id: groupId } });
  });

  it("should reject a spoofed X-Forwarded-For header for authenticated client IP lookup", async () => {
    const response = await request(app)
      .get("/v1/system/client-ip")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("X-Forwarded-For", SPOOFED_FORWARDED_IP)
      .expect(200);

    expect(response.body.code).toBe(0);
    expect(response.body.data.ip).toBe("127.0.0.1");
    expect(response.body.data.ip).not.toBe(SPOOFED_FORWARDED_IP);
  });

  it("should persist the socket IP instead of a spoofed forwarding header for public analytics", async () => {
    const response = await request(app)
      .post("/v1/track/batch")
      .set("X-Forwarded-For", SPOOFED_FORWARDED_IP)
      .send({
        events: [
          {
            eventType: "pageview",
            name: "client-ip-trust-test",
            page: "/integration/client-ip-trust",
            sessionId: "client-ip-trust-session",
            clientTime: Date.now(),
            deviceInfo: {
              ua: "vitest",
              screenW: 1280,
              screenH: 720,
              language: "en-US",
            },
          },
        ],
      })
      .expect(200);

    expect(response.body.code).toBe(0);
    expect(response.body.data).toEqual({ success: true });

    const event = await prisma.trackEvent.findFirstOrThrow({
      where: { name: "client-ip-trust-test" },
      select: { ip: true },
    });
    expect(event.ip).toBe("127.0.0.1");
    expect(event.ip).not.toBe(SPOOFED_FORWARDED_IP);
  });
});
