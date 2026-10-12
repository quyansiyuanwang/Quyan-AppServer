import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-maintenance-run.repository", () => ({
  PlatformMaintenanceRunRepository: { getInstance: vi.fn() },
}));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture unavailable", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { env } from "@/config/env";
import { getIamActionDefinition } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { platformMaintenanceRunResourceResolver } from "@/iam/request/platform-maintenance-resource-resolvers";
import { PlatformMaintenanceRunIamService } from "@/services/system/platform-maintenance-run-iam.service";
import type { TypedRequest } from "@/types/express";
vi.mock("@/store/system/observability.repository", () => ({ DATA_MAINTENANCE_DATASETS: ["api_logs"] }));
const target = (id = "client") => ({
    id,
    status: 1,
    operation: "optimize",
    runStatus: "completed",
    createTime: new Date(0),
    updateTime: new Date(0),
  }),
  allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { ...allow, decision: "ExplicitDeny" };
let service: PlatformMaintenanceRunIamService, iam: any, repo: any, request: TypedRequest;
beforeEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorize: vi.fn().mockResolvedValue(allow),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }: any) => resources.map(() => allow)),
  };
  repo = {
    assertActor: vi.fn().mockResolvedValue(undefined),
    scan: vi.fn().mockResolvedValue([target()]),
    target: vi.fn().mockResolvedValue(target()),
    hydrate: vi
      .fn()
      .mockImplementation(async (_: any, targets: any[]) => targets.map((t) => ({ ...t, hasClientSecret: true }))),
    recheck: vi.fn().mockImplementation(async (_: any, targets: any[]) => targets),
  };
  service = new (PlatformMaintenanceRunIamService as unknown as new (
    ...args: any[]
  ) => PlatformMaintenanceRunIamService)(iam, repo);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "actor" },
    headers: { "x-action": "*" },
  } as unknown as TypedRequest;
});
describe("platform maintenance run reads", () => {
  it("declares separate registered platform actions and a trusted run resolver", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/system/data-maintenance.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [path, operation] of [
      ["runs", "ListRuns"],
      ["runs/{runId}", "GetRun"],
    ]) {
      const action = "quyan:system:data_maintenance:" + operation;
      expect(getIamActionDefinition(action)).toMatchObject({
        resourceTypes: ["platform/maintenance-run"],
        authorizationBoundary: "platform",
      });
      expect(routes.find((r) => r.key === "GET /v1/data-maintenance/" + path)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
    }
    request.params = { runId: "client" };
    request.body = { accountId: "foreign" };
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    expect(await platformMaintenanceRunResourceResolver({ request, principal })).toBe(
      "acs:platform:*:platform:maintenance-run/client",
    );
    request.params.runId = "../client";
    expect(await platformMaintenanceRunResourceResolver({ request, principal })).toBeUndefined();
  });

  it("authorizes detail separately and rejects detail Deny before loading fields", async () => {
    expect(await service.get("client", request)).toMatchObject({ id: "client" });
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:system:data_maintenance:GetRun",
        resource: "acs:platform:*:platform:maintenance-run/client",
      }),
    );
    repo.hydrate.mockClear();
    iam.authorize.mockResolvedValue(deny);
    await expect(service.get("client", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("rejects missing, malformed, changed or unrelated detail targets", async () => {
    for (const id of ["../client", "*", "client/other", ""])
      await expect(service.get(id, request)).rejects.toMatchObject({ statusCode: 403 });
    repo.target.mockResolvedValue(null);
    await expect(service.get("client", request)).rejects.toMatchObject({ statusCode: 403 });
    repo.target.mockResolvedValue(target());
    repo.hydrate.mockResolvedValue([{ ...target(), updateTime: new Date(1) }]);
    await expect(service.get("client", request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks detail permission and version after loading fields", async () => {
    repo.hydrate.mockImplementation(async (_: any, rows: any[]) => {
      iam.authorize.mockResolvedValue(deny);
      return rows;
    });
    await expect(service.get("client", request)).rejects.toMatchObject({ statusCode: 403 });
    iam.authorize.mockResolvedValue(allow);
    repo.hydrate.mockImplementation(async (_: any, rows: any[]) => rows);
    repo.recheck.mockResolvedValue([{ ...target(), updateTime: new Date(1) }]);
    await expect(service.get("client", request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps detail shadow evaluation on metadata", async () => {
    await service.get("client", request, false);
    expect(repo.hydrate).not.toHaveBeenCalled();
  });

  it("uses review resources and passes server-normalized filters", async () => {
    const result = await service.list({ operation: "optimize" }, request);
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:system:data_maintenance:ListRuns",
        resources: ["acs:platform:*:platform:maintenance-run/client"],
      }),
    );
    expect(repo.scan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operation: "optimize" }),
      undefined,
    );
  });
  it("filters Deny before pagination, hydration and authorized counts", async () => {
    repo.scan.mockResolvedValue([target("a"), target("b"), target("c")]);
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((r: string) => (r.endsWith("/b") ? deny : allow)),
    );
    const result = await service.list({ pageSize: 1 }, request);
    expect(result.total).toBe(2);
    expect(result.items.map((r) => r.id)).toEqual(["c"]);
    expect(repo.hydrate).toHaveBeenCalledWith(expect.anything(), [target("c")]);
  });
  it("fails closed if grants or versions change after loading display fields", async () => {
    repo.hydrate.mockImplementation(async (_: any, targets: any[]) => {
      iam.authorizeMany.mockResolvedValue([deny]);
      return targets;
    });
    await expect(service.list({}, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects disabled apps, invalid cursor order and unrelated hydration", async () => {
    for (const batch of [[{ ...target(), status: 0 }], [target("b"), target("a")]]) {
      repo.scan.mockResolvedValue(batch);
      await expect(service.list({}, request)).rejects.toMatchObject({ statusCode: 403 });
    }
    repo.scan.mockResolvedValue([target()]);
    repo.hydrate.mockResolvedValue([target("foreign")]);
    await expect(service.list({}, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects invalid query, OAuth tokens and missing identities", async () => {
    await expect(service.list({ pageSize: 201 }, request)).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.list({})).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken = { id: "token" } as any;
    await expect(service.list({}, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects unknown query fields before reading applications", async () => {
    await expect(service.list({ action: "*" } as any, request)).rejects.toMatchObject({ statusCode: 400 });
    expect(repo.scan).not.toHaveBeenCalled();
  });
  it("rejects unavailable policy data and incomplete decisions", async () => {
    iam.loadPolicies.mockRejectedValueOnce(new Error("fixture storage unavailable"));
    await expect(service.list({}, request)).rejects.toThrow();
    expect(repo.scan).not.toHaveBeenCalled();
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.list({}, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a revoked actor after hydration even when the list is empty", async () => {
    repo.scan.mockResolvedValue([]);
    repo.assertActor.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("fixture revoked"));
    await expect(service.list({}, request)).rejects.toThrow();
  });
  it("rechecks resources contributing to total even if they are outside the current page", async () => {
    repo.scan.mockResolvedValue([target("a"), target("b")]);
    repo.hydrate.mockImplementation(async (_: any, targets: any[]) => {
      repo.recheck.mockImplementation(async (_: any, latest: any[]) => latest.filter((t) => t.id !== "a"));
      return targets;
    });
    await expect(service.list({ pageSize: 1 }, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects duplicate display rows or duplicate version rechecks", async () => {
    repo.scan.mockResolvedValue([target("a"), target("b")]);
    repo.hydrate.mockResolvedValue([target("a"), target("a")]);
    await expect(service.list({}, request)).rejects.toMatchObject({ statusCode: 403 });
    repo.hydrate.mockImplementation(async (_: any, rows: any[]) => rows);
    repo.recheck.mockResolvedValue([target("a"), target("a")]);
    await expect(service.list({}, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("runs shadow diagnostics without fetching display data", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await service.diagnose({}, request);
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
});
