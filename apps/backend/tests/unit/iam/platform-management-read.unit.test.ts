import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture deny", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { PlatformManagementReadIamService } from "@/services/system/platform-management-read-iam.service";
import { platformSystemArn } from "@/iam/resources/platform-system-resources";
import {
  platformBuildInfoResource,
  platformSystemStatisticsResource,
  platformConsumptionStatisticsResource,
} from "@/iam/request/platform-system-resource-resolvers";
import { getIamActionDefinition, Permission } from "@quyan/shared";
import { env } from "@/config/env";
import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const originalMode = env.security.iamAuthorizationMode;
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
let service: PlatformManagementReadIamService, iam: any, repo: any, permissions: any, request: TypedRequest;
beforeEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  iam = { authorize: vi.fn().mockResolvedValue(allow) };
  repo = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] }),
    recheck: vi.fn(),
  };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) };
  service = new (PlatformManagementReadIamService as unknown as new (
    ...args: any[]
  ) => PlatformManagementReadIamService)(iam, repo, permissions);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", assumedRoleId: "role", roleSessionId: "session" },
    headers: { "x-action": "*" },
    body: { accountId: "foreign" },
  } as unknown as TypedRequest;
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
const action = "quyan:system:GetStatistics",
  resource = platformSystemArn("stats");
describe("platform management reads", () => {
  it("uses a fixed independent Action and platform resource for business log filter options", async () => {
    const read = vi.fn().mockResolvedValue({ operationTypes: [], operationCategories: [] }),
      businessAction = "quyan:system:business_log:GetFilterOptions",
      businessResource = platformSystemArn("business-log-options");
    expect(getIamActionDefinition(businessAction)).toMatchObject({
      legacyPermission: Permission.SYSTEM_BUSINESS_LOG_READ,
      authorizationBoundary: "platform",
      resourceTypes: ["platform/system"],
    });
    await service.read(businessAction, businessResource, request, read);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: businessAction,
        resource: "acs:platform:*:platform:system/business-log-options",
      }),
    );
    expect(repo.snapshot).toHaveBeenCalledWith(expect.anything(), Permission.SYSTEM_BUSINESS_LOG_READ);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("authorizes before business reads and rechecks the same identity and grant before return", async () => {
    const read = vi.fn().mockResolvedValue({ fixture: true });
    expect(await service.read(action, resource, request, read)).toEqual({ fixture: true });
    expect(read).toHaveBeenCalledTimes(1);
    expect(iam.authorize).toHaveBeenCalledTimes(2);
    expect(iam.authorize.mock.calls[0][0]).toMatchObject({
      action,
      resource,
      principal: { accountOwnerId: "owner", roleSessionId: "session" },
    });
    expect(repo.snapshot).toHaveBeenCalledWith(expect.anything(), Permission.SYSTEM_STATS_READ);
    expect(repo.recheck).toHaveBeenCalledTimes(2);
  });
  it("does not read after Deny or an unavailable authorization store", async () => {
    const read = vi.fn();
    iam.authorize.mockResolvedValue({ ...allow, decision: "ExplicitDeny" });
    await expect(service.read(action, resource, request, read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
    repo.snapshot.mockRejectedValue(new Error("fixture unavailable"));
    await expect(service.read(action, resource, request, read)).rejects.toThrow("fixture unavailable");
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects final Deny and stale group snapshots after one business read", async () => {
    const read = vi.fn().mockResolvedValue({ fixture: true });
    iam.authorize.mockResolvedValueOnce(allow).mockResolvedValueOnce({ ...allow, decision: "ExplicitDeny" });
    await expect(service.read(action, resource, request, read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).toHaveBeenCalledTimes(1);
    iam.authorize.mockResolvedValue(allow);
    repo.recheck.mockRejectedValue(new Error("fixture stale group"));
    await expect(service.read(action, resource, request, read)).rejects.toThrow("fixture stale group");
  });
  it("keeps current-role legacy enforcement in shadow and performs no duplicate business read", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const read = vi.fn().mockResolvedValue("fixture");
    iam.authorize.mockResolvedValue({ ...allow, decision: "ImplicitDeny" });
    expect(await service.read(action, resource, request, read)).toBe("fixture");
    expect(read).toHaveBeenCalledTimes(1);
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.SYSTEM_STATS_READ], {
      assumedRoleSessionId: "session",
    });
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.read(action, resource, request, read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("fails closed for missing identities, OAuth tokens, invalid modes, mutations and foreign resources", async () => {
    const read = vi.fn();
    await expect(service.read("quyan:system:UpdateConfigurations", resource, request, read)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      service.read("quyan:oauth:ListSystemClients", "acs:platform:*:platform:oauth-client/client", request, read),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.read(action, "acs:platform:*:owner:system/stats", request, read)).rejects.toMatchObject({
      statusCode: 403,
    });
    request.oauthAccessToken = { id: "fixture" } as any;
    await expect(service.read(action, resource, request, read)).rejects.toMatchObject({ statusCode: 403 });
    delete request.oauthAccessToken;
    env.security.iamAuthorizationMode = "invalid" as any;
    await expect(service.read(action, resource, request, read)).rejects.toMatchObject({ statusCode: 403 });
    env.security.iamAuthorizationMode = "enforce";
    delete request.authContext;
    await expect(service.read(action, resource, request, read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("declares fixed actions and deployment resources independent of headers and query filters", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/system/system.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    for (const [path, operation, resolver, permission] of [
      ["build-info", "GetBuildInfo", platformBuildInfoResource, Permission.DEBUG_ACCESS],
      ["stats", "GetStatistics", platformSystemStatisticsResource, Permission.SYSTEM_STATS_READ],
      [
        "consumption-stats",
        "GetConsumptionStatistics",
        platformConsumptionStatisticsResource,
        Permission.SYSTEM_CONSUMPTION_STATS_READ,
      ],
    ] as const) {
      expect(routes.find((r) => r.key === "GET /v1/system/" + path)).toMatchObject({
        coverage: "explicit",
        actions: ["quyan:system:" + operation],
        issues: [],
      });
      expect(await resolver({ principal, request })).toBe(platformSystemArn(path));
      expect(getIamActionDefinition("quyan:system:" + operation)).toMatchObject({
        authorizationBoundary: "platform",
        legacyPermission: permission,
        resourceTypes: ["platform/system"],
      });
    }
  });
});
