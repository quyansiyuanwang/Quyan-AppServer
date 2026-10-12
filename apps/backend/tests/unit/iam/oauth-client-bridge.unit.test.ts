import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "legacy" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/services/users/platform-oauth-client-mutation-iam.service", () => ({
  PlatformOAuthClientMutationIamService: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/platform-oauth-client-iam.service", () => ({
  PlatformOAuthClientIamService: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/oauth-client-mutation-iam.service", () => ({
  OAuthClientMutationIamService: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/oauth-client-iam.service", () => ({ OAuthClientIamService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/users/oauth-client.repository", () => ({ OAuthClientRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/system/businesslog.service", () => ({ default: { getInstance: vi.fn() } }));
vi.mock("@/services/oauth/oauth-scope.service", () => ({
  oauthScopeService: { normalizeAndAssertGrantable: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture unavailable", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { oauthScopeService } from "@/services/oauth/oauth-scope.service";
import { OAuthClientService } from "@/services/users/oauth-client.service";
import type { TypedRequest } from "@/types/express";
const record = {
  id: "client",
  userId: "actor",
  name: "fixture",
  clientId: "fixture-id",
  clientType: "confidential",
  reviewStatus: "draft",
  grantTypes: [],
  redirectUris: [],
  scopes: [],
  createTime: new Date(0),
  updateTime: new Date(0),
  hasClientSecret: true,
};
let iam: any,
  permissions: any,
  repo: any,
  mutations: any,
  platform: any,
  platformMutations: any,
  service: OAuthClientService,
  request: TypedRequest;
beforeEach(() => {
  env.security.iamAuthorizationMode = "legacy";
  vi.mocked(oauthScopeService.normalizeAndAssertGrantable).mockReset().mockResolvedValue(["profile"]);
  iam = {
    list: vi.fn().mockResolvedValue([record]),
    get: vi.fn().mockResolvedValue(record),
    diagnoseList: vi.fn().mockResolvedValue([]),
  };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) };
  repo = { findByUserId: vi.fn().mockResolvedValue([record]), findById: vi.fn().mockResolvedValue(record) };
  repo.findByClientId = vi.fn().mockResolvedValue(null);
  platformMutations = {
    prepareCreate: vi.fn().mockResolvedValue({ users: { principal: { roleSessionId: "session" } } }),
    create: vi.fn().mockImplementation(async (data: any) => {
      const { clientSecretHash, ...view } = data;
      return { ...record, ...view, hasClientSecret: !!clientSecretHash };
    }),
    prepareUpdate: vi.fn().mockResolvedValue({
      existing: { ...record, userId: "platform-creator", isSystemClient: true },
      guard: { users: { principal: { roleSessionId: "session" } } },
    }),
    update: vi.fn().mockImplementation(async (data: any) => ({
      ...record,
      userId: "platform-creator",
      isSystemClient: true,
      ...data,
    })),
  };
  platform = { list: vi.fn().mockResolvedValue([record]), diagnose: vi.fn().mockResolvedValue(undefined) };
  repo.findSystemClients = vi.fn().mockResolvedValue([record]);
  repo.create = vi.fn().mockImplementation(async (data: any) => ({ ...record, ...data }));
  repo.delete = vi.fn().mockResolvedValue(record);
  repo.update = vi.fn().mockImplementation(async (_: string, data: any) => ({ ...record, ...data }));
  mutations = {
    prepare: vi.fn().mockResolvedValue({
      existing: { ...record, reviewStatus: "approved" },
      guard: { identity: { principal: { roleSessionId: "session" } } },
    }),
    prepareCreate: vi.fn().mockResolvedValue({ identity: { principal: { roleSessionId: "session" } }, users: {} }),
    create: vi.fn().mockImplementation(async (data: any) => {
      const { clientSecretHash, ...view } = data;
      return { ...record, ...view, hasClientSecret: !!clientSecretHash };
    }),
    revoke: vi.fn().mockResolvedValue(record),
    update: vi.fn().mockImplementation(async (data: any) => ({ ...record, ...data })),
  };
  service = new (OAuthClientService as unknown as new (...args: any[]) => OAuthClientService)(
    repo,
    { logOperation: vi.fn() },
    iam,
    permissions,
    mutations,
    platform,
    platformMutations,
  );

  request = {
    headers: {},
    ip: "192.0.2.1",
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", roleSessionId: "session", assumedRoleId: "role" },
  } as unknown as TypedRequest;
});
describe("OAuth client authorization mode bridge", () => {
  it("enforce uses only the resource boundary and preserves the has-secret boolean without hashes", async () => {
    env.security.iamAuthorizationMode = "enforce";
    expect((await service.listClients("actor", request))[0]).toMatchObject({ id: "client", hasClientSecret: true });
    expect(await service.getClient("client", "actor", request)).not.toHaveProperty("clientSecretHash");
    expect(repo.findByUserId).not.toHaveBeenCalled();
    expect(repo.findById).not.toHaveBeenCalled();
  });
  it("never falls back to legacy reads on an IAM error", async () => {
    env.security.iamAuthorizationMode = "enforce";
    iam.list.mockRejectedValue(new Error("fixture evaluator unavailable"));
    await expect(service.listClients("actor", request)).rejects.toThrow("fixture evaluator unavailable");
    expect(repo.findByUserId).not.toHaveBeenCalled();
  });
  it("legacy checks the current role session before returning original data", async () => {
    await service.listClients("actor", request);
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", expect.any(Array), {
      assumedRoleSessionId: "session",
    });
    expect(iam.list).not.toHaveBeenCalled();
    expect(iam.diagnoseList).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.getClient("client", "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.findById).not.toHaveBeenCalled();
  });
  it("shadow uses metadata diagnostics and preserves the legacy enforcement result", async () => {
    env.security.iamAuthorizationMode = "shadow";
    iam.diagnoseList.mockRejectedValue(new Error("fixture deny"));
    await expect(service.listClients("actor", request)).resolves.toHaveLength(1);
    expect(iam.diagnoseList).toHaveBeenCalled();
    expect(iam.list).not.toHaveBeenCalled();
    await service.getClient("client", "actor", request);
    expect(iam.get).toHaveBeenCalledWith("actor", "client", request, false);
  });
});

describe("OAuth application update business enforcement", () => {
  it("keeps update metadata-only and resets review state without requiring GetClient", async () => {
    env.security.iamAuthorizationMode = "enforce";
    const updated = await service.updateClient("client", "actor", { name: " renamed " }, request);
    expect(updated).toMatchObject({ name: "renamed", reviewStatus: "draft", hasClientSecret: true });
    expect(mutations.prepare).toHaveBeenCalledWith("quyan:oauth:UpdateClient", "actor", "client", request);
    expect(mutations.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: "renamed", reviewStatus: "draft", reviewComment: null }),
      expect.anything(),
    );
    expect(repo.findById).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(iam.get).not.toHaveBeenCalled();
  });
  it("checks updated OAuth scopes against the exact role session, including the commit callback", async () => {
    env.security.iamAuthorizationMode = "enforce";
    await service.updateClient("client", "actor", { scopes: ["profile"] }, request);
    expect(oauthScopeService.normalizeAndAssertGrantable).toHaveBeenCalledWith("actor", ["profile"], {
      assumedRoleSessionId: "session",
    });
    const guard = mutations.update.mock.calls[0][1];
    await guard.scopeCheck();
    expect(oauthScopeService.normalizeAndAssertGrantable).toHaveBeenCalledTimes(2);
  });
  it("rejects unknown mutation fields and ungrantable scopes before writing", async () => {
    env.security.iamAuthorizationMode = "enforce";
    await expect(
      service.updateClient("client", "actor", { accountId: "foreign" } as any, request),
    ).rejects.toMatchObject({ statusCode: 400 });
    vi.mocked(oauthScopeService.normalizeAndAssertGrantable).mockRejectedValue(new Error("fixture scope denied"));
    await expect(service.updateClient("client", "actor", { scopes: ["profile"] }, request)).rejects.toThrow(
      "fixture scope denied",
    );
    expect(mutations.update).not.toHaveBeenCalled();
  });
  it("submit-review uses its own action and does not approve the application", async () => {
    env.security.iamAuthorizationMode = "enforce";
    expect(await service.submitForReview("client", "actor", request)).toMatchObject({ reviewStatus: "pending" });
    expect(mutations.prepare).toHaveBeenCalledWith("quyan:oauth:SubmitClientReview", "actor", "client", request);
    expect(mutations.update).toHaveBeenCalledWith(
      expect.objectContaining({ reviewStatus: "pending", reviewedByUserId: null }),
      expect.anything(),
    );
  });
  it("shadow enforces legacy writes and only prepares metadata diagnostics", async () => {
    env.security.iamAuthorizationMode = "shadow";
    mutations.prepare.mockRejectedValue(new Error("fixture deny"));
    await service.updateClient("client", "actor", { name: "new" }, request);
    expect(mutations.prepare).toHaveBeenCalledWith("quyan:oauth:UpdateClient", "actor", "client", request, false);
    expect(repo.update).toHaveBeenCalled();
    expect(mutations.update).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.submitForReview("client", "actor", request)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("OAuth secret rotation and deletion resource behavior", () => {
  it("returns only the newly generated secret after a guarded rotation", async () => {
    env.security.iamAuthorizationMode = "enforce";
    const result = await service.regenerateSecret("client", "actor", request);
    expect(result.clientSecret).toMatch(/^oauths_/);
    expect(result).not.toHaveProperty("clientSecretHash");
    expect(mutations.prepare).toHaveBeenCalledWith("quyan:oauth:RotateClientSecret", "actor", "client", request);
    expect(mutations.update).toHaveBeenCalledWith(
      expect.objectContaining({
        clientSecretHash: expect.stringMatching(/^\$2/),
        clientSecretPreview: expect.any(String),
      }),
      expect.anything(),
    );
    expect(repo.update).not.toHaveBeenCalled();
  });
  it("refuses secret rotation for public applications before generating a write", async () => {
    env.security.iamAuthorizationMode = "enforce";
    mutations.prepare.mockResolvedValue({ existing: { ...record, clientType: "public" }, guard: {} });
    await expect(service.regenerateSecret("client", "actor", request)).rejects.toMatchObject({ statusCode: 400 });
    expect(mutations.update).not.toHaveBeenCalled();
  });
  it("deletes through the transactional resource boundary and has no legacy fallback", async () => {
    env.security.iamAuthorizationMode = "enforce";
    await service.deleteClient("client", "actor", request);
    expect(mutations.prepare).toHaveBeenCalledWith("quyan:oauth:DeleteClient", "actor", "client", request);
    expect(mutations.revoke).toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
    mutations.revoke.mockRejectedValue(new Error("fixture final deny"));
    await expect(service.deleteClient("client", "actor", request)).rejects.toThrow("fixture final deny");
    expect(repo.delete).not.toHaveBeenCalled();
  });
  it("enforces delete legacy permission in shadow while diagnostics perform no writes", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await service.deleteClient("client", "actor", request);
    expect(mutations.prepare).toHaveBeenCalledWith("quyan:oauth:DeleteClient", "actor", "client", request, false);
    expect(repo.delete).toHaveBeenCalled();
    expect(mutations.revoke).not.toHaveBeenCalled();
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.OAUTH_CLIENT_DELETE], {
      assumedRoleSessionId: "session",
    });
  });
});

describe("OAuth application resource-authorized creation", () => {
  const data = { name: "new app", redirectUris: ["https://example.com/callback"], scopes: ["profile"] };
  it("returns the initial new confidential secret, authorizes the user parent and remains draft", async () => {
    env.security.iamAuthorizationMode = "enforce";
    const result = await service.createClient("actor", data, request);
    expect(result).toMatchObject({ name: "new app", reviewStatus: "draft", hasClientSecret: true });
    expect(result.clientSecret).toMatch(/^oauths_/);
    expect(result).not.toHaveProperty("clientSecretHash");
    expect(mutations.prepareCreate).toHaveBeenCalledWith("actor", request);
    expect(mutations.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "actor", reviewStatus: "draft" }),
      expect.anything(),
    );
    expect(repo.create).not.toHaveBeenCalled();
    await mutations.create.mock.calls[0][1].scopeCheck();
    expect(oauthScopeService.normalizeAndAssertGrantable).toHaveBeenLastCalledWith("actor", ["profile"], {
      assumedRoleSessionId: "session",
    });
  });
  it("public application creation does not generate a secret", async () => {
    env.security.iamAuthorizationMode = "enforce";
    const result = await service.createClient("actor", { ...data, clientType: "public" }, request);
    expect(result).toMatchObject({ clientSecret: "", hasClientSecret: false });
    expect(mutations.create.mock.calls[0][0].clientSecretHash).toBeUndefined();
  });
  it("refuses unknown fields and never falls back to legacy creation on IAM failure", async () => {
    env.security.iamAuthorizationMode = "enforce";
    await expect(
      service.createClient("actor", { ...data, isSystemClient: true } as any, request),
    ).rejects.toMatchObject({ statusCode: 400 });
    mutations.prepareCreate.mockRejectedValue(new Error("fixture denied"));
    await expect(service.createClient("actor", data, request)).rejects.toThrow("fixture denied");
    expect(repo.create).not.toHaveBeenCalled();
    expect(mutations.create).not.toHaveBeenCalled();
  });
  it("shadow prepares only metadata, then enforces the existing creation permission", async () => {
    env.security.iamAuthorizationMode = "shadow";
    mutations.prepareCreate.mockRejectedValue(new Error("fixture policy deny"));
    await service.createClient("actor", { ...data, clientType: "public" }, request);
    expect(mutations.prepareCreate).toHaveBeenCalledWith("actor", request);
    expect(mutations.create).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalled();
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.OAUTH_CLIENT_CREATE], {
      assumedRoleSessionId: "session",
    });
  });
});

describe("system OAuth application read mode boundary", () => {
  it("enforce returns the platform-filtered view and never falls back to the old repository", async () => {
    env.security.iamAuthorizationMode = "enforce";
    await expect(service.listSystemClients(request)).resolves.toHaveLength(1);
    expect(platform.list).toHaveBeenCalledWith(request);
    expect(repo.findSystemClients).not.toHaveBeenCalled();
    platform.list.mockRejectedValue(new Error("fixture platform ceiling denied"));
    await expect(service.listSystemClients(request)).rejects.toThrow("fixture platform ceiling denied");
    expect(repo.findSystemClients).not.toHaveBeenCalled();
  });
  it("shadow enforces the existing current-role permission and diagnoses only metadata", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await expect(service.listSystemClients(request)).resolves.toHaveLength(1);
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.OAUTH_CLIENT_SYSTEM_MANAGE], {
      assumedRoleSessionId: "session",
    });
    expect(platform.diagnose).toHaveBeenCalledWith(request);
    expect(platform.list).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.listSystemClients(request)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("system OAuth application update behavior", () => {
  it("uses the platform guard and checks new scopes against the active role session", async () => {
    env.security.iamAuthorizationMode = "enforce";
    const updated = await service.updateSystemClient(
      "client",
      "actor",
      { name: "system", scopes: ["profile"] },
      request,
    );
    expect(updated).toMatchObject({ name: "system", isSystemClient: true, userId: "platform-creator" });
    expect(platformMutations.prepareUpdate).toHaveBeenCalledWith("actor", "client", request);
    expect(repo.findById).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(oauthScopeService.normalizeAndAssertGrantable).toHaveBeenLastCalledWith("actor", ["profile"], {
      assumedRoleSessionId: "session",
    });
    await platformMutations.update.mock.calls[0][1].scopeCheck();
  });
  it("refuses protected fields and never falls back to legacy on failed platform authorization", async () => {
    env.security.iamAuthorizationMode = "enforce";
    await expect(
      service.updateSystemClient("client", "actor", { clientType: "public" } as any, request),
    ).rejects.toMatchObject({ statusCode: 400 });
    platformMutations.prepareUpdate.mockRejectedValue(new Error("fixture platform deny"));
    await expect(service.updateSystemClient("client", "actor", { name: "system" }, request)).rejects.toThrow(
      "fixture platform deny",
    );
    expect(repo.update).not.toHaveBeenCalled();
    expect(platformMutations.update).not.toHaveBeenCalled();
  });
  it("shadow checks legacy management and never invokes a second write", async () => {
    env.security.iamAuthorizationMode = "shadow";
    repo.findById.mockResolvedValue({ ...record, isSystemClient: true });
    platformMutations.prepareUpdate.mockRejectedValue(new Error("fixture shadow deny"));
    await service.updateSystemClient("client", "actor", { name: "system" }, request);
    expect(platformMutations.prepareUpdate).toHaveBeenCalledWith("actor", "client", request, false);
    expect(repo.update).toHaveBeenCalled();
    expect(platformMutations.update).not.toHaveBeenCalled();
  });
});

describe("system OAuth application creation behavior", () => {
  const data = {
    clientId: "fixture-system",
    name: "system",
    redirectUris: ["https://example.com/callback"],
    scopes: ["profile"],
  };
  it("creates an approved public system app after authorization and current-role scope checks", async () => {
    env.security.iamAuthorizationMode = "enforce";
    const created = await service.createSystemClient("actor", data, request);
    expect(created).toMatchObject({
      isSystemClient: true,
      reviewStatus: "approved",
      clientType: "public",
      clientSecret: "",
      hasClientSecret: false,
    });
    expect(platformMutations.prepareCreate).toHaveBeenCalledWith("actor", request);
    expect(repo.create).not.toHaveBeenCalled();
    expect(oauthScopeService.normalizeAndAssertGrantable).toHaveBeenCalledWith("actor", ["profile"], {
      assumedRoleSessionId: "session",
    });
    const [input, guard] = platformMutations.create.mock.calls[0];
    expect(input).toMatchObject({ userId: "actor", reviewedByUserId: "actor", isPkceRequired: true });
    await guard.scopeCheck();
    expect(oauthScopeService.normalizeAndAssertGrantable).toHaveBeenCalledTimes(2);
  });
  it("returns only the new confidential secret and preserves lifetime constraints", async () => {
    env.security.iamAuthorizationMode = "enforce";
    const created = await service.createSystemClient(
      "actor",
      { ...data, clientType: "confidential", accessTokenLifetime: 600 },
      request,
    );
    expect(created.clientSecret.length).toBeGreaterThan(20);
    expect(created).not.toHaveProperty("clientSecretHash");
    expect(platformMutations.create.mock.calls[0][0]).toMatchObject({
      accessTokenLifetime: 600,
      clientSecretHash: expect.stringMatching(/^\$2/),
    });
    await expect(
      service.createSystemClient("actor", { ...data, accessTokenLifetime: 1 }, request),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("rejects unknown fields, Deny and existing IDs without a write or legacy fallback", async () => {
    env.security.iamAuthorizationMode = "enforce";
    await expect(
      service.createSystemClient("actor", { ...data, userId: "foreign" } as any, request),
    ).rejects.toMatchObject({ statusCode: 400 });
    platformMutations.prepareCreate.mockRejectedValue(new Error("fixture platform deny"));
    await expect(service.createSystemClient("actor", data, request)).rejects.toThrow("fixture platform deny");
    expect(repo.findByClientId).not.toHaveBeenCalled();
    platformMutations.prepareCreate.mockResolvedValue({ users: { principal: { roleSessionId: "session" } } });
    repo.findByClientId.mockResolvedValue(record);
    await expect(service.createSystemClient("actor", data, request)).rejects.toMatchObject({ statusCode: 400 });
    expect(platformMutations.create).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });
  it("shadow retains current-role legacy checks and performs exactly one legacy creation", async () => {
    env.security.iamAuthorizationMode = "shadow";
    platformMutations.prepareCreate.mockRejectedValue(new Error("fixture shadow deny"));
    await service.createSystemClient("actor", data, request);
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.OAUTH_CLIENT_SYSTEM_MANAGE], {
      assumedRoleSessionId: "session",
    });
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(platformMutations.create).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.createSystemClient("actor", data, request)).rejects.toMatchObject({ statusCode: 403 });
  });
});
