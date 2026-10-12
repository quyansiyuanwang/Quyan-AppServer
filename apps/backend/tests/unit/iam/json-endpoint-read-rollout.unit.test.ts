import { beforeEach, describe, expect, it, vi } from "vitest";
import { Project } from "ts-morph";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({ mode: "enforce", target: vi.fn(), warn: vi.fn() }));
vi.mock("@/config/env", () => ({
  env: {
    security: {
      get iamAuthorizationMode() {
        return mocks.mode;
      },
    },
  },
}));
vi.mock("@/store/system/json-endpoint.repository", () => ({ JsonEndpointRepository: { getInstance: vi.fn() } }));
vi.mock("@/store/users/user.repository", () => ({ UserRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/system/businesslog.service", () => ({ default: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/services/infrastructure/redis.service", () => ({ RedisService: { getInstance: vi.fn() } }));
vi.mock("@/services/json-endpoint/json-endpoint-iam.service", () => ({
  JsonEndpointIamService: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/json-endpoint-management.repository", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    JsonEndpointManagementRepository: { getInstance: () => ({ target: mocks.target }) },
    jsonEndpointDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: mocks.warn }), LogCategory: { SECURITY: "security" } }));
import { JsonEndpointService } from "@/services/json-endpoint/json-endpoint.service";
import { jsonEndpointResourceResolver } from "@/iam/request/json-endpoint-resource-resolvers";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
let service: JsonEndpointService, iam: any, repository: any, permission: any, users: any, request: TypedRequest;
const endpoint = {
  id: "endpoint",
  userId: "actor",
  name: "fixture",
  slug: "fixture",
  jsonContent: { private: true },
  isPublic: false,
  accessMode: "static-password",
  apiKey: "fixture-hash",
  publicKey: null,
  createTime: new Date(0),
  updateTime: new Date(0),
  accessCount: 0,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode = "enforce";
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", roleSessionId: "session" },
    params: { id: "endpoint" },
    headers: {},
  } as unknown as TypedRequest;
  repository = {
    findById: vi.fn().mockResolvedValue(endpoint),
    findByUserId: vi.fn().mockResolvedValue([endpoint]),
    findAll: vi.fn().mockResolvedValue([endpoint]),
  };
  users = {
    findById: vi.fn().mockResolvedValue({ username: "fixture" }),
    listNonDeleted: vi.fn().mockResolvedValue([]),
  };
  permission = {
    checkUserPermissions: vi
      .fn()
      .mockImplementation(async (_userId, required) => ({
        hasPermission: required.includes(Permission.JSON_ENDPOINT_READ),
      })),
  };
  iam = {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ id: "endpoint" }),
    owners: vi.fn().mockResolvedValue([]),
  };
  service = new (JsonEndpointService as unknown as new (...args: any[]) => JsonEndpointService)(
    repository,
    {},
    users,
    permission,
    {},
    iam,
  );
  mocks.target.mockResolvedValue({ id: "endpoint", userId: "peer" });
});
describe("JSON Endpoint read rollout and resolvers", () => {
  it("declares native read Actions on all three read routes without claiming the remaining mutations are migrated", () => {
    const file = "src/api/controllers/v1/json-endpoint/json-endpoint.controller.ts";
    const project = new Project({ useInMemoryFileSystem: true });
    const source = project.createSourceFile("/backend/" + file, readFileSync(file, "utf8"));
    const routes = collectIamRoutes([source], "/backend");
    const reads = routes.filter((r) => r.key.startsWith("GET "));
    expect(reads).toHaveLength(3);
    expect(reads.every((r) => r.coverage === "explicit" && r.issues.length === 0)).toBe(true);
    expect(routes.filter((r) => !r.key.startsWith("GET ")).every((r) => r.coverage === "legacy")).toBe(true);
  });
  it("enforce uses IAM-only payload paths and no legacy global reads", async () => {
    await service.listEndpoints("actor", "peer", request);
    await service.getEndpoint("endpoint", "actor", request);
    await service.listOwnerOptions("actor", request);
    expect(iam.list).toHaveBeenCalledWith("actor", "peer", request);
    expect(iam.get).toHaveBeenCalledWith("actor", "endpoint", request);
    expect(iam.owners).toHaveBeenCalledWith("actor", request);
    expect(repository.findAll).not.toHaveBeenCalled();
    expect(repository.findById).not.toHaveBeenCalled();
    expect(users.listNonDeleted).not.toHaveBeenCalled();
    expect(permission.checkUserPermissions).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"])(
    "%s preserves legacy Read own-resource scope and role-session permissions",
    async (mode) => {
      mocks.mode = mode;
      expect((await service.listEndpoints("actor", undefined, request))[0]).not.toHaveProperty("apiKey");
      expect(permission.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.JSON_ENDPOINT_READ], {
        assumedRoleSessionId: "session",
      });
      await expect(service.listEndpoints("actor", "peer", request)).rejects.toMatchObject({ statusCode: 403 });
      repository.findById.mockResolvedValue({ ...endpoint, userId: "peer" });
      await expect(service.getEndpoint("endpoint", "actor", request)).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.findAll).not.toHaveBeenCalled();
    },
  );
  it.each(["legacy", "shadow"])(
    "%s refuses unauthorized reads and user-name enumeration before payload queries",
    async (mode) => {
      mocks.mode = mode;
      permission.checkUserPermissions.mockResolvedValue({ hasPermission: false });
      await expect(service.listEndpoints("actor", undefined, request)).rejects.toMatchObject({ statusCode: 403 });
      await expect(service.getEndpoint("endpoint", "actor", request)).rejects.toMatchObject({ statusCode: 403 });
      await expect(service.listOwnerOptions("actor", request)).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.findByUserId).not.toHaveBeenCalled();
      expect(repository.findById).not.toHaveBeenCalled();
      expect(users.listNonDeleted).not.toHaveBeenCalled();
    },
  );
  it("shadow failure stays diagnostic while enforce never falls back", async () => {
    mocks.mode = "shadow";
    iam.list.mockRejectedValue(new Error("private content and policy"));
    expect(await service.listEndpoints("actor", undefined, request)).toHaveLength(1);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("private content and policy");
    mocks.mode = "enforce";
    await expect(service.listEndpoints("actor", undefined, request)).rejects.toThrow("private content and policy");
    expect(repository.findByUserId).toHaveBeenCalledTimes(1);
  });
  it("resolves actual endpoint ownership from database metadata", async () => {
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    expect(await jsonEndpointResourceResolver({ request, principal })).toBe(
      "acs:json-endpoint:*:owner:endpoint/peer/endpoint",
    );
    expect(mocks.target).toHaveBeenCalledWith(principal, "endpoint");
    mocks.target.mockResolvedValue({ id: "different", userId: "peer" });
    expect(await jsonEndpointResourceResolver({ request, principal })).toBeUndefined();
    request.params.id = "*";
    expect(await jsonEndpointResourceResolver({ request, principal })).toBeUndefined();
  });
});
