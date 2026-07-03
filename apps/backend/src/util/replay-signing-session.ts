import { createHmac, timingSafeEqual } from "crypto";
import { ApiError } from "@/util/errors";
import { CustomCode } from "@/constant/custom-code";
import { EnvSpace } from "@/config/env";

export const REPLAY_SIGNING_SESSION_HEADER = "x-replay-session-id";

export interface ReplaySigningSessionRecord {
  signingKey: string;
  fingerprint?: string;
  issuedAt: string;
  expiresAt: string;
}

export interface ReplaySigningMaterial {
  sessionId: string;
  signingKey: string;
  fingerprint?: string;
}

export const TEST_REPLAY_CLIENT_FINGERPRINT = "test-replay-client-fingerprint";

export function buildReplaySigningSessionKey(sessionId: string): string {
  return `replay:signing-session:${sessionId}`;
}

export function buildReplayNonceKey(sessionId: string, nonce: string): string {
  return `replay:nonce:${sessionId}:${nonce}`;
}

export function generateReplaySigningKey(sessionId: string, fingerprint?: string): string {
  const seed = `${sessionId}:${Date.now()}:${fingerprint || ""}`;
  return createHmac("sha256", EnvSpace.replayProtectionConfig.masterSecret).update(seed).digest("hex");
}

export function deriveReplaySigningKey(sessionId: string, fingerprint?: string): string {
  const seed = `${sessionId}:${fingerprint || ""}`;
  return createHmac("sha256", EnvSpace.replayProtectionConfig.masterSecret).update(seed).digest("hex");
}

export function createTestReplaySigningMaterial(
  fingerprint: string = TEST_REPLAY_CLIENT_FINGERPRINT,
): ReplaySigningMaterial {
  const sessionId = `test:${fingerprint}`;
  return {
    sessionId,
    signingKey: deriveReplaySigningKey(sessionId, fingerprint),
    fingerprint,
  };
}

export function generateReplaySign(
  nonce: string,
  timestamp: string,
  body: string,
  path: string,
  signingKey: string,
): string {
  const data = `${nonce}${timestamp}${path}${body}`;
  return createHmac("sha256", signingKey).update(data).digest("hex");
}

export function verifyReplaySign(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (actualBuffer.length === 0 || actualBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createReplayProtectionUnavailableError(): ApiError {
  return new ApiError("防重放保护服务暂时不可用，请稍后重试", 503, CustomCode.REPLAY_PROTECTION_FAILED, false);
}
