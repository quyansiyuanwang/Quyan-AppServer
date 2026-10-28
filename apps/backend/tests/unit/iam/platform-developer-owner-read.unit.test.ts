import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/developer/platform-developer-owner-read.repository", () => ({
  PlatformDeveloperOwnerReadRepository: { getInstance: vi.fn() },
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
import { PlatformDeveloperOwnerReadIamService } from "@/services/developer/platform-developer-owner-read-iam.service";
import {
  platformDeveloperAccountArn,
  platformDeveloperAccountScopeArn,
} from "@/iam/resources/platform-developer-account-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { ...allow, decision: "ExplicitDeny" };
const target = (id: string, index = 0, provisioned = true) => ({
  id,
  status: 1,
  userType: "root",
  accountOwnerId: null,
  createTime: new Date(100000 - index),
  updateTime: new Date(0),
  account: provisioned
    ? { id: "account-" + id, status: 1, productCode: "kv", accountOwnerId: id, updateTime: new Date(0) }
    : null,
});
const project = (rows: any[], total: number, page: number, pageSize: number) => ({
  records: rows.map((r) => r.id),
  total,
  page,
  pageSize,
});
let service: PlatformDeveloperOwnerReadIamService, iam: any, repo: any, identities: any, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  iam = {
    loadPolicies: vi.fn(),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }: any) => resources.map(() => allow)),
  };
  repo = {
    scan: vi.fn().mockResolvedValue([target("c"), target("b"), target("a", 0, false)]),
    hydrate: vi
      .fn()
      .mockImplementation(async (_p: unknown, _product: unknown, targets: any[]) =>
        targets.map((t) => ({ ...t, username: "fixture", displayName: null, accountRow: null })),
      ),
    recheck: vi.fn().mockImplementation(async (_p: unknown, _product: unknown, targets: any[]) => targets),
  };
  identities = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] }),
    recheck: vi.fn(),
  };
  service = new (PlatformDeveloperOwnerReadIamService as unknown as new (
    ...args: any[]
  ) => PlatformDeveloperOwnerReadIamService)(iam, repo, identities);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
  } as unknown as TypedRequest;
});
describe("platform primary-account directory authorization", () => {
  it("filters owner scopes and actual records before counting and pagination", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((resource: string) => (resource === platformDeveloperAccountArn("account-c") ? deny : allow)),
    );
    expect(await service.list(request, "kv", { page: 2, pageSize: 1 }, project)).toEqual({
      records: ["a"],
      total: 2,
      page: 2,
      pageSize: 1,
    });
    expect(repo.hydrate.mock.calls[0][2].map((t: any) => t.id)).toEqual(["a"]);
    expect(iam.authorizeMany.mock.calls[0][0].resources).toContain(platformDeveloperAccountScopeArn("a", "kv"));
    expect(
      iam.authorizeMany.mock.calls.every((c: any) => c[0].action === "quyan:developer:ListProductAccountOwners"),
    ).toBe(true);
  });
  it("withholds identities when the scope is denied even if their product record is allowed", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((resource: string) => (resource.includes("account-scope/c/") ? deny : allow)),
    );
    expect(await service.list(request, "kv", {}, project)).toMatchObject({ records: ["b", "a"], total: 2 });
  });
  it("returns an empty page and authorized total for pages beyond the result set", async () => {
    expect(await service.list(request, "kv", { page: 10, pageSize: 1 }, project)).toEqual({
      records: [],
      total: 3,
      page: 10,
      pageSize: 1,
    });
  });
  it("rechecks authorizations outside the returned page to protect total counts", async () => {
    const projection = vi.fn().mockImplementation((...args: any[]) => {
      iam.authorizeMany.mockImplementation(async ({ resources }: any) => resources.map(() => deny));
      return project(...(args as [any[], number, number, number]));
    });
    await expect(service.list(request, "kv", { page: 1, pageSize: 1 }, projection)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rejects stale ownership or newly inserted product records before returning counts", async () => {
    repo.recheck.mockResolvedValue([target("c"), target("b"), target("a")]);
    await expect(service.list(request, "kv", { page: 1, pageSize: 1 }, project)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rejects invalid query limits and unknown products before loading identities", async () => {
    for (const query of [
      { page: 0 },
      { pageSize: 101 },
      { page: 1.5 },
      { keyword: "x".repeat(201) },
      { accountOwnerId: "other" },
    ])
      await expect(service.list(request, "kv", query as any, project)).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.list(request, "unknown" as any, {}, project)).rejects.toMatchObject({ statusCode: 400 });
    expect(repo.scan).not.toHaveBeenCalled();
  });
  it("normalizes keyword input for the repository", async () => {
    await service.list(request, "kv", { keyword: "  fixture  " }, project);
    expect(repo.scan).toHaveBeenCalledWith(expect.anything(), "kv", "fixture", undefined);
  });
  it("rejects OAuth and mismatched trusted principals", async () => {
    for (const req of [
      {},
      { ...request, oauthAccessToken: {} },
      { ...request, authContext: { principalUserId: "other", accountOwnerId: "owner" } },
    ])
      await expect(service.list(req as TypedRequest, "kv", {}, project)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.scan).not.toHaveBeenCalled();
  });
  it("keeps every authorization batch within budget for provisioned owners", async () => {
    const rows = Array.from({ length: 501 }, (_, i) => target("owner-" + String(i).padStart(4, "0"), i));
    repo.scan.mockResolvedValueOnce(rows.slice(0, 500)).mockResolvedValueOnce(rows.slice(500));
    expect(await service.list(request, "kv", { page: 1, pageSize: 100 }, project)).toMatchObject({ total: 501 });
    expect(
      iam.authorizeMany.mock.calls.every(
        (c: any) => c[0].resources.length <= IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      ),
    ).toBe(true);
  });
  it("rejects unordered scans, rebound records and incomplete decisions", async () => {
    repo.scan.mockResolvedValue([target("a"), target("b")]);
    await expect(service.list(request, "kv", {}, project)).rejects.toMatchObject({ statusCode: 403 });
    repo.scan.mockResolvedValue([{ ...target("c"), account: { ...target("c").account!, accountOwnerId: "other" } }]);
    await expect(service.list(request, "kv", {}, project)).rejects.toMatchObject({ statusCode: 403 });
    repo.scan.mockResolvedValue([target("c")]);
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.list(request, "kv", {}, project)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow does not load usernames, display names or quotas", async () => {
    expect(await service.list(request, "kv", {}, project, false)).toBeUndefined();
    expect(repo.hydrate).not.toHaveBeenCalled();
    expect(identities.recheck).toHaveBeenCalled();
  });
  it("declares every product administration route with explicit IAM metadata", () => {
    const ast = new Project({ skipAddingFilesFromTsConfig: true });
    ast.addSourceFileAtPath("src/api/controllers/v1/developer/developer-product-admin.controller.ts");
    const routes = collectIamRoutes(ast.getSourceFiles(), process.cwd());
    expect(routes).toHaveLength(11);
    expect(routes.every((r) => r.coverage === "explicit" && r.issues.length === 0)).toBe(true);
    expect(routes.find((r) => r.method === "listManagedAccounts")).toMatchObject({
      actions: ["quyan:developer:ListProductAccountOwners"],
      resourceKind: "collection",
    });
  });
});
