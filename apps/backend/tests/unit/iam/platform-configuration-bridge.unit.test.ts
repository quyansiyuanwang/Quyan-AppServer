import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/system/platform-configuration-iam.service", () => ({
  PlatformConfigurationIamService: { getInstance: vi.fn() },
}));
import { ConfigService } from "@/services/system/config.service";
import { env } from "@/config/env";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { RELAY_CONFIGURATION_KEYS, RELAY_PROXY_CONFIGURATION_KEYS } from "@/constant/config-keysets";
import { Permission, SERVER_CONFIG_SECRET_PLACEHOLDER } from "@quyan/shared";
import { AIResourceConfigService } from "@/services/infrastructure/ai-resource-config.service";
import { AI_RESOURCE_DEFAULTS } from "@/config/ai-resource-policy";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode;
let service: ConfigService, iam: any, repo: any, permissions: any, audit: any, request: TypedRequest;
beforeEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  iam = {
    list: vi.fn().mockResolvedValue({ configs: { [CONFIG_KEYS.SMTP.HOST]: "mail" }, aiResourcesAllowed: false }),
    prepareUpdate: vi.fn().mockResolvedValue({ action: "quyan:system:UpdateConfigurations" }),
    prepareRead: vi.fn().mockResolvedValue({ action: "quyan:system:ListConfigurations" }),
    recheck: vi.fn(),
    update: vi
      .fn()
      .mockImplementation(async (values: any) =>
        Object.entries(values).map(([key, value]) => ({ key, value, updateTime: new Date(0) })),
      ),
  };
  repo = { findAll: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue({ updateTime: new Date(0) }) };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) };
  audit = { logOperation: vi.fn() };
  service = new (ConfigService as unknown as new (...args: any[]) => ConfigService)(audit, repo, iam, permissions);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", roleSessionId: "session", assumedRoleId: "role" },
    headers: {},
    ip: "192.0.2.1",
  } as unknown as TypedRequest;
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
  AIResourceConfigService.getInstance().apply(structuredClone(AI_RESOURCE_DEFAULTS));
  vi.restoreAllMocks();
});
describe("managed configuration mode bridge", () => {
  it("uses the authorized list and never reads the legacy raw config table", async () => {
    expect(await service.getManagedConfigs(request)).toMatchObject({
      configs: { [CONFIG_KEYS.SMTP.HOST]: "mail" },
      aiResourcesAllowed: false,
    });
    expect(repo.findAll).not.toHaveBeenCalled();
    iam.list.mockRejectedValue(new Error("fixture platform deny"));
    await expect(service.getManagedConfigs(request)).rejects.toThrow("fixture platform deny");
    expect(repo.findAll).not.toHaveBeenCalled();
  });
  it("writes one authorized batch and audits key names only", async () => {
    await service.setManagedConfigs({ [CONFIG_KEYS.SMTP.HOST]: "mail" }, "actor", request);
    expect(iam.prepareUpdate).toHaveBeenCalledWith([CONFIG_KEYS.SMTP.HOST], "actor", request);
    expect(iam.update).toHaveBeenCalledTimes(1);
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(audit.logOperation.mock.calls[0][0].changes).toEqual({ keys: [CONFIG_KEYS.SMTP.HOST] });
  });
  it("never stores display markers or plaintext support credentials", async () => {
    await expect(
      service.setManagedConfigs({ [CONFIG_KEYS.SMTP.PASSWORD]: SERVER_CONFIG_SECRET_PLACEHOLDER }, "actor", request),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.setManagedConfigs({ [CONFIG_KEYS.SUPPORT_AI.API_KEY]: "fixture-plaintext" }, "actor", request),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(iam.update).not.toHaveBeenCalled();
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("publishes AI capacity settings only after a successful guarded commit", async () => {
    const settings = structuredClone(AI_RESOURCE_DEFAULTS);
    settings.aiResources.maxActiveRequests += 1;
    const apply = vi.spyOn(AIResourceConfigService.getInstance(), "apply");
    iam.update.mockRejectedValueOnce(new Error("fixture final deny"));
    await expect(
      service.setManagedConfigs({ [CONFIG_KEYS.AI_RESOURCES]: JSON.stringify(settings) }, "actor", request),
    ).rejects.toThrow("fixture final deny");
    expect(apply).not.toHaveBeenCalled();
    await service.setManagedConfigs({ [CONFIG_KEYS.AI_RESOURCES]: JSON.stringify(settings) }, "actor", request);
    expect(apply).toHaveBeenCalledWith(settings, new Date(0).toISOString());
  });
  it("shadow preserves current-role legacy checks and executes one old write", async () => {
    env.security.iamAuthorizationMode = "shadow";
    iam.prepareUpdate.mockRejectedValue(new Error("fixture shadow deny"));
    await service.setManagedConfigs({ [CONFIG_KEYS.SMTP.HOST]: "mail" }, "actor", request);
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.SYSTEM_CONFIG], {
      assumedRoleSessionId: "session",
    });
    expect(repo.upsert).toHaveBeenCalledTimes(1);
    expect(iam.update).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.getManagedConfigs(request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("masks typed configuration secrets and rechecks the complete read before returning", async () => {
    const read = vi.fn().mockResolvedValue({
      host: "mail",
      password: "fixture-secret",
      github: { clientSecret: "fixture-nested-secret" },
      maxOutputTokens: 2048,
    });
    const result = await service.getManagedConfiguration(Object.values(CONFIG_KEYS.SMTP), request, read);
    expect(result).toEqual({
      host: "mail",
      password: SERVER_CONFIG_SECRET_PLACEHOLDER,
      github: { clientSecret: SERVER_CONFIG_SECRET_PLACEHOLDER },
      maxOutputTokens: 2048,
    });
    expect(iam.prepareRead).toHaveBeenCalledWith(Object.values(CONFIG_KEYS.SMTP), request);
    expect(iam.recheck).toHaveBeenCalled();
    iam.recheck.mockRejectedValue(new Error("fixture stale configuration"));
    await expect(service.getManagedConfiguration(Object.values(CONFIG_KEYS.SMTP), request, read)).rejects.toThrow(
      "fixture stale configuration",
    );
    iam.prepareRead.mockRejectedValue(new Error("fixture read deny"));
    read.mockClear();
    await expect(service.getManagedConfiguration(Object.values(CONFIG_KEYS.SMTP), request, read)).rejects.toThrow(
      "fixture read deny",
    );
    expect(read).not.toHaveBeenCalled();
  });
  it("preserves masked SMTP credentials while still honoring explicit replacement or clear", async () => {
    await service.setManagedConfiguration(
      { [CONFIG_KEYS.SMTP.HOST]: "mail", [CONFIG_KEYS.SMTP.PASSWORD]: SERVER_CONFIG_SECRET_PLACEHOLDER },
      "actor",
      request,
    );
    expect(iam.prepareUpdate).toHaveBeenCalledWith([CONFIG_KEYS.SMTP.HOST], "actor", request);
    expect(iam.update.mock.calls[0][0]).toEqual({ [CONFIG_KEYS.SMTP.HOST]: "mail" });
    await service.setManagedConfiguration({ [CONFIG_KEYS.SMTP.PASSWORD]: "" }, "actor", request);
    expect(iam.update.mock.calls[1][0]).toEqual({ [CONFIG_KEYS.SMTP.PASSWORD]: "" });
  });
});

it("limits relay reads to the declared dependencies and preserves credential-bearing URL markers", async () => {
  repo.findByKeys = vi.fn().mockResolvedValue([
    { key: CONFIG_KEYS.RELAY.UPSTREAM_API_KEY, value: "fixture-key" },
    {
      key: CONFIG_KEYS.RELAY.UPSTREAM_PROXY_URL,
      value: "socks5h://fixture-user:fixture-password@proxy.example.test:1080",
    },
  ]);
  const config = await service.getManagedConfiguration(RELAY_CONFIGURATION_KEYS, request, () =>
    service.getRelayConfig(),
  );
  expect(config.upstreamApiKey).toBe(SERVER_CONFIG_SECRET_PLACEHOLDER);
  expect(repo.findByKeys).toHaveBeenCalledWith([...RELAY_CONFIGURATION_KEYS]);
  expect(RELAY_CONFIGURATION_KEYS).not.toContain(CONFIG_KEYS.RELAY.MODEL_RATES);
  const proxy = await service.getManagedConfiguration(RELAY_PROXY_CONFIGURATION_KEYS, request, () =>
    service.getRelayProxyConfig(),
  );
  expect(proxy.url).toBe(SERVER_CONFIG_SECRET_PLACEHOLDER);
  await service.setManagedConfiguration(
    { [CONFIG_KEYS.RELAY.UPSTREAM_PROXY_URL]: proxy.url, [CONFIG_KEYS.RELAY.UPSTREAM_PROXY_ENABLED]: "true" },
    "actor",
    request,
  );
  expect(iam.update).toHaveBeenCalledWith({ [CONFIG_KEYS.RELAY.UPSTREAM_PROXY_ENABLED]: "true" }, expect.anything());
  await service.setManagedConfiguration({ [CONFIG_KEYS.RELAY.UPSTREAM_PROXY_URL]: "" }, "actor", request);
  expect(iam.update).toHaveBeenLastCalledWith({ [CONFIG_KEYS.RELAY.UPSTREAM_PROXY_URL]: "" }, expect.anything());
});
it("redacts legacy configuration audits including social secrets and credential-bearing URLs", async () => {
  await service.set(CONFIG_KEYS.SOCIAL_AUTH.GITHUB.CLIENT_SECRET, "fixture-client-secret", "actor", request);
  await service.set(
    CONFIG_KEYS.RELAY.UPSTREAM_URL,
    "https://fixture-user:fixture-password@upstream.example.test",
    "actor",
    request,
  );
  for (const [entry] of audit.logOperation.mock.calls) expect(entry.changes.value).toBe("***");
});
