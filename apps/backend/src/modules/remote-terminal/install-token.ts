import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { IAM_SUBJECT_TYPES } from "@quyan/shared";
import { isRemoteTerminalId } from "@/iam/resources/remote-terminal-resources";
const PREFIX = "rtm-t.";
export const INSTALL_TOKEN_POLICY = Object.freeze({ ttlSeconds: 900, clockSkewSeconds: 30, maxTokenLength: 4096 });
const id = z.string().refine(isRemoteTerminalId);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const principal = z
  .object({
    subjectUserId: id,
    principalUserId: id,
    accountOwnerId: id,
    subjectType: z.enum(IAM_SUBJECT_TYPES),
    assumedRoleId: id.optional(),
    roleSessionId: id.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.subjectUserId !== value.principalUserId ||
      (value.subjectType === "assumed_role"
        ? !value.assumedRoleId || !value.roleSessionId
        : value.assumedRoleId || value.roleSessionId) ||
      (value.subjectType === "root" && value.subjectUserId !== value.accountOwnerId)
    )
      context.addIssue({ code: "custom", message: "Invalid issuer identity" });
  });
const grantSchema = z
  .object({
    principal,
    policyFingerprint: hash,
    userFingerprint: hash,
    targetFingerprint: hash,
    accessKeyId: id.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.principal.subjectType === "access_key") !== (value.accessKeyId !== undefined))
      context.addIssue({ code: "custom", message: "Invalid issuer credential" });
  });
const capabilitySchema = z
  .object({ version: z.literal(2), entitlementId: id, issuedAt: z.number().int().nonnegative(), grant: grantSchema })
  .strict();
export type IamInstallTokenGrant = z.infer<typeof grantSchema>;
export type IamInstallTokenCapability = z.infer<typeof capabilitySchema>;
export type VerifiedInstallToken = { entitlementId: string; capability?: IamInstallTokenCapability };
function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}
function validSignature(value: string, signature: string, secret: string) {
  return (
    /^[a-f0-9]{64}$/.test(signature) &&
    timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(sign(value, secret), "hex"))
  );
}
function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid install token encoding");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new Error("Invalid install token encoding");
  return bytes.toString("utf8");
}
function inLifetime(issuedAt: number) {
  const age = Math.floor(Date.now() / 1000) - issuedAt;
  return age >= -INSTALL_TOKEN_POLICY.clockSkewSeconds && age < INSTALL_TOKEN_POLICY.ttlSeconds;
}
function result(token: string, issuedAt: number) {
  if (token.length > INSTALL_TOKEN_POLICY.maxTokenLength) throw new Error("Install token capacity exceeded");
  return { token, expiresAt: new Date((issuedAt + INSTALL_TOKEN_POLICY.ttlSeconds) * 1000).toISOString() };
}
export function isInstallToken(token: string): boolean {
  return typeof token === "string" && token.startsWith(PREFIX);
}
/** Compatibility credentials remain distinguishable from IAM-bound capabilities. */
export function issueInstallToken(entitlementId: string, secret: string) {
  if (!isRemoteTerminalId(entitlementId)) throw new Error("Invalid entitlement identifier");
  const issuedAt = Math.floor(Date.now() / 1000),
    encodedId = Buffer.from(entitlementId).toString("base64url"),
    encodedTime = Buffer.from(String(issuedAt)).toString("base64url");
  return result(`${PREFIX}${encodedId}.${encodedTime}.${sign(`${entitlementId}:${issuedAt}`, secret)}`, issuedAt);
}
/** The grant contains identity and hashes only: no source credentials, policy documents, or request attributes. */
export function issueIamInstallToken(entitlementId: string, secret: string, grant: IamInstallTokenGrant) {
  if (secret.length < 64) throw new Error("Install token signing secret is too short");
  const capability = capabilitySchema.parse({
    version: 2,
    entitlementId,
    issuedAt: Math.floor(Date.now() / 1000),
    grant,
  });
  const encoded = Buffer.from(JSON.stringify(capability)).toString("base64url");
  return result(`${PREFIX}v2.${encoded}.${sign(`v2.${encoded}`, secret)}`, capability.issuedAt);
}
export function verifyInstallToken(token: string, secret: string): VerifiedInstallToken | null {
  if (!isInstallToken(token) || token.length > INSTALL_TOKEN_POLICY.maxTokenLength) return null;
  const parts = token.slice(PREFIX.length).split(".");
  if (parts.length !== 3) return null;
  const [first, second, signature] = parts;
  try {
    if (first === "v2") {
      if (secret.length < 64 || !validSignature(`v2.${second}`, signature, secret)) return null;
      const capability = capabilitySchema.parse(JSON.parse(decode(second)));
      if (!inLifetime(capability.issuedAt)) return null;
      return { entitlementId: capability.entitlementId, capability };
    }
    const entitlementId = decode(first),
      rawTime = decode(second);
    if (!isRemoteTerminalId(entitlementId) || !/^(0|[1-9][0-9]*)$/.test(rawTime)) return null;
    const issuedAt = Number(rawTime);
    if (
      !Number.isSafeInteger(issuedAt) ||
      !inLifetime(issuedAt) ||
      !validSignature(`${entitlementId}:${issuedAt}`, signature, secret)
    )
      return null;
    return { entitlementId };
  } catch {
    return null;
  }
}
