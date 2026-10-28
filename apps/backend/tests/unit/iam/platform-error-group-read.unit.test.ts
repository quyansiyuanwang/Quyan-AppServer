import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/platform-error-group-read.repository", () => ({
  PlatformErrorGroupReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/services/system/error-report.service", () => ({ ErrorReportService: { getInstance: vi.fn() } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import {
  PlatformErrorGroupReadIamService,
  type PlatformErrorGroupReadAction,
} from "@/services/system/platform-error-group-read-iam.service";
import { platformErrorGroupArn } from "@/iam/resources/platform-error-group-resources";
import { platformErrorGroupResourceResolver } from "@/iam/request/platform-error-group-resource-resolvers";
import { getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { env } from "@/config/env";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const get = "quyan:system:error_report:GetErrorGroup",
  list = "quyan:system:error_report:ListErrorOccurrences";
let service: PlatformErrorGroupReadIamService,
  iam: any,
  snapshots: any,
  repository: any,
  permissions: any,
  request: any;
const target = { id: "group-id", status: 1, updateTime: new Date(0) };
beforeEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorize: vi.fn().mockResolvedValue({ decision: "Allow", matchedStatements: [] }),
  };
  snapshots = { snapshot: vi.fn().mockResolvedValue({}), recheck: vi.fn().mockResolvedValue(undefined) };
  repository = { target: vi.fn().mockImplementation(async () => ({ ...target })) };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) };
  service = new (PlatformErrorGroupReadIamService as any)(iam, snapshots, repository, permissions);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    params: { id: target.id },
  };
});
describe("error report reads by resource", () => {
  it("declares independent sensitive actions on platform error groups", () => {
    for (const action of [get, list]) {
      expect(getIamActionDefinition(action)).toMatchObject({
        resourceTypes: ["platform/error-group"],
        sensitive: true,
        authorizationBoundary: "platform",
      });
      expect(isIamActionResourceCompatible(action, platformErrorGroupArn(target.id))).toBe(true);
      expect(isIamActionResourceCompatible(action, "acs:quyan:*:owner:user/actor")).toBe(false);
    }
    expect(getIamActionDefinition(list)?.accessLevel).toBe("List");
    expect(platformErrorGroupResourceResolver({ request, principal: {} as any })).toBe(
      platformErrorGroupArn(target.id),
    );
    request.params.id = "../forged";
    expect(platformErrorGroupResourceResolver({ request, principal: {} as any })).toBeUndefined();
  });
  it("declares server actions on both controller routes", () => {
    const p = new Project({ skipAddingFilesFromTsConfig: true });
    p.addSourceFileAtPath("src/api/controllers/v1/system/error-report.controller.ts");
    const routes = collectIamRoutes(p.getSourceFiles(), process.cwd());
    expect(routes.find((r) => r.key === "GET /v1/error-reports/{id}")).toMatchObject({
      actions: [get],
      coverage: "explicit",
      issues: [],
    });
    expect(routes.find((r) => r.key === "GET /v1/error-reports/{id}/occurrences")).toMatchObject({
      actions: [list],
      coverage: "explicit",
      issues: [],
    });
    expect(routes.filter((r) => r.key.includes("/client")).every((r) => r.coverage === "public")).toBe(true);
  });
  it.each([get, list] as const)("checks %s before hydration and again before response", async (action) => {
    const hydrate = vi.fn().mockResolvedValue("safe");
    expect(await service.read(action, target.id, request, hydrate)).toBe("safe");
    expect(hydrate).toHaveBeenCalledExactlyOnceWith(true);
    expect(iam.authorize).toHaveBeenCalledTimes(2);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action, resource: platformErrorGroupArn(target.id) }),
    );
    expect(request.iamDecisions.every((r: any) => r.action === action)).toBe(true);
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("withholds hydration on %s", async (decision) => {
    iam.authorize.mockResolvedValue({ decision, matchedStatements: [] });
    const hydrate = vi.fn();
    await expect(service.read(get, target.id, request, hydrate)).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
    expect(repository.target).not.toHaveBeenCalled();
  });
  it.each([null, { ...target, id: "wrong" }, { ...target, status: 0 }, { ...target, updateTime: new Date("invalid") }])(
    "fails on unavailable metadata %j",
    async (row) => {
      repository.target.mockResolvedValue(row);
      const hydrate = vi.fn();
      await expect(service.read(get, target.id, request, hydrate)).rejects.toMatchObject({ statusCode: 403 });
      expect(hydrate).not.toHaveBeenCalled();
    },
  );
  it.each(["policy", "group", "target"])("withholds hydrated data after %s revocation", async (kind) => {
    await expect(
      service.read(get, target.id, request, async () => {
        if (kind === "policy") iam.authorize.mockResolvedValue({ decision: "ExplicitDeny", matchedStatements: [] });
        if (kind === "group") snapshots.recheck.mockRejectedValue(new Error("fixture revoked"));
        if (kind === "target") repository.target.mockResolvedValue({ ...target, updateTime: new Date(1) });
        return "withheld";
      }),
    ).rejects.toThrow();
  });
  it.each(["legacy", "shadow"] as const)("preserves %s enforcement and a single legacy hydration", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny", matchedStatements: [] });
    const hydrate = vi.fn().mockResolvedValue("legacy");
    expect(await service.read(get, target.id, request, hydrate)).toBe("legacy");
    expect(hydrate).toHaveBeenCalledExactlyOnceWith(false);
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.read(get, target.id, request, hydrate)).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).toHaveBeenCalledTimes(1);
  });
  it.each(["missing", "oauth", "forged-principal", "id", "action", "mode"])("fails closed on %s", async (kind) => {
    let id = target.id,
      action: PlatformErrorGroupReadAction = get;
    if (kind === "missing") delete request.authContext;
    if (kind === "oauth") request.oauthAccessToken = {};
    if (kind === "forged-principal") request.authContext.principalUserId = "other";
    if (kind === "id") id = "../forged";
    if (kind === "action") action = "quyan:ram:CreateUser" as any;
    if (kind === "mode") env.security.iamAuthorizationMode = "invalid" as any;
    const hydrate = vi.fn();
    await expect(service.read(action, id, request, hydrate)).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
});
