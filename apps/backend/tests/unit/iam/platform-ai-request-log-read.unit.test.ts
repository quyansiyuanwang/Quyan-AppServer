import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/platform-ai-request-log-read.repository", () => ({
  PlatformAiRequestLogReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { PlatformAiRequestLogReadIamService } from "@/services/relay/platform-ai-request-log-read-iam.service";
import { env } from "@/config/env";
import { Permission, getIamActionDefinition } from "@quyan/shared";
import { platformAiRequestLogResourceResolver } from "@/iam/request/platform-ai-request-log-resource-resolvers";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const action = "quyan:relay:ai_request_log:GetMetadata";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
let iam: any,
  snapshots: any,
  repo: any,
  permissions: any,
  service: PlatformAiRequestLogReadIamService,
  request: any,
  hydrate: any;
beforeEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  iam = { loadPolicies: vi.fn().mockResolvedValue([]), authorize: vi.fn().mockResolvedValue(allow) };
  snapshots = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] }),
    recheck: vi.fn().mockResolvedValue(undefined),
  };
  repo = { target: vi.fn().mockResolvedValue({ id: "log-1", status: 1, updateTime: new Date(0) }) };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) };
  service = new (PlatformAiRequestLogReadIamService as any)(iam, snapshots, repo, permissions);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { id: "log-1" },
    headers: { "x-action": "*" },
  };
  hydrate = vi.fn().mockResolvedValue("safe-result");
});
describe("single AI request log resources", () => {
  it("declares all five native actions and routes with independent diagnostics", () => {
    const p = new Project({ skipAddingFilesFromTsConfig: true });
    p.addSourceFileAtPath("src/api/controllers/v1/relay/ai-request-log.controller.ts");
    const routes = collectIamRoutes(p.getSourceFiles(), process.cwd());
    for (const [path, operation] of [
      ["{id}/metadata", "GetMetadata"],
      ["{id}/content", "GetContent"],
      ["{id}/search", "SearchContent"],
      ["{id}/attempts", "GetAttempts"],
      ["{id}", "GetLog"],
    ]) {
      const fixed = "quyan:relay:ai_request_log:" + operation;
      expect(getIamActionDefinition(fixed)).toMatchObject({
        accessLevel: "Read",
        sensitive: true,
        resourceTypes: ["platform/relay-ai-request-log"],
        authorizationBoundary: "platform",
      });
      expect(routes.find((r) => r.key === "GET /v1/relay/ai-request-logs/" + path)).toMatchObject({
        coverage: "explicit",
        actions: [fixed],
        issues: [],
      });
    }
  });
  it("resolves a fixed platform ARN and rejects wildcard or noncanonical IDs", async () => {
    expect(await platformAiRequestLogResourceResolver({ request, principal: {} } as any)).toBe(
      "acs:platform:*:platform:relay-ai-request-log/log-1",
    );
    for (const id of ["*", "a/b", "x\n", ""]) {
      request.params.id = id;
      expect(await platformAiRequestLogResourceResolver({ request, principal: {} } as any)).toBeUndefined();
    }
  });
  it("ignores forged Action headers and returns only after authorization and version rechecks", async () => {
    expect(await service.read(action, "log-1", request, hydrate)).toBe("safe-result");
    expect(
      iam.authorize.mock.calls.every(
        ([r]: any) => r.action === action && r.resource === "acs:platform:*:platform:relay-ai-request-log/log-1",
      ),
    ).toBe(true);
    expect(hydrate).toHaveBeenCalledOnce();
    expect(repo.target).toHaveBeenCalledTimes(3);
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("does not hydrate after %s", async (decision) => {
    iam.authorize.mockResolvedValue({ ...allow, decision });
    await expect(service.read(action, "log-1", request, hydrate)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.target).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("requires both platform and IAM diagnostic permission before attempts hydration", async () => {
    iam.authorize.mockImplementation(async (r: { action: string }) =>
      r.action.endsWith(":ReadDiagnostics") ? { ...allow, decision: "ImplicitDeny" } : allow,
    );
    await expect(
      service.read("quyan:relay:ai_request_log:GetAttempts", "log-1", request, hydrate),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(snapshots.snapshot).toHaveBeenCalledWith(expect.anything(), Permission.RELAY_REQUEST_DIAGNOSTICS_READ);
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("requires diagnostic permission only for the registered attempt-search variant", async () => {
    await service.read("quyan:relay:ai_request_log:SearchContent", "log-1", request, hydrate, true);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:relay:ai_request_log:ReadDiagnostics" }),
    );
    await expect(service.read(action, "log-1", request, hydrate, true)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects stale, missing or disabled metadata before reading a payload", async () => {
    for (const target of [
      null,
      { id: "other", status: 1, updateTime: new Date(0) },
      { id: "log-1", status: 0, updateTime: new Date(0) },
    ]) {
      repo.target.mockResolvedValue(target);
      await expect(service.read(action, "log-1", request, hydrate)).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("suppresses an already loaded response after revocation or target changes", async () => {
    hydrate.mockImplementation(async () => {
      repo.target.mockResolvedValue({ id: "log-1", status: 1, updateTime: new Date(1) });
      return "withheld";
    });
    await expect(service.read(action, "log-1", request, hydrate)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects OAuth, absent context and diagnostic-only action misuse", async () => {
    request.oauthAccessToken = {};
    await expect(service.read(action, "log-1", request, hydrate)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.read(action, "log-1", {} as any, hydrate)).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken = undefined;
    await expect(
      service.read("quyan:relay:ai_request_log:ReadDiagnostics" as any, "log-1", request, hydrate),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)(
    "preserves %s permission enforcement and a single payload read",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      iam.authorize.mockResolvedValue({ ...allow, decision: "ExplicitDeny" });
      expect(await service.read(action, "log-1", request, hydrate)).toBe("safe-result");
      expect(hydrate).toHaveBeenCalledOnce();
      permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
      await expect(service.read(action, "log-1", request, hydrate)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
});
