import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAlipayClient } from "@/services/billing/alipay-client";

describe("Alipay client PEM normalization", () => {
  it.each(["PKCS8", "PKCS1"] as const)("signs checkout URLs with whitespace-padded %s PEM keys", (keyType) => {
    const keys = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: keyType === "PKCS8" ? "pkcs8" : "pkcs1", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const client = createAlipayClient({
      appId: "2026000000000001",
      sellerId: "2088000000000001",
      sandbox: true,
      keyType,
      privateKey: "\r\n" + keys.privateKey.replaceAll("\n", "\r\n") + "\r\n",
      alipayPublicKey: "\n" + keys.publicKey + "\n",
      appCertContent: "",
      alipayPublicCertContent: "",
      alipayRootCertContent: "",
    });
    expect(client.config.privateKey?.match(/-----END /g)).toHaveLength(1);
    expect(client.config.alipayPublicKey?.match(/-----END /g)).toHaveLength(1);
    const url = new URL(
      client.pageExecute("alipay.trade.page.pay", "GET", {
        bizContent: {
          out_trade_no: "fixture-normalized-pem",
          total_amount: "0.01",
          product_code: "FAST_INSTANT_TRADE_PAY",
        },
      }),
    );
    expect(url.hostname).toBe("openapi-sandbox.dl.alipaydev.com");
    const signature = url.searchParams.get("sign")!;
    url.searchParams.delete("sign");
    const payload = [...url.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    expect(createVerify("RSA-SHA256").update(payload).verify(keys.publicKey, signature, "base64")).toBe(true);
  });
});
