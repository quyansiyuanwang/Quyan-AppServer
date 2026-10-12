import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "legacy" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
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
let iam: any, permissions: any, repo: any, mutations: any, service: OAuthClientService, request: TypedRequest;
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
  repo.delete = vi.fn().mockResolvedValue(record);
  repo.update = vi.fn().mockImplementation(async (_: string, data: any) => ({ ...record, ...data }));
  mutations = {
    prepare: vi.fn().mockResolvedValue({
      existing: { ...record, reviewStatus: "approved" },
      guard: { identity: { principal: { roleSessionId: "session" } } },
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
