import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { env } from "@/config/env";
import { normalizeIp } from "@/util/ip-extractor";

export const SUPPORT_RELAY_AUTHORIZATION_HEADER = "x-appserver-support-relay";
export const SUPPORT_RELAY_CLIENT_IP_HEADER = "x-appserver-support-client-ip";

const MAX_AUTHORIZATION_AGE_MS = 60_000;

const signaturePayload = (token: string, clientIp: string, timestamp: number) =>
  `support-relay-v1\n${timestamp}\n${clientIp}\n${token}`;

const signatureFor = (token: string, clientIp: string, timestamp: number) =>
  createHmac("sha256", env.security.replayProtection.masterSecret)
    .update(signaturePayload(token, clientIp, timestamp))
    .digest("base64url");

/**
 * Marks a server-originated Support Agent Relay request. The marker binds the
 * user's Relay Token to the original browser IP without exposing the token.
 */
export const createSupportRelayAuthorization = (token: string, clientIp: string, now = Date.now()) => {
  const normalizedIp = normalizeIp(clientIp);
  if (!normalizedIp || isIP(normalizedIp) === 0) throw new Error("Support Relay client IP is invalid");
  if (!env.security.replayProtection.masterSecret) throw new Error("Replay signing key is not configured");

  return {
    [SUPPORT_RELAY_AUTHORIZATION_HEADER]: `${now}.${signatureFor(token, normalizedIp, now)}`,
    [SUPPORT_RELAY_CLIENT_IP_HEADER]: normalizedIp,
  };
};

/** Returns the signed browser IP only when the request was created by this backend. */
export const resolveSupportRelayClientIp = (headers: Record<string, unknown>, token: string, now = Date.now()) => {
  const authorization = headers[SUPPORT_RELAY_AUTHORIZATION_HEADER];
  const clientIpHeader = headers[SUPPORT_RELAY_CLIENT_IP_HEADER];
  const rawAuthorization = Array.isArray(authorization) ? authorization[0] : authorization;
  const rawClientIp = Array.isArray(clientIpHeader) ? clientIpHeader[0] : clientIpHeader;
  if (typeof rawAuthorization !== "string" || typeof rawClientIp !== "string") return undefined;

  const [timestampText, signature] = rawAuthorization.split(".");
  const timestamp = Number(timestampText);
  const clientIp = normalizeIp(rawClientIp);
  if (
    !Number.isSafeInteger(timestamp) ||
    !signature ||
    !clientIp ||
    isIP(clientIp) === 0 ||
    Math.abs(now - timestamp) > MAX_AUTHORIZATION_AGE_MS ||
    !env.security.replayProtection.masterSecret
  )
    return undefined;

  const expected = Buffer.from(signatureFor(token, clientIp, timestamp));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received) ? clientIp : undefined;
};
