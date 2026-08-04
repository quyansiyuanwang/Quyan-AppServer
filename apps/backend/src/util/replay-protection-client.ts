import { randomBytes } from "crypto";
import { env } from "@/config/env";
import {
  createTestReplaySigningMaterial,
  generateReplaySign,
  type ReplaySigningMaterial,
} from "@/util/replay-signing-session";

export type ReplayProtectionClientMaterial = ReplaySigningMaterial;

/**
 * 防重放攻击客户端工具
 */
export class ReplayProtectionClient {
  /**
   * 生成请求头
   */
  static generateHeaders(body: any, path: string, material?: ReplayProtectionClientMaterial): Record<string, string> {
    const effectiveMaterial = material ?? this.getDefaultMaterial();
    const nonce = randomBytes(16).toString("hex");
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyStr = body ? JSON.stringify(body) : "";
    const sign = this.generateSign(nonce, timestamp, bodyStr, path, effectiveMaterial.signingKey);

    return {
      "X-Nonce": nonce,
      "X-Timestamp": timestamp,
      "X-Sign": sign,
      "X-Replay-Session-Id": effectiveMaterial.sessionId,
    };
  }

  static getDefaultMaterial(): ReplayProtectionClientMaterial {
    if (env.runtime.isTest) return createTestReplaySigningMaterial();
    throw new Error("Replay signing material is required outside test environment");
  }

  /**
   * 生成签名
   */
  private static generateSign(
    nonce: string,
    timestamp: string,
    body: string,
    path: string,
    signingKey: string,
  ): string {
    return generateReplaySign(nonce, timestamp, body, path, signingKey);
  }
}
