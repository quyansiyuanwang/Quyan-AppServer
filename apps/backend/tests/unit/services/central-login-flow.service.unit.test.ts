import { describe, expect, it } from "vitest";
import { CentralLoginFlowService } from "../../../src/services/auth/central-login-flow.service";

const createService = () => {
  const values = new Map<string, string>();
  const redis = {
    isRedisAvailable: () => true,
    set: async (key: string, value: string | number) => void values.set(key, String(value)),
    get: async (key: string) => values.get(key) ?? null,
    getAndDelete: async (key: string) => {
      const value = values.get(key) ?? null;
      values.delete(key);
      return value;
    },
  };
  return new CentralLoginFlowService(redis, ["https://account.qysyw.cn", "https://auth.qysyw.cn"], 600);
};

describe("CentralLoginFlowService", () => {
  it("canonicalizes an allowed exact HTTPS return URL", async () => {
    const service = createService();
    const { flowId } = await service.createFlow("https://account.qysyw.cn/settings/profile?tab=security#passkeys");

    await expect(service.getFlowContext(flowId)).resolves.toEqual({ flowId });
    await expect(service.consumeFlow(flowId, "user-1")).resolves.toEqual({
      returnTo: "https://account.qysyw.cn/settings/profile?tab=security#passkeys",
    });
  });

  it.each([
    "http://account.qysyw.cn/settings",
    "https://account.qysyw.cn:8443/settings",
    "https://attacker.example/settings",
    "https://user@account.qysyw.cn/settings",
  ])("rejects unsafe return URLs: %s", async (returnTo) => {
    await expect(createService().createFlow(returnTo)).rejects.toThrow("Central login return URL");
  });

  it("allows an exact local HTTPS origin with its configured development port", async () => {
    const values = new Map<string, string>();
    const redis = {
      isRedisAvailable: () => true,
      set: async (key: string, value: string | number) => void values.set(key, String(value)),
      get: async (key: string) => values.get(key) ?? null,
      getAndDelete: async (key: string) => values.get(key) ?? null,
    };
    const service = new CentralLoginFlowService(redis, ["https://www.qysyw.test:5173"]);

    await expect(service.createFlow("https://www.qysyw.test:5173/home")).resolves.toMatchObject({
      flowId: expect.any(String),
    });
  });

  it("consumes a flow only once", async () => {
    const service = createService();
    const { flowId } = await service.createFlow("https://account.qysyw.cn/settings/profile");

    await service.consumeFlow(flowId, "user-1");
    await expect(service.consumeFlow(flowId, "user-1")).rejects.toThrow("already consumed");
  });

  it("rejects a flow created by another authenticated user", async () => {
    const service = createService();
    const { flowId } = await service.createFlow("https://account.qysyw.cn/settings/profile", "user-1");

    await expect(service.consumeFlow(flowId, "user-2")).rejects.toThrow("belongs to another user");
  });

  it("fails closed when Redis is unavailable", async () => {
    const redis = {
      isRedisAvailable: () => false,
      set: async () => undefined,
      get: async () => null,
      getAndDelete: async () => null,
    };
    const service = new CentralLoginFlowService(redis, ["https://account.qysyw.cn"], 600);

    await expect(service.createFlow("https://account.qysyw.cn/settings/profile")).rejects.toThrow(
      "storage is unavailable",
    );
  });
});
