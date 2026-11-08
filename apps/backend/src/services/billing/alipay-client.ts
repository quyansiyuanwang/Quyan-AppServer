import { AlipaySdk } from "alipay-sdk";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "@/config/env";
import { ALIPAY_POLICY, type AlipayCredentials } from "./alipay-policy";

function encryptionKey() {
  return Buffer.from(
    hkdfSync("sha256", env.security.replayProtection.masterSecret, "quyan:alipay:v1", "credential-storage", 32),
  );
}
export function encryptAlipayCredentials(credentials: AlipayCredentials): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((v) => v.toString("base64")).join(".");
}
export function decryptAlipayCredentials(value: string): AlipayCredentials {
  const [iv, tag, ciphertext] = value.split(".").map((v) => Buffer.from(v, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"),
  ) as AlipayCredentials;
}
export function createAlipayClient(credentials: AlipayCredentials) {
  const { sandbox, sellerId: _seller, ...options } = credentials;
  return new AlipaySdk({
    ...options,
    // The SDK removes PEM footers only when they are on the final line.
    // Standard PEM exports end with a newline, which Bun's crypto rejects
    // after the SDK otherwise wraps a duplicate footer around the key.
    privateKey: options.privateKey.trim(),
    alipayPublicKey: options.alipayPublicKey.trim(),
    gateway: sandbox ? ALIPAY_POLICY.sandboxGateway : ALIPAY_POLICY.productionGateway,
    signType: "RSA2",
    timeout: ALIPAY_POLICY.requestTimeoutMs,
    camelcase: false,
  });
}

export type AlipayClient = ReturnType<typeof createAlipayClient>;
