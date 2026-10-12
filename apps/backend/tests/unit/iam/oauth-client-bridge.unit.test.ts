import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "legacy" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/services/users/oauth-client-iam.service", () => ({ OAuthClientIamService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/users/oauth-client.repository", () => ({ OAuthClientRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/system/businesslog.service", () => ({ default: { getInstance: vi.fn() } }));
vi.mock("@/services/oauth/oauth-scope.service", () => ({ oauthScopeService: {} }));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture unavailable", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { env } from "@/config/env";
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
let iam: any, permissions: any, repo: any, service: OAuthClientService, request: TypedRequest;
beforeEach(() => {
  env.security.iamAuthorizationMode = "legacy";
  iam = {
    list: vi.fn().mockResolvedValue([record]),
    get: vi.fn().mockResolvedValue(record),
    diagnoseList: vi.fn().mockResolvedValue([]),
  };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) };
  repo = { findByUserId: vi.fn().mockResolvedValue([record]), findById: vi.fn().mockResolvedValue(record) };
  service = new (OAuthClientService as unknown as new (...args: any[]) => OAuthClientService)(
    repo,
    {},
    iam,
    permissions,
  );
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", roleSessionId: "session", assumedRoleId: "role" },
  } as unknown as TypedRequest;
});
describe("OAuth client read authorization mode bridge", () => {
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
