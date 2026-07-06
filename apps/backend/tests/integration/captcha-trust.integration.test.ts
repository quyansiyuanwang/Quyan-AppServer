import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/config/database";
import { hashPassword } from "../../src/util/crypto";
import type { Express } from "express";
import { CustomCode } from "../../src/constant/custom-code";
import { withReplayProtection } from "../util/replay-protection-test-helper";
import * as captchaServiceModule from "../../src/services/auth/captcha.service";

describe("captcha trust integration", () => {
  let app: Express;
  let _testUser: any;
  let testGroup: any;

  const postWithReplay = (path: string, body: Record<string, unknown>) =>
    withReplayProtection(request(app).post(path), body, path).send(body);

  beforeAll(async () => {
    app = createApp();

    testGroup = await prisma.group.create({
      data: {
        username: "t_captcha_trust_grp",
        name: "Captcha Trust Test Group",
        level: 5,
        permissions: JSON.stringify([]),
      },
    });

    _testUser = await prisma.user.create({
      data: {
        username: "t_captcha_trust_user",
        password: hashPassword("test_password_123"),
        groupId: testGroup.id,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "t_captcha_trust_user" } });
    await prisma.group.deleteMany({ where: { username: "t_captcha_trust_grp" } });
  });

  it("accepts verify-and-trust with replay protection and explicit provider", async () => {
    const verifySpy = vi
      .spyOn(captchaServiceModule.CaptchaService.getInstance(), "verifyTokenWithProvider")
      .mockResolvedValueOnce();

    const response = await postWithReplay("/v1/auth/captcha/verify-and-trust", {
      captchaToken: "token-1",
      action: "login",
      provider: "turnstile",
    });

    expect(response.status).toBe(200);
    expect(response.body.code).toBe(CustomCode.OK);
    expect(response.body.data).toMatchObject({
      trusted: true,
    });
    expect(verifySpy).toHaveBeenCalledWith("turnstile", "token-1", "login", expect.anything());
  });

  it("rejects replayless trust establishment request", async () => {
    const response = await request(app).post("/v1/auth/captcha/verify-and-trust").send({
      captchaToken: "token-1",
      action: "login",
      provider: "turnstile",
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(CustomCode.REQUIRE_REPLAY_PROTECTION);
  });

  it("public captcha config exposes explicit enabled field", async () => {
    const response = await request(app).get("/v1/config/public/captcha");

    expect(response.status).toBe(200);
    expect(response.body.code).toBe(CustomCode.OK);
    expect(response.body.data).toHaveProperty("enabled");
    expect(response.body.data).toHaveProperty("provider");
    expect(response.body.data).toHaveProperty("fallbackProvider");
  });

  it("requires captcha trust on protected endpoint when bypass is not granted", async () => {
    const enabledSpy = vi
      .spyOn(captchaServiceModule.CaptchaService.getInstance(), "isEnabled")
      .mockResolvedValueOnce(true);

    const bypassSpy = vi
      .spyOn(captchaServiceModule.CaptchaService.getInstance(), "shouldBypassForTrustedRequest")
      .mockResolvedValueOnce(false);

    const response = await postWithReplay("/v1/auth/login", {
      username: "t_captcha_trust_user",
      password: "test_password_123",
      agreedToLegalPolicies: true,
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(CustomCode.CAPTCHA_TRUST_REQUIRED);
    expect(enabledSpy).toHaveBeenCalled();
    expect(bypassSpy).toHaveBeenCalled();
  });
});
