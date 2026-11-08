import { beforeAll, describe, expect, it, vi, afterAll } from "vitest";
import { randomUUID, generateKeyPairSync, createSign } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/config/database";
import { AlipayRepository } from "@/store/billing/alipay.repository";
import { AlipayPaymentService } from "@/services/billing/alipay-payment.service";
import { encryptAlipayCredentials, decryptAlipayCredentials } from "@/services/billing/alipay-client";
import { ConfigService } from "@/services/system/config.service";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { env } from "@/config/env";
import { AlipaySdk } from "alipay-sdk";
import type { TypedRequest } from "@/types/express";

const repo = AlipayRepository.getInstance();
const service = AlipayPaymentService.getInstance();
const keys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
let userId: string, profileId: string;
const authorize = async () => {};
const amount = (v: string) => new Decimal(v);
beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: {
        username: "alipay-fixture-" + randomUUID(),
        password: "fixture-only",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
  profileId = (
    await repo.createProfile({
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
    })
  ).id;
});
afterAll(() => vi.restoreAllMocks());
async function order() {
  return repo.create({
    userId,
    profileId,
    requestId: randomUUID(),
    outTradeNo: "TEST" + randomUUID().replaceAll("-", ""),
    amount: "10.00",
    creditAmount: "1000",
    rechargeRatio: "100",
    expiresAt: new Date(Date.now() + 600000),
    notifyUrl: "https://fixture.invalid/notify",
    returnUrl: "https://fixture.invalid/balance",
  });
}
async function paid() {
  const row = await order();
  await repo.credit(row.id, randomUUID().replaceAll("-", ""), "TRADE_SUCCESS");
  return (await repo.get(row.id))!;
}
function notification(row: Awaited<ReturnType<typeof order>>, overrides: Record<string, string> = {}) {
  const data: Record<string, string> = {
    app_id: "2026000000000001",
    seller_id: "2088000000000001",
    out_trade_no: row.outTradeNo,
    trade_no: "202611081234567890" + row.id.slice(-5),
    total_amount: "10.00",
    trade_status: "TRADE_SUCCESS",
    ...overrides,
  };
  const sign = createSign("RSA-SHA256");
  sign.update(
    Object.keys(data)
      .sort()
      .map((key) => key + "=" + data[key])
      .join("&"),
  );
  data.sign = sign.sign(keys.privateKey, "base64");
  data.sign_type = "RSA2";
  return data;
}

describe("Alipay settlement and refunds", () => {
  it("encrypts credential revisions with authenticated encryption", async () => {
    const profile = (await repo.profile(profileId))!;
    expect(profile.encryptedCredentials).not.toContain("PRIVATE KEY");
    expect(decryptAlipayCredentials(profile.encryptedCredentials).privateKey).toBe(keys.privateKey);
    const parts = profile.encryptedCredentials.split(".");
    const ciphertext = Buffer.from(parts[2], "base64");
    ciphertext[0] ^= 1;
    parts[2] = ciphertext.toString("base64");
    expect(() => decryptAlipayCredentials(parts.join("."))).toThrow();
  });
  it("keeps the same order and original ratio/credential snapshot on checkout retries", async () => {
    const configs = ConfigService.getInstance();
    const config = vi.spyOn(configs, "getMultiple").mockResolvedValue({
      [CONFIG_KEYS.ALIPAY.SETTINGS]: JSON.stringify({ enabled: true, returnUrl: "https://fixture.invalid/balance" }),
      [CONFIG_KEYS.ALIPAY.ACTIVE_PROFILE]: profileId,
    });
    const ratio = vi.spyOn(configs, "getRechargeRatio").mockResolvedValue(100);
    const site = vi.spyOn(configs, "getSiteConfig").mockResolvedValue({ backendPublicUrl: "https://fixture.invalid" });
    try {
      const body = { amount: "0.29", requestId: randomUUID() };
      const request = { user: { userId }, headers: {}, ip: "127.0.0.1" } as unknown as TypedRequest;
      const first = await service.create(body, request);
      ratio.mockResolvedValue(200);
      config.mockResolvedValue({});
      const retry = await service.create(body, request);
      expect(retry.order.id).toBe(first.order.id);
      expect(retry.order.creditAmount).toBe("29.0000");
      expect(retry.order.rechargeRatio).toBe("100.0000");
      expect(new URL(retry.paymentUrl).hostname).toBe("openapi-sandbox.dl.alipaydev.com");
      await expect(service.create({ ...body, amount: "1" }, request)).rejects.toThrow();
      expect(await prisma.paymentOrder.count({ where: { userId, requestId: body.requestId } })).toBe(1);
    } finally {
      config.mockRestore();
      ratio.mockRestore();
      site.mockRestore();
    }
  });
  it("credits once across concurrent notification/query settlement and ignores late closes", async () => {
    const row = await order();
    const tradeNo = randomUUID().replaceAll("-", "");
    await Promise.allSettled([
      repo.credit(row.id, tradeNo, "TRADE_SUCCESS"),
      repo.credit(row.id, tradeNo, "TRADE_SUCCESS"),
    ]);
    await repo.credit(row.id, tradeNo, "TRADE_SUCCESS");
    await repo.close(row.id);
    expect(await prisma.balanceTransaction.count({ where: { relatedId: row.id } })).toBe(1);
    expect((await repo.get(row.id))!.state).toBe("paid");
  });
  it("validates real RSA signatures, app, seller and amount; duplicate notifications do not credit again", async () => {
    const row = await order();
    expect(await service.notify(notification(row, { total_amount: "9" }))).toBe(false);
    expect(await service.notify(notification(row, { app_id: "2026000000000002" }))).toBe(false);
    expect(await service.notify(notification(row, { seller_id: "2088000000000002" }))).toBe(false);
    const body = notification(row);
    expect(await service.notify({ ...body, total_amount: "100" })).toBe(false);
    expect(await service.notify(body)).toBe(true);
    expect(await service.notify(body)).toBe(true);
    expect(await prisma.balanceTransaction.count({ where: { relatedId: row.id } })).toBe(1);
  });
  it("refuses sandbox settlement in production even for an existing signed order", async () => {
    const row = await order();
    const original = env.runtime.isProduction;
    try {
      env.runtime.isProduction = true;
      expect(await service.notify(notification(row))).toBe(false);
      expect(await prisma.balanceTransaction.count({ where: { relatedId: row.id } })).toBe(0);
    } finally {
      env.runtime.isProduction = original;
    }
  });
  it("rejects cross-user reads", async () => {
    const row = await order();
    await expect(service.get(row.id, "unrelated-user")).rejects.toThrow();
  });
  it("reserves once and rolls a definitely failed refund back once", async () => {
    const row = await paid();
    const before = (await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } })).balance;
    const key = "RF" + randomUUID();
    const first = await repo.reserveRefund(row.id, key, amount("2"), "fixture", userId, authorize);
    const duplicate = await repo.reserveRefund(row.id, key, amount("2"), "fixture", userId, authorize);
    expect(duplicate.created).toBe(false);
    expect(
      (await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } })).balance.equals(before.minus(200)),
    ).toBe(true);
    await expect(repo.reserveRefund(row.id, key, amount("3"), "fixture", userId, authorize)).rejects.toThrow();
    await repo.finishRefund(first.refund.id, false, "PROVIDER_REJECTED");
    await repo.finishRefund(first.refund.id, false, "PROVIDER_REJECTED");
    expect((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } })).balance.equals(before)).toBe(true);
    expect(await prisma.balanceTransaction.count({ where: { relatedId: first.refund.id } })).toBe(2);
  });
  it("supports multiple partial refunds and caps cumulative refunds", async () => {
    const row = await paid();
    const first = await repo.reserveRefund(row.id, randomUUID(), amount("3"), "fixture", userId, authorize);
    await repo.finishRefund(first.refund.id, true);
    expect((await repo.get(row.id))!.state).toBe("partially_refunded");
    const second = await repo.reserveRefund(row.id, randomUUID(), amount("7"), "fixture", userId, authorize);
    await repo.finishRefund(second.refund.id, true);
    await repo.finishRefund(second.refund.id, true);
    expect((await repo.get(row.id))!.refundedAmount.toFixed(2)).toBe("10.00");
    expect((await repo.get(row.id))!.state).toBe("refunded");
    await expect(
      repo.reserveRefund(row.id, randomUUID(), amount("0.01"), "fixture", userId, authorize),
    ).rejects.toThrow();
  });
  it("rejects refunds if current balance cannot fund the credit clawback", async () => {
    const row = await paid();
    const before = await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } });
    await prisma.balanceAccount.update({ where: { userId }, data: { balance: 1 } });
    await expect(repo.reserveRefund(row.id, randomUUID(), amount("2"), "fixture", userId, authorize)).rejects.toThrow();
    expect(await prisma.paymentRefund.count({ where: { orderId: row.id } })).toBe(0);
    await prisma.balanceAccount.update({ where: { userId }, data: { balance: before.balance } });
  });
  it("checks authorization inside the refund transaction and rolls back on revocation", async () => {
    const row = await paid();
    const guard = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked"));
    const before = (await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } })).balance;
    await expect(repo.reserveRefund(row.id, randomUUID(), amount("1"), "fixture", userId, guard)).rejects.toThrow(
      "revoked",
    );
    expect((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } })).balance.equals(before)).toBe(true);
  });
  it("does not refund credit reserved by an active carpool", async () => {
    const row = await paid();
    const before = await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } });
    const monthly = await prisma.monthlyPassTemplate.create({
      data: { name: "alipay-fixture-" + randomUUID(), defaultQuota: 10 },
    });
    const template = await prisma.carpoolPackageTemplate.create({
      data: {
        name: "alipay-fixture-" + randomUUID(),
        salePrice: 100,
        upstreamCost: 50,
        maxMembers: 2,
        monthlyPassTemplateId: monthly.id,
        snapshotQuota: 10,
        snapshotValidityDays: 30,
      },
    });
    const carpool = await prisma.carpoolOrder.create({
      data: {
        ownerUserId: userId,
        packageTemplateId: template.id,
        packageName: template.name,
        salePrice: 100,
        upstreamCost: 50,
        maxMembers: 2,
        totalQuota: 10,
        validityDays: 30,
        members: { create: { userId } },
      },
      include: { members: true },
    });
    const reservation = await prisma.balanceReservation.create({
      data: {
        userId,
        orderId: carpool.id,
        memberId: carpool.members[0].id,
        amount: before.balance.minus(50),
      },
    });
    try {
      await expect(
        repo.reserveRefund(row.id, randomUUID(), amount("1"), "fixture", userId, authorize),
      ).rejects.toThrow();
      expect(
        (await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } })).balance.equals(before.balance),
      ).toBe(true);
      expect(await prisma.paymentRefund.count({ where: { orderId: row.id } })).toBe(0);
    } finally {
      await prisma.balanceReservation.delete({ where: { id: reservation.id } });
    }
  });
  it("reclaims all rounded credit across small partial refunds and preserves recharge statistics", async () => {
    const row = await repo.create({
      userId,
      profileId,
      requestId: randomUUID(),
      outTradeNo: "TEST" + randomUUID(),
      amount: "0.03",
      creditAmount: "0.0002",
      rechargeRatio: "0.0099",
      expiresAt: new Date(),
      notifyUrl: "https://fixture.invalid/notify",
      returnUrl: "https://fixture.invalid/balance",
    });
    const before = await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } });
    await repo.credit(row.id, randomUUID(), "TRADE_SUCCESS");
    for (let i = 0; i < 3; i++) {
      const { refund } = await repo.reserveRefund(row.id, randomUUID(), amount("0.01"), "fixture", userId, authorize);
      await repo.finishRefund(refund.id, true);
    }
    const after = await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } });
    expect(after.balance.equals(before.balance)).toBe(true);
    expect(after.totalRecharged.equals(before.totalRecharged)).toBe(true);
  });
  it("keeps a timeout held then resolves a matching provider refund query without double debit", async () => {
    const row = await paid();
    const { refund } = await repo.reserveRefund(row.id, "RF" + randomUUID(), amount("1"), "fixture", userId, authorize);
    const exec = vi.spyOn(AlipaySdk.prototype, "exec").mockRejectedValueOnce(new Error("fixture timeout"));
    expect((await service.queryRefund(refund.id)).state).toBe("processing");
    exec.mockResolvedValueOnce({
      code: "10000",
      msg: "Success",
      out_request_no: refund.outRequestNo,
      out_trade_no: row.outTradeNo,
      trade_no: row.tradeNo,
      refund_amount: "1.00",
      refund_status: "REFUND_SUCCESS",
    });
    expect((await service.queryRefund(refund.id)).state).toBe("succeeded");
    expect(await prisma.balanceTransaction.count({ where: { relatedId: refund.id } })).toBe(1);
    exec.mockRestore();
  });
  it("rejects unauthorized refund attempts before touching funds", async () => {
    const row = await paid();
    const request = { user: { userId }, headers: {} } as unknown as TypedRequest;
    await expect(
      service.refund(row.id, { amount: "1", reason: "fixture", requestId: randomUUID() }, request),
    ).rejects.toThrow();
    expect(await prisma.paymentRefund.count({ where: { orderId: row.id } })).toBe(0);
  });
  it.each(["N", undefined])(
    "keeps a successful request without confirmed fund change %s processing",
    async (fundChange) => {
      const row = await paid();
      const { refund } = await repo.reserveRefund(
        row.id,
        "RF" + randomUUID(),
        amount("1"),
        "fixture",
        userId,
        authorize,
      );
      const exec = vi
        .spyOn(AlipaySdk.prototype, "exec")
        .mockResolvedValueOnce({ code: "10000", msg: "Success" })
        .mockResolvedValueOnce({
          code: "10000",
          msg: "Success",
          fund_change: fundChange,
          out_trade_no: row.outTradeNo,
          trade_no: row.tradeNo,
          refund_fee: "1.00",
        });
      try {
        expect((await service.queryRefund(refund.id)).state).toBe("processing");
        expect((await repo.get(row.id))!.refundedAmount.toFixed(2)).toBe("0.00");
        expect(await prisma.balanceTransaction.count({ where: { relatedId: refund.id } })).toBe(1);
      } finally {
        exec.mockRestore();
      }
    },
  );
  it("validates the cumulative refund response on a subsequent partial refund", async () => {
    const row = await paid();
    const first = await repo.reserveRefund(row.id, "RF" + randomUUID(), amount("2"), "fixture", userId, authorize);
    await repo.finishRefund(first.refund.id, true);
    const { refund } = await repo.reserveRefund(row.id, "RF" + randomUUID(), amount("3"), "fixture", userId, authorize);
    const exec = vi
      .spyOn(AlipaySdk.prototype, "exec")
      .mockResolvedValueOnce({ code: "10000", msg: "Success" })
      .mockResolvedValueOnce({
        code: "10000",
        msg: "Success",
        fund_change: "Y",
        out_trade_no: row.outTradeNo,
        trade_no: row.tradeNo,
        refund_fee: "5.00",
      });
    try {
      expect((await service.queryRefund(refund.id)).state).toBe("succeeded");
      expect((await repo.get(row.id))!.refundedAmount.toFixed(2)).toBe("5.00");
    } finally {
      exec.mockRestore();
    }
  });
  it("validates Alipay settings at the generic configuration boundary", async () => {
    await expect(
      ConfigService.getInstance().setMultiple({
        [CONFIG_KEYS.ALIPAY.SETTINGS]: JSON.stringify({ enabled: true, returnUrl: "javascript:alert(1)" }),
      }),
    ).rejects.toThrow();
    expect(await prisma.serverConfig.findUnique({ where: { key: CONFIG_KEYS.ALIPAY.SETTINGS } })).toBeNull();
  });
  it("retries an unknown refund with the same provider key and releases only a definite rejection", async () => {
    const row = await paid();
    const before = await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } });
    const { refund } = await repo.reserveRefund(row.id, "RF" + randomUUID(), amount("1"), "fixture", userId, authorize);
    const exec = vi
      .spyOn(AlipaySdk.prototype, "exec")
      .mockResolvedValueOnce({ code: "10000", msg: "Success" })
      .mockResolvedValueOnce({ code: "40004", sub_code: "ACQ.TRADE_NOT_ALLOW_REFUND", msg: "Rejected" });
    try {
      expect((await service.queryRefund(refund.id)).state).toBe("failed");
      expect(exec.mock.calls[1][1]).toMatchObject({ bizContent: { out_request_no: refund.outRequestNo } });
      expect(
        (await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } })).balance.equals(before.balance),
      ).toBe(true);
    } finally {
      exec.mockRestore();
    }
  });
});
