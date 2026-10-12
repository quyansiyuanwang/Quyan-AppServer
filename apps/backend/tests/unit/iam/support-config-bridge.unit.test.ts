import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/support/support-config-iam.service", () => ({ SupportConfigIamService: { getInstance: vi.fn() } }));
import { SupportAiService } from "@/services/support/support-ai.service";
import { env } from "@/config/env";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode;
const originalMaster = env.security.supportAiConfig.masterSecret;
let service: SupportAiService, config: any, iam: any, permissions: any, audit: any, request: TypedRequest;
const body = {
  enabled: true,
  upstreamUrl: "https://example.com/v1",
  model: "fixture-model",
  requestFormat: "openai-chat-completions" as const,
  maxRequests: 20,
  windowSeconds: 600,
};
beforeEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  config = { getMultiple: vi.fn().mockResolvedValue({}), set: vi.fn() };
  iam = {
    prepare: vi.fn().mockResolvedValue({ configs: [], users: { principal: { roleSessionId: "session" } } }),
    recheck: vi.fn(),
    update: vi.fn().mockImplementation(async (values: any) => values),
  };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) };
  audit = { logOperation: vi.fn() };
  service = new (SupportAiService as unknown as new (...args: any[]) => SupportAiService)(
    config,
    {},
    {},
    {},
    {},
    {},
    {},
    permissions,
    {},
    iam,
    audit,
  );
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", roleSessionId: "session", assumedRoleId: "role" },
    headers: {},
    ip: "192.0.2.1",
  } as unknown as TypedRequest;
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
  env.security.supportAiConfig.masterSecret = originalMaster;
});
describe("support configuration mode bridge", () => {
  it("returns only the masked authorized configuration and rechecks before returning", async () => {
    iam.prepare.mockResolvedValue({
      configs: [{ key: CONFIG_KEYS.SUPPORT_AI.API_KEY, value: "fixture-encrypted-secret" }],
    });
    const result = await service.getAdminConfig(request);
    expect(result.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture-encrypted-secret");
    expect(iam.recheck).toHaveBeenCalled();
    expect(config.getMultiple).not.toHaveBeenCalled();
  });
  it("writes all settings through one guarded transaction and audits keys only", async () => {
    const result = await service.updateConfig(body, "actor", request);
    expect(result).toMatchObject({ model: "fixture-model", enabled: true });
    expect(iam.prepare).toHaveBeenCalledWith("quyan:support:UpdateConfig", "actor", request);
    expect(iam.update).toHaveBeenCalledTimes(1);
    expect(config.set).not.toHaveBeenCalled();
    expect(audit.logOperation.mock.calls[0][0].changes).toEqual({
      keys: expect.arrayContaining([CONFIG_KEYS.SUPPORT_AI.MODEL]),
    });
    expect(audit.logOperation.mock.calls[0][0].changes).not.toHaveProperty("value");
  });
  it("fails closed on authorization, final checks or unknown request fields", async () => {
    iam.prepare.mockRejectedValue(new Error("fixture deny"));
    await expect(service.updateConfig(body, "actor", request)).rejects.toThrow("fixture deny");
    expect(config.getMultiple).not.toHaveBeenCalled();
    expect(config.set).not.toHaveBeenCalled();
    await expect(
      service.updateConfig({ ...body, accountId: "foreign" } as any, "actor", request),
    ).rejects.toMatchObject({ statusCode: 400 });
    iam.prepare.mockResolvedValue({ configs: [] });
    iam.recheck.mockRejectedValue(new Error("fixture final deny"));
    await expect(service.getAdminConfig(request)).rejects.toThrow("fixture final deny");
  });
  it("shadow retains current-role legacy enforcement and never writes twice", async () => {
    env.security.iamAuthorizationMode = "shadow";
    iam.prepare.mockRejectedValue(new Error("fixture shadow deny"));
    await service.updateConfig(body, "actor", request);
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.SUPPORT_AI_CONFIG], {
      assumedRoleSessionId: "session",
    });
    expect(config.set).toHaveBeenCalled();
    expect(iam.update).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.getAdminConfig(request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps the internal availability view separate from management authorization", async () => {
    expect(await service.getConfig()).toMatchObject({ apiKeyConfigured: false });
    expect(iam.prepare).not.toHaveBeenCalled();
  });
  it("encrypts newly supplied credentials, masks the response and clears only when requested", async () => {
    env.security.supportAiConfig.masterSecret = "fixture-only-master-".repeat(5);
    const result = await service.updateConfig({ ...body, apiKey: "fixture-only-upstream-key" }, "actor", request);
    const values = iam.update.mock.calls[0][0];
    expect(values[CONFIG_KEYS.SUPPORT_AI.API_KEY]).not.toContain("fixture-only-upstream-key");
    expect(values[CONFIG_KEYS.SUPPORT_AI.API_KEY].split(".")).toHaveLength(3);
    expect(result.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture-only-upstream-key");
    expect(JSON.stringify(audit.logOperation.mock.calls)).not.toContain("fixture-only-upstream-key");
    await service.updateConfig({ ...body, clearApiKey: true }, "actor", request);
    expect(iam.update.mock.calls[1][0][CONFIG_KEYS.SUPPORT_AI.API_KEY]).toBe("");
  });
});
