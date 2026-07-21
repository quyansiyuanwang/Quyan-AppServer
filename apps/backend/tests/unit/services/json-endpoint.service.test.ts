import { createHash, generateKeyPairSync, sign } from "crypto";
import bcrypt from "bcrypt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JsonEndpointService } from "../../../src/services/json-endpoint/json-endpoint.service";

describe("JsonEndpointService signature access", () => {
  const now = new Date("2026-07-22T00:00:00.000Z");
  const repository = {
    findByRootSlug: vi.fn(),
    findByUserAndSlug: vi.fn(),
    incrementAccessCount: vi.fn(),
  };
  const businessLogService = { logOperation: vi.fn() };
  const userRepository = { findById: vi.fn() };
  const permissionService = { hasPermission: vi.fn() };
  const redisService = {
    isRedisAvailable: vi.fn(),
    setIfNotExists: vi.fn(),
  };
  const JsonEndpointServiceCtor = JsonEndpointService as unknown as new (...args: any[]) => JsonEndpointService;
  const service = new JsonEndpointServiceCtor(
    repository,
    businessLogService,
    userRepository,
    permissionService,
    redisService,
  );
  const keyPair = generateKeyPairSync("ed25519");
  const publicKey = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const endpoint = {
    id: "endpoint-1",
    userId: "owner-1",
    status: 1,
    name: "Signed endpoint",
    slug: "signed",
    isRootSlug: true,
    rootSlug: "signed",
    description: null,
    jsonContent: { ok: true },
    apiKey: null,
    isPublic: false,
    accessMode: "public-key",
    publicKey,
    publicKeyFingerprint: createHash("sha256").update(publicKey).digest("hex"),
    signatureAlgorithm: "Ed25519",
    accessCount: 0,
    lastAccessAt: null,
    createTime: now,
    updateTime: now,
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    repository.findByRootSlug.mockResolvedValue(endpoint);
    userRepository.findById.mockResolvedValue({ id: "owner-1", username: "owner" });
    redisService.isRedisAvailable.mockReturnValue(true);
    redisService.setIfNotExists.mockResolvedValue(true);
  });

  function signedCredentials(overrides: Record<string, string> = {}) {
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const nonce = "tXh5Imx1_N28mIH_GzmEnnq5";
    const pathname = "/v1/json/signed";
    const originalUrl = "/v1/json/signed?b=two&a=one";
    const payload = `GET\n${pathname}\na=one&b=two\n${timestamp}\n${nonce}`;
    return {
      timestamp,
      nonce,
      signature: sign(null, Buffer.from(payload), keyPair.privateKey).toString("base64url"),
      pathname,
      originalUrl,
      ...overrides,
    };
  }

  it("accepts a valid Ed25519 signature and reserves its nonce", async () => {
    await expect(service.accessRootEndpoint("signed", signedCredentials())).resolves.toMatchObject({
      data: { ok: true },
      publicUrl: "/v1/json/signed",
    });

    expect(redisService.setIfNotExists).toHaveBeenCalledWith(
      "json-endpoint:signature-nonce:endpoint-1:tXh5Imx1_N28mIH_GzmEnnq5",
      "1",
      300_000,
    );
    expect(repository.incrementAccessCount).toHaveBeenCalledWith("endpoint-1");
  });

  it("rejects an invalid signature before reserving a nonce", async () => {
    await expect(
      service.accessRootEndpoint("signed", signedCredentials({ signature: "A".repeat(86) })),
    ).rejects.toThrow("签名验证失败");

    expect(redisService.setIfNotExists).not.toHaveBeenCalled();
  });

  it("rejects replayed nonces and unavailable Redis", async () => {
    redisService.setIfNotExists.mockResolvedValueOnce(false);
    await expect(service.accessRootEndpoint("signed", signedCredentials())).rejects.toThrow("nonce 已被使用");

    redisService.isRedisAvailable.mockReturnValue(false);
    await expect(service.accessRootEndpoint("signed", signedCredentials())).rejects.toThrow("签名服务暂不可用");
  });

  it("rejects expired signatures", async () => {
    const expiredTimestamp = String(Math.floor(now.getTime() / 1000) - 301);
    await expect(
      service.accessRootEndpoint("signed", signedCredentials({ timestamp: expiredTimestamp })),
    ).rejects.toThrow("签名请求已过期");
  });

  it("keeps legacy private endpoints on static-password access", async () => {
    repository.findByRootSlug.mockResolvedValue({
      ...endpoint,
      accessMode: null,
      publicKey: null,
      publicKeyFingerprint: null,
      signatureAlgorithm: null,
      apiKey: await bcrypt.hash("legacy-password", 4),
    });

    await expect(service.accessRootEndpoint("signed", { password: "legacy-password" })).resolves.toMatchObject({
      data: { ok: true },
    });
    expect(redisService.setIfNotExists).not.toHaveBeenCalled();
  });
});
