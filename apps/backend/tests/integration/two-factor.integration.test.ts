import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createHmac } from "crypto";
import { createApp } from "../../src/app";
import { prisma } from "../../src/config/database";
import { hashPassword } from "../../src/util/crypto";
import { withReplayProtection } from "../util/replay-protection-test-helper";
import type { Express } from "express";

const TOTP_INTERVAL_SECONDS = 30;

function base32ToBuffer(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = input.toUpperCase().replace(/=+$/, "");
  let bits = "";

  for (const char of normalized) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error("Invalid base32 secret");
    bits += value.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));

  return Buffer.from(bytes);
}

function generateTotpCode(secret: string): string {
  const key = base32ToBuffer(secret);
  const counter = Math.floor(Date.now() / 1000 / TOTP_INTERVAL_SECONDS);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter % 0x100000000, 4);

  const hmac = createHmac("sha1", key);
  hmac.update(counterBuffer);
  const digest = hmac.digest();

  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;

  const otp = binary % 10 ** 6;
  return otp.toString().padStart(6, "0");
}

describe("2FA integration flow", () => {
  let app: Express;
  let testGroupId = "";
  let testUserId = "";
  let trustedFlowUserId = "";

  const username = "tf_it_user";
  const password = "two_factor_password";
  const trustedFlowUsername = "tf_it_user_td";
  const trustedFlowPassword = "two_factor_password_td";

  const login = async (credentials?: { username: string; password: string }) => {
    const loginBody = { ...(credentials || { username, password }), agreedToLegalPolicies: true };
    const response = await withReplayProtection(request(app).post("/v1/auth/login"), loginBody, "/v1/auth/login")
      .send(loginBody)
      .expect(200);

    return response.body.data;
  };

  const extractRefreshCookie = (response: { headers: Record<string, unknown> }) => {
    const setCookie = response.headers["set-cookie"];
    const cookies = Array.isArray(setCookie) ? setCookie : [];
    const refreshCookie = cookies.find(
      (cookie): cookie is string => typeof cookie === "string" && cookie.startsWith("refresh_token="),
    );

    expect(refreshCookie).toBeTruthy();
    return refreshCookie!.split(";")[0]!;
  };

  beforeAll(async () => {
    app = createApp();

    const group = await prisma.group.create({
      data: {
        username: "two_factor_integration_group",
        name: "two factor integration group",
        level: 5,
        permissions: JSON.stringify([]),
      },
    });
    testGroupId = group.id;

    const user = await prisma.user.create({
      data: {
        username,
        password: hashPassword(password),
        email: "two-factor-integration@example.com",
        groupId: testGroupId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    testUserId = user.id;

    const trustedFlowUser = await prisma.user.create({
      data: {
        username: trustedFlowUsername,
        password: hashPassword(trustedFlowPassword),
        email: "two-factor-integration-trusted@example.com",
        groupId: testGroupId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    trustedFlowUserId = trustedFlowUser.id;
  });

  afterAll(async () => {
    if (testUserId) {
      await prisma.twoFactorCredential.deleteMany({ where: { userId: testUserId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: testUserId } }).catch(() => undefined);
    }

    if (trustedFlowUserId) {
      await prisma.twoFactorCredential.deleteMany({ where: { userId: trustedFlowUserId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: trustedFlowUserId } }).catch(() => undefined);
    }

    if (testGroupId) await prisma.group.deleteMany({ where: { id: testGroupId } }).catch(() => undefined);
  });

  it("supports setup, challenge login verification, and recovery-code disable", async () => {
    const initialLoginData = await login();
    const accessToken = initialLoginData.access_token as string;

    const setupPath = "/v1/users/me/2fa/setup";
    const setupResponse = await withReplayProtection(request(app).post(setupPath), undefined, setupPath)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const setupToken = setupResponse.body.data.setupToken as string;
    const secret = setupResponse.body.data.secret as string;
    expect(setupToken).toBeTruthy();
    expect(secret).toBeTruthy();

    const confirmPath = "/v1/users/me/2fa/confirm";
    const confirmBody = {
      setupToken,
      code: generateTotpCode(secret),
    };
    const confirmResponse = await withReplayProtection(request(app).post(confirmPath), confirmBody, confirmPath)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(confirmBody)
      .expect(200);

    const recoveryCodes = confirmResponse.body.data.recoveryCodes as string[];
    expect(confirmResponse.body.data.enabled).toBe(true);
    expect(Array.isArray(recoveryCodes)).toBe(true);
    expect(recoveryCodes.length).toBeGreaterThan(0);

    const challengedLoginData = await login();
    expect(challengedLoginData.requiresTwoFactor).toBe(true);
    expect(challengedLoginData.challengeToken).toBeTruthy();

    const verifyPath = "/v1/auth/verify-2fa";
    const verifyBody = {
      challengeToken: challengedLoginData.challengeToken,
      code: generateTotpCode(secret),
    };
    const verifyResponse = await withReplayProtection(request(app).post(verifyPath), verifyBody, verifyPath)
      .send(verifyBody)
      .expect(200);

    const verifiedAccessToken = verifyResponse.body.data.access_token as string;
    expect(verifiedAccessToken).toBeTruthy();
    expect(verifyResponse.body.data).not.toHaveProperty("refresh_token");
    const verifiedRefreshCookie = extractRefreshCookie(verifyResponse);

    const invalidVerifyBody = {
      challengeToken: "invalid-challenge-token",
      code: generateTotpCode(secret),
    };
    await withReplayProtection(request(app).post(verifyPath), invalidVerifyBody, verifyPath)
      .send(invalidVerifyBody)
      .expect(401);

    const regeneratePath = "/v1/users/me/2fa/recovery-codes/regenerate";
    const regenerateBody = {
      code: generateTotpCode(secret),
    };
    const regenerateResponse = await withReplayProtection(
      request(app).post(regeneratePath),
      regenerateBody,
      regeneratePath,
    )
      .set("Authorization", `Bearer ${verifiedAccessToken}`)
      .send(regenerateBody)
      .expect(200);

    const regeneratedRecoveryCodes = regenerateResponse.body.data.recoveryCodes as string[];
    expect(Array.isArray(regeneratedRecoveryCodes)).toBe(true);
    expect(regeneratedRecoveryCodes.length).toBeGreaterThan(0);

    // Old recovery codes should become invalid right after regeneration.
    const disableWithOldCodeBody = {
      recoveryCode: recoveryCodes[0],
    };
    await withReplayProtection(
      request(app).post("/v1/users/me/2fa/disable"),
      disableWithOldCodeBody,
      "/v1/users/me/2fa/disable",
    )
      .set("Authorization", `Bearer ${verifiedAccessToken}`)
      .send(disableWithOldCodeBody)
      .expect(401);

    const disablePath = "/v1/users/me/2fa/disable";
    const disableBody = {
      recoveryCode: regeneratedRecoveryCodes[0],
    };
    const disableResponse = await withReplayProtection(request(app).post(disablePath), disableBody, disablePath)
      .set("Authorization", `Bearer ${verifiedAccessToken}`)
      .send(disableBody)
      .expect(200);

    expect(disableResponse.body.data.enabled).toBe(false);
    expect(disableResponse.body.data.passkeyRequired).toBe(false);

    // Disabling 2FA should invalidate existing sessions immediately.
    await request(app).get("/v1/users/me").set("Authorization", `Bearer ${verifiedAccessToken}`).expect(401);

    await withReplayProtection(
      request(app).post("/v1/auth/refresh").set("Cookie", verifiedRefreshCookie),
      {},
      "/v1/auth/refresh",
    )
      .send({})
      .expect(401);
  });

  it("supports trusted-device create, verify-hit login, and delete-to-require-2fa-again flow", async () => {
    const agent = request.agent(app);

    await prisma.twoFactorCredential.deleteMany({ where: { userId: trustedFlowUserId } });
    await prisma.user.update({
      where: { id: trustedFlowUserId },
      data: {
        twoFactorEnabled: false,
        twoFactorPasskeyRequired: false,
      },
    });

    const trustedCredentials = {
      username: trustedFlowUsername,
      password: trustedFlowPassword,
      agreedToLegalPolicies: true,
    };

    const initialLoginData = await login(trustedCredentials);
    expect(initialLoginData.requiresTwoFactor).toBeUndefined();
    const accessToken = initialLoginData.access_token as string;

    const setupPath = "/v1/users/me/2fa/setup";
    const setupResponse = await withReplayProtection(agent.post(setupPath), undefined, setupPath)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const setupToken = setupResponse.body.data.setupToken as string;
    const secret = setupResponse.body.data.secret as string;

    const confirmPath = "/v1/users/me/2fa/confirm";
    const confirmBody = {
      setupToken,
      code: generateTotpCode(secret),
    };
    await withReplayProtection(agent.post(confirmPath), confirmBody, confirmPath)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(confirmBody)
      .expect(200);

    const challengeLoginData = await login(trustedCredentials);
    expect(challengeLoginData.requiresTwoFactor).toBe(true);

    const verifyPath = "/v1/auth/verify-2fa";
    const verifyBody = {
      challengeToken: challengeLoginData.challengeToken,
      code: generateTotpCode(secret),
    };
    const verifyResponse = await withReplayProtection(agent.post(verifyPath), verifyBody, verifyPath)
      .send(verifyBody)
      .expect(200);

    const verifiedAccessToken = verifyResponse.body.data.access_token as string;
    expect(verifiedAccessToken).toBeTruthy();

    const trustedLoginBody = trustedCredentials;
    const trustedLoginResponse = await withReplayProtection(
      agent.post("/v1/auth/login"),
      trustedLoginBody,
      "/v1/auth/login",
    )
      .send(trustedLoginBody)
      .expect(200);

    expect(trustedLoginResponse.body.data.requiresTwoFactor).toBeUndefined();
    expect(trustedLoginResponse.body.data.access_token).toBeTruthy();

    const listResponse = await agent
      .get("/v1/users/me/2fa/trusted-devices?page=1&pageSize=10")
      .set("Authorization", `Bearer ${verifiedAccessToken}`)
      .expect(200);

    const trustedDevices = listResponse.body.data.devices as Array<{ deviceId: string; lastUsedAt: string | null }>;
    expect(trustedDevices.length).toBeGreaterThan(0);
    expect(trustedDevices[0]?.lastUsedAt).toBeTruthy();
    const currentDeviceId = trustedDevices[0]!.deviceId;

    const deletePath = `/v1/users/me/2fa/trusted-devices/${currentDeviceId}`;
    const deleteResponse = await withReplayProtection(agent.delete(deletePath), undefined, deletePath)
      .set("Authorization", `Bearer ${verifiedAccessToken}`)
      .expect(200);

    expect(deleteResponse.body.data.removed).toBe(true);

    const afterDeleteLoginResponse = await withReplayProtection(
      agent.post("/v1/auth/login"),
      trustedLoginBody,
      "/v1/auth/login",
    )
      .send(trustedLoginBody)
      .expect(200);

    expect(afterDeleteLoginResponse.body.data.requiresTwoFactor).toBe(true);
    expect(afterDeleteLoginResponse.body.data.challengeToken).toBeTruthy();

    const disablePath = "/v1/users/me/2fa/disable";
    const disableBody = {
      code: generateTotpCode(secret),
    };
    await withReplayProtection(agent.post(disablePath), disableBody, disablePath)
      .set("Authorization", `Bearer ${verifiedAccessToken}`)
      .send(disableBody)
      .expect(200);
  });
});
