import { Decimal } from "@prisma/client/runtime/library";
import { z } from "zod";

export const ALIPAY_POLICY = Object.freeze({
  requestTimeoutMs: 10_000,
  queryIntervalMs: 60_000,
  batchSize: 25,
  operatorAlertAfterAttempts: 120,
  maxBalance: "999999.9999",
  // Keep the base64-encoded AES envelope within the credential TEXT column.
  maxCredentialBytes: 45_000,
  recoveryCron: "* * * * *",
  productionGateway: "https://openapi.alipay.com/gateway.do",
  sandboxGateway: "https://openapi-sandbox.dl.alipaydev.com/gateway.do",
});

export const moneySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/)
  .pipe(z.string().refine((v) => new Decimal(v).gt(0)));
export const requestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
export const alipaySettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    refundEnabled: z.boolean().default(false),
    minAmount: moneySchema.default("0.01"),
    maxAmount: moneySchema.default("10000.00"),
    orderTimeoutMinutes: z.number().int().min(5).max(120).default(30),
    returnUrl: z
      .union([
        z.literal(""),
        z
          .string()
          .url()
          .pipe(
            z.string().refine((value) => {
              const url = new URL(value);
              return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.hash;
            }),
          ),
      ])
      .default(""),
  })
  .strict()
  .refine(
    (v) =>
      !moneySchema.safeParse(v.minAmount).success ||
      !moneySchema.safeParse(v.maxAmount).success ||
      new Decimal(v.minAmount).lte(v.maxAmount),
  );

export const alipayCredentialsSchema = z
  .object({
    appId: z.string().regex(/^\d{10,32}$/),
    sellerId: z.string().regex(/^\d{10,32}$/),
    sandbox: z.boolean(),
    privateKey: z.string().min(1).max(20000),
    alipayPublicKey: z.string().max(20000).default(""),
    keyType: z.enum(["PKCS1", "PKCS8"]).default("PKCS8"),
    appCertContent: z.string().max(30000).default(""),
    alipayPublicCertContent: z.string().max(30000).default(""),
    alipayRootCertContent: z.string().max(50000).default(""),
  })
  .strict()
  .refine((v) =>
    Boolean(v.alipayPublicKey || (v.appCertContent && v.alipayPublicCertContent && v.alipayRootCertContent)),
  )
  .refine((v) => Buffer.byteLength(JSON.stringify(v), "utf8") <= ALIPAY_POLICY.maxCredentialBytes);

export type AlipaySettings = z.infer<typeof alipaySettingsSchema>;
export type AlipayCredentials = z.infer<typeof alipayCredentialsSchema>;

export function rechargeCredit(amount: Decimal.Value, ratio: Decimal.Value) {
  return new Decimal(amount).mul(ratio).toDecimalPlaces(4, Decimal.ROUND_DOWN);
}

/** Allocate cumulative rounding to the last refund, so partial refunds never leave residual credit. */
export function refundCredit(
  total: Decimal.Value,
  credit: Decimal.Value,
  before: Decimal.Value,
  amount: Decimal.Value,
) {
  const cumulative = (value: Decimal) =>
    new Decimal(credit).mul(value).div(total).toDecimalPlaces(4, Decimal.ROUND_DOWN);
  return cumulative(new Decimal(before).plus(amount)).minus(cumulative(new Decimal(before)));
}
