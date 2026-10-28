import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/developer/platform-developer-account-read.repository", () => ({
  PlatformDeveloperAccountReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture deny", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { PlatformDeveloperAccountReadIamService } from "@/services/developer/platform-developer-account-read-iam.service";
import { platformDeveloperAccountArn } from "@/iam/resources/platform-developer-account-resources";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { ...allow, decision: "ExplicitDeny" };
const target = (id: string) => ({
  id,
  status: 1,
  accountOwnerId: "target-owner",
  accountOwner: { id: "target-owner", status: 1, userType: "root", accountOwnerId: null, updateTime: new Date(0) },
  productCode: "kv",
  createTime: new Date(0),
  updateTime: new Date(0),
});
let service: PlatformDeveloperAccountReadIamService, iam: any, repo: any, identities: any, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  iam = {
    loadPolicies: vi.fn(),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }) => resources.map(() => allow)),
  };
  repo = {
    scan: vi.fn().mockResolvedValue([target("a"), target("b")]),
    target: vi.fn().mockResolvedValue(target("a")),
    hydrate: vi
      .fn()
      .mockImplementation(async (_p, targets) =>
        targets.map((t: any) => ({ ...t, enabled: true, defaultDailyQuota: 100 })),
      ),
    recheck: vi.fn().mockImplementation(async (_p, targets) => targets),
  };
  identities = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] }),
    recheck: vi.fn(),
  };
  service = new (PlatformDeveloperAccountReadIamService as unknown as new (
    ...args: any[]
  ) => PlatformDeveloperAccountReadIamService)(iam, repo, identities);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { model: "provider/a" },
    headers: { "x-action": "*" },
  } as unknown as TypedRequest;
});
describe("platform developer product account read", () => {
  it("authorizes each actual ID and only hydrates visible account data", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((resource: string) => (resource === platformDeveloperAccountArn("b") ? deny : allow)),
    );
    const result = await service.list(request, (rows) => rows.map((r) => r.id));
    expect(result).toEqual(["a"]);
    expect(repo.hydrate.mock.calls.flatMap((call: any) => call[1].map((t: any) => t.id))).toEqual(["a"]);
    expect(iam.authorizeMany.mock.calls.every((c: any) => c[0].action === "quyan:developer:ListProductAccounts")).toBe(
      true,
    );
  });
  it("requires a principal and rejects OAuth or impersonation", async () => {
    for (const req of [
      {},
      { ...request, oauthAccessToken: {} },
      { ...request, authContext: { principalUserId: "other", accountOwnerId: "owner" } },
    ])
      await expect(service.list(req as TypedRequest, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.scan).not.toHaveBeenCalled();
  });
  it("rejects incomplete decisions and duplicate hydrated records", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockImplementation(async ({ resources }: any) => resources.map(() => allow));
    repo.hydrate.mockResolvedValue([target("a"), target("a")]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds account data if a decision is revoked after projection", async () => {
    await expect(
      service.list(request, (rows) => {
        iam.authorizeMany.mockImplementation(async ({ resources }: any) => resources.map(() => deny));
        return rows;
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds changed or removed records after hydration", async () => {
    repo.recheck.mockResolvedValue([target("a")]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
    repo.recheck.mockResolvedValue([{ ...target("a"), productCode: "push" }, target("b")]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("evaluates more than one batch and orders product accounts by update time", async () => {
    const targets = Array.from({ length: 501 }, (_, i) => target("id-" + String(i).padStart(4, "0")));
    repo.scan.mockResolvedValueOnce(targets.slice(0, 500)).mockResolvedValueOnce(targets.slice(500));
    const result = await service.list(request, (rows) => rows.map((r) => r.id));
    expect(result).toHaveLength(501);
    expect(result![0]).toBe("id-0000");
    expect(result![500]).toBe("id-0500");
  });
  it("rejects unordered scan results rather than silently skipping resources", async () => {
    repo.scan.mockResolvedValue([target("b"), target("a")]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow scans and evaluates without hydrating or projecting the export", async () => {
    const project = vi.fn();
    await service.list(request, project, false);
    expect(repo.hydrate).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
    expect(identities.recheck).toHaveBeenCalled();
  });
  it("rejects unknown product codes before loading account details", async () => {
    repo.scan.mockResolvedValue([{ ...target("a"), productCode: "unknown" }]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("declares a fixed server list action on the product account routes", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/developer/developer-product-admin.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(routes.find((r) => r.method === "listAccounts")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:developer:ListProductAccounts"],
      issues: [],
      security: ["jwt"],
    });
    expect(routes.find((r) => r.method === "listProductAccounts")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:developer:ListProductAccounts"],
      issues: [],
    });
  });
  it("pushes product filtering to the repository and rejects mismatched rows", async () => {
    await service.list(request, (rows) => rows, true, "kv");
    expect(repo.scan).toHaveBeenCalledWith(expect.anything(), undefined, "kv");
    repo.scan.mockResolvedValue([{ ...target("a"), productCode: "push" }]);
    await expect(service.list(request, (rows) => rows, true, "kv")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects rebound or stale primary account snapshots", async () => {
    repo.hydrate.mockResolvedValue([
      { ...target("a"), accountOwner: { ...target("a").accountOwner, updateTime: new Date(1000) } },
      target("b"),
    ]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
    repo.scan.mockResolvedValue([{ ...target("a"), accountOwnerId: "other" }]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
  });
});
