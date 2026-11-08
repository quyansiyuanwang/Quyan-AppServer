import { randomUUID, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "@/app";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { JWTAccessIns } from "@/util/auth";
import { AlipayPaymentService } from "@/services/billing/alipay-payment.service";
import { encryptAlipayCredentials } from "@/services/billing/alipay-client";
import { AlipayRepository } from "@/store/billing/alipay.repository";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { Permission } from "@quyan/shared";
import { AlipaySdk } from "alipay-sdk";
import { withReplayProtection } from "../util/replay-protection-test-helper";

const path = "/v1/payments/alipay";
const originalMode = env.security.iamAuthorizationMode;
const document = JSON.parse(readFileSync(resolve(process.cwd(), "src/build/swagger.json"), "utf8"));
let app: Express;
let userId: string, peerId: string, ownOrderId: string, peerOrderId: string;
async function token() {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return JWTAccessIns.generateToken({ userId, updatedAt: user.updateTime.toISOString(), status: 1 }, 60);
}
async function withPaymentAdmin(run: (profileId: string) => Promise<void>) {
  const group = await prisma.group.create({
    data: {
      username: "alipay-admin-fixture-" + randomUUID(),
      name: "Alipay test administrators",
      level: 1,
      permissions: JSON.stringify([Permission.SYSTEM_CONFIG, Permission.PAYMENT_READ, Permission.PAYMENT_REFUND]),
    },
  });
  await prisma.user.update({ where: { id: userId }, data: { groupId: group.id } });
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const profile = await prisma.alipayProfile.create({
    data: {
      appId: "2026000000000001",
      sellerId: "2088000000000001",
      sandbox: true,
      encryptedCredentials: encryptAlipayCredentials({
        appId: "2026000000000001",
        sellerId: "2088000000000001",
        sandbox: true,
        privateKey: keys.privateKey,
        alipayPublicKey: keys.publicKey,
        keyType: "PKCS8",
        appCertContent: "",
        alipayPublicCertContent: "",
        alipayRootCertContent: "",
      }),
    },
  });
  for (const [key, value] of Object.entries({
    [CONFIG_KEYS.ALIPAY.ACTIVE_PROFILE]: profile.id,
    [CONFIG_KEYS.ALIPAY.SETTINGS]: JSON.stringify({ enabled: false, refundEnabled: true }),
  }))
    await prisma.serverConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
  try {
    await run(profile.id);
  } finally {
    await prisma.user.update({ where: { id: userId }, data: { groupId: null } });
    await prisma.serverConfig.deleteMany({ where: { key: { in: Object.values(CONFIG_KEYS.ALIPAY) } } });
  }
}
beforeAll(async () => {
  env.security.iamAuthorizationMode = "enforce";
  app = createApp();
  const createUser = () =>
    prisma.user.create({
      data: {
        username: "alipay-http-" + randomUUID(),
        password: "fixture-only",
        userType: "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
  userId = (await createUser()).id;
  peerId = (await createUser()).id;
  const profile = await prisma.alipayProfile.create({
    data: {
      appId: "2026000000000001",
      sellerId: "2088000000000001",
      sandbox: true,
      encryptedCredentials: "fixture-unused",
    },
  });
  const createOrder = (owner: string) =>
    prisma.paymentOrder.create({
      data: {
        userId: owner,
        profileId: profile.id,
        requestId: randomUUID(),
        outTradeNo: randomUUID(),
        amount: 1,
        creditAmount: 100,
        rechargeRatio: 100,
        expiresAt: new Date(Date.now() + 600000),
        notifyUrl: "https://fixture.invalid/notify",
        returnUrl: "https://fixture.invalid/balance",
      },
    });
  ownOrderId = (await createOrder(userId)).id;
  peerOrderId = (await createOrder(peerId)).id;
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  env.security.iamAuthorizationMode = originalMode;
});

describe("generated Alipay HTTP boundary", () => {
  it("accepts anonymous form notifications and sends exact unwrapped text", async () => {
    const notify = vi
      .spyOn(AlipayPaymentService.getInstance(), "notify")
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const ok = await request(app)
      .post(path + "/notify")
      .type("form")
      .send({ sign: "fixture+signature=" })
      .expect(200);
    expect(ok.text).toBe("success");
    expect(ok.headers["content-type"]).toContain("text/plain");
    expect(notify).toHaveBeenCalledWith({ sign: "fixture+signature=" });
    const failure = await request(app)
      .post(path + "/notify")
      .type("form")
      .send({ sign: "invalid" })
      .expect(200);
    expect(failure.text).toBe("failure");
  });
  it("requires JWT for user reads and administrative operations", async () => {
    await request(app)
      .get(path + "/orders")
      .expect(401);
    await request(app)
      .post(path + "/management/orders/" + ownOrderId + "/refunds")
      .send({})
      .expect(401);
  });
  it("ignores a forged user filter and refuses cross-user order/refund reads", async () => {
    const auth = "Bearer " + (await token());
    const own = await request(app)
      .get(path + "/orders/" + ownOrderId)
      .set("Authorization", auth)
      .expect(200);
    expect(own.body.data.id).toBe(ownOrderId);
    expect(JSON.stringify(own.body)).not.toContain("encryptedCredentials");
    await request(app)
      .get(path + "/orders/" + peerOrderId)
      .set("Authorization", auth)
      .expect(404);
    await request(app)
      .get(path + "/orders/" + peerOrderId + "/refunds")
      .set("Authorization", auth)
      .expect(404);
    const list = await request(app)
      .get(path + "/orders")
      .query({ userId: peerId })
      .set("Authorization", auth)
      .expect(200);
    expect(list.body.data.records.map((row: { id: string }) => row.id)).toEqual([ownOrderId]);
  });
  it("rejects platform management without the new payment permission", async () => {
    await request(app)
      .get(path + "/management/orders")
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
    await request(app)
      .get(path + "/config")
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
  });
  it("rejects checkout without replay headers before persistence", async () => {
    await request(app)
      .post(path + "/orders")
      .set("Authorization", "Bearer " + (await token()))
      .send({ amount: "1.00", requestId: randomUUID() })
      .expect((response) => {
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
      });
    expect(await prisma.paymentOrder.count({ where: { userId } })).toBe(1);
  });
  it("publishes replay and step-up metadata without secrets in readable DTOs", () => {
    for (const [suffix, method] of [
      ["/config", "put"],
      ["/management/orders/{id}/refunds", "post"],
    ] as const) {
      const operation = document.paths[path + suffix][method];
      expect(operation["X-Replay-Protected"]).toBe(true);
      expect(operation["X-Two-Factor-Challenge"]).toMatchObject({ required: true, purpose: "stepup" });
    }
    expect(document.paths[path + "/notify"].post.security ?? []).toEqual([]);
    for (const name of ["AlipayConfigDto", "PublicAlipayConfigDto", "AlipayOrderDto"]) {
      const schema = JSON.stringify(document.components.schemas[name]);
      expect(schema).not.toContain("privateKey");
      expect(schema).not.toContain("encryptedCredentials");
    }
  });
  it("returns only credential presence and identifiers to authorized configuration administrators", async () => {
    await withPaymentAdmin(async () => {
      const response = await request(app)
        .get(path + "/config")
        .set("Authorization", "Bearer " + (await token()))
        .expect(200);
      expect(response.body.data.profile).toEqual({
        appId: "2026000000000001",
        sellerId: "2088000000000001",
        sandbox: true,
        keyType: "PKCS8",
        hasCredentials: true,
      });
      expect(JSON.stringify(response.body)).not.toMatch(/privateKey|encryptedCredentials|PRIVATE KEY|PUBLIC KEY/);
    });
  });
  it("runs an authorized original-payment refund through generated routes and does not refund twice", async () => {
    await withPaymentAdmin(async (profileId) => {
      const repo = AlipayRepository.getInstance();
      const order = await repo.create({
        userId,
        profileId,
        requestId: randomUUID(),
        outTradeNo: randomUUID(),
        amount: 10,
        creditAmount: 1000,
        rechargeRatio: 100,
        expiresAt: new Date(),
        notifyUrl: "https://fixture.invalid/notify",
        returnUrl: "https://fixture.invalid/balance",
      });
      const tradeNo = randomUUID().replaceAll("-", "");
      await repo.credit(order.id, tradeNo, "TRADE_SUCCESS");
      const exec = vi.spyOn(AlipaySdk.prototype, "exec").mockResolvedValue({
        code: "10000",
        msg: "Success",
        fund_change: "Y",
        out_trade_no: order.outTradeNo,
        trade_no: tradeNo,
        refund_fee: "2.00",
      });
      const refundPath = path + "/management/orders/" + order.id + "/refunds";
      const body = { amount: "2.00", reason: "HTTP integration fixture", requestId: randomUUID() };
      const auth = "Bearer " + (await token());
      const send = () =>
        withReplayProtection(request(app).post(refundPath), body, refundPath).set("Authorization", auth).send(body);
      const first = await send().expect(200);
      const repeated = await send().expect(200);
      expect(first.body.data.state).toBe("succeeded");
      expect(repeated.body.data.id).toBe(first.body.data.id);
      expect(exec).toHaveBeenCalledTimes(1);
      expect((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } })).balance.toFixed(4)).toBe(
        "800.0000",
      );
      expect(await prisma.balanceTransaction.count({ where: { relatedId: first.body.data.id } })).toBe(1);
    });
  });
});
