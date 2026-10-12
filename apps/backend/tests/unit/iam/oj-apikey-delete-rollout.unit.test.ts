import { beforeEach, describe, expect, it, vi } from "vitest";
import { Project } from "ts-morph";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({ mode: "enforce", warn: vi.fn() }));
vi.mock("@/config/env", () => ({
  env: {
    security: {
      get iamAuthorizationMode() {
        return mocks.mode;
      },
    },
  },
}));
vi.mock("@/store/users/user.repository", () => ({ UserRepository: { getInstance: vi.fn() } }));
vi.mock("@/store/oj-submitter/oj-apikey.repository", () => ({ OJAPIKeyRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/system/businesslog.service", () => ({ default: { getInstance: vi.fn() } }));
vi.mock("@/services/relay/relay-channel.service", () => ({ RelayChannelService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/services/oj-submitter/oj-apikey-iam.service", () => ({ OjApiKeyIamService: { getInstance: vi.fn() } }));
vi.mock("@/store/oj-submitter/oj-apikey-management.repository", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    OjApiKeyManagementRepository: { getInstance: vi.fn() },
    ojApiKeyDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: mocks.warn }), LogCategory: { SECURITY: "security" } }));
import { OJAPIKeyService } from "@/services/oj-submitter/oj-apikey.service";
import { Permission } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
let service: OJAPIKeyService, iam: any, repository: any, permissions: any, request: TypedRequest, audit: any;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode = "enforce";
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", roleSessionId: "session" },
    headers: {},
    ip: "127.0.0.1",
  } as unknown as TypedRequest;
  iam = {
    revoke: vi.fn().mockResolvedValue({ id: "key", userId: "actor", name: "fixture" }),
    authorizeDeletion: vi.fn(),
  };
  repository = {
    findActiveByIdAndUserId: vi.fn().mockResolvedValue({ id: "key", userId: "actor", name: "fixture" }),
    softDeleteById: vi.fn(),
  };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) };
  audit = { logOperation: vi.fn() };
  service = new (OJAPIKeyService as unknown as new (...args: any[]) => OJAPIKeyService)(
    {},
    repository,
    audit,
    {},
    iam,
    permissions,
  );
});
describe("OJ API Key revocation rollout", () => {
  it("enforce bypasses all legacy credential hydration and records only a safe operation log", async () => {
    await service.deleteAPIKey("key", "actor", request);
    expect(iam.revoke).toHaveBeenCalledWith("actor", "key", request);
    expect(repository.findActiveByIdAndUserId).not.toHaveBeenCalled();
    expect(repository.softDeleteById).not.toHaveBeenCalled();
    expect(audit.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ targetResourceId: "key", success: true }),
    );
  });
  it.each(["legacy", "shadow"])("%s retains session-scoped legacy permission before any read", async (mode) => {
    mocks.mode = mode;
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.deleteAPIKey("key", "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.OJ_APIKEY_DELETE], {
      assumedRoleSessionId: "session",
    });
    expect(repository.findActiveByIdAndUserId).not.toHaveBeenCalled();
    expect(repository.softDeleteById).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"])("%s refuses keys belonging to another user", async (mode) => {
    mocks.mode = mode;
    repository.findActiveByIdAndUserId.mockResolvedValue({ id: "key", userId: "peer" });
    await expect(service.deleteAPIKey("key", "actor", request)).rejects.toMatchObject({ statusCode: 404 });
    expect(repository.softDeleteById).not.toHaveBeenCalled();
  });
  it("shadow failure is diagnostic only and never causes a second mutation", async () => {
    mocks.mode = "shadow";
    iam.authorizeDeletion.mockRejectedValue(new Error("private key/policy"));
    await service.deleteAPIKey("key", "actor", request);
    expect(iam.revoke).not.toHaveBeenCalled();
    expect(repository.softDeleteById).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("private key/policy");
  });
  it("enforce authorization errors do not fall back", async () => {
    iam.revoke.mockRejectedValue(new Error("unavailable"));
    await expect(service.deleteAPIKey("key", "actor", request)).rejects.toThrow("unavailable");
    expect(repository.softDeleteById).not.toHaveBeenCalled();
    expect(audit.logOperation).not.toHaveBeenCalled();
  });
  it("keeps two-factor and replay middleware while declaring an explicit native delete Action", () => {
    const file = "src/api/controllers/v1/oj-submitter/oj-apikey.controller.ts",
      text = readFileSync(file, "utf8");
    const project = new Project({ useInMemoryFileSystem: true }),
      source = project.createSourceFile("/backend/" + file, text);
    const routes = collectIamRoutes([source], "/backend");
    expect(routes.find((r) => r.key.startsWith("DELETE "))).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:oj:DeleteApiKey"],
      issues: [],
    });
    const method = source.getClassOrThrow("OJAPIKeyController").getMethodOrThrow("deleteAPIKey");
    expect(method.getDecorator("TwoFactorChallengeProtected")).toBeDefined();
    expect(method.getDecorator("Middlewares")?.getText()).toContain("twoFactorChallengeMiddleware");
    expect(method.getDecorator("Middlewares")?.getText()).toContain("replayProtectionMiddleware");
  });
});
