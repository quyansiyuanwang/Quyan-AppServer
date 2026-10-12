import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/developer/platform-developer-instance-read.repository", () => ({
  PlatformDeveloperInstanceReadRepository: { getInstance: vi.fn() },
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
import { PlatformDeveloperInstanceReadIamService } from "@/services/developer/platform-developer-instance-read-iam.service";
import { platformDeveloperInstanceArn } from "@/iam/resources/platform-developer-instance-resources";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { ...allow, decision: "ExplicitDeny" };
const account = {
  id: "account",
  productCode: "kv",
  status: 1,
  accountOwnerId: "target-owner",
  createTime: new Date(0),
  updateTime: new Date(0),
  accountOwner: { id: "target-owner", status: 1, userType: "root", accountOwnerId: null, updateTime: new Date(0) },
};
const row = (id: string, index = 0) => ({
  id,
  status: 1,
  entitlementId: "account",
  backingProjectId: "project",
  backingProject: { id: "project", status: 1, userId: "target-owner", updateTime: new Date(0) },
  createTime: new Date(1000 - index),
  updateTime: new Date(0),
});
const display = (target: any) => ({ ...target, name: "fixture instance", slug: "fixture-instance", enabled: true });
let service: PlatformDeveloperInstanceReadIamService, iam: any, repo: any, identities: any, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  iam = {
    loadPolicies: vi.fn(),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }: any) => resources.map(() => allow)),
  };
  repo = {
    target: vi.fn().mockResolvedValue(account),
    recheckAccount: vi.fn(),
    scan: vi.fn().mockResolvedValue([row("b"), row("a")]),
    hydrate: vi.fn().mockImplementation(async (_p: unknown, _a: unknown, targets: any[]) => targets.map(display)),
    recheck: vi.fn().mockImplementation(async (_p: unknown, _a: unknown, targets: any[]) => targets),
  };
  identities = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] }),
    recheck: vi.fn(),
  };
  service = new (PlatformDeveloperInstanceReadIamService as unknown as new (
    ...args: any[]
  ) => PlatformDeveloperInstanceReadIamService)(iam, repo, identities);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
  } as unknown as TypedRequest;
});
describe("platform product instance read authorization", () => {
  it("hydrates only allowed instances using a fixed server action", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((resource: string) => (resource === platformDeveloperInstanceArn("b") ? deny : allow)),
    );
    expect(await service.list(request, "kv", { accountId: "account" })).toEqual([
      expect.objectContaining({ id: "a", name: "fixture instance" }),
    ]);
    expect(repo.hydrate.mock.calls[0][2].map((t: any) => t.id)).toEqual(["a"]);
    expect(
      iam.authorizeMany.mock.calls.every((c: any) => c[0].action === "quyan:developer:ListProductAccountInstances"),
    ).toBe(true);
  });
  it("resolves user paths to the same trusted product account", async () => {
    expect(await service.list(request, "kv", { userId: "target-owner" })).toHaveLength(2);
    await expect(service.list(request, "kv", { userId: "other" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list(request, "push", { accountId: "account" })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects OAuth, missing identity and ambiguous resource locators", async () => {
    await expect(service.list({} as TypedRequest, "kv", { accountId: "account" })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      service.list({ ...request, oauthAccessToken: {} } as TypedRequest, "kv", { accountId: "account" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.list(request, "kv", { accountId: "account", userId: "target-owner" } as any),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.scan).not.toHaveBeenCalled();
  });
  it("rejects unordered, duplicate or rebound instance metadata", async () => {
    for (const batch of [[row("a"), row("b")], [row("a"), row("a")], [{ ...row("a"), entitlementId: "other" }]]) {
      repo.scan.mockResolvedValue(batch);
      await expect(service.list(request, "kv", { accountId: "account" })).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("continues scanning denied rows and retains every authorized instance", async () => {
    const rows = Array.from({ length: 750 }, (_, i) => row("row-" + String(i).padStart(4, "0"), i));
    repo.scan.mockResolvedValueOnce(rows.slice(0, 500)).mockResolvedValueOnce(rows.slice(500));
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((r: string) => (Number(r.slice(-4)) < 500 ? deny : allow)),
    );
    const result = await service.list(request, "kv", { accountId: "account" });
    expect(result).toHaveLength(250);
    expect(result![0].id).toBe("row-0500");
    expect(result![249].id).toBe("row-0749");
    expect(repo.scan).toHaveBeenLastCalledWith(expect.anything(), account, expect.objectContaining({ id: "row-0499" }));
  });
  it("fails closed on incomplete decisions and stale hydrated rows", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.list(request, "kv", { accountId: "account" })).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockImplementation(async ({ resources }: any) => resources.map(() => allow));
    repo.hydrate.mockResolvedValue([display(row("a")), display(row("a"))]);
    await expect(service.list(request, "kv", { accountId: "account" })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("only returns safe instance fields", async () => {
    repo.hydrate.mockImplementation(async (_p: unknown, _a: unknown, targets: any[]) =>
      targets.map((t: any) => ({ ...display(t), details: { token: "fixture-only" } })),
    );
    expect(JSON.stringify(await service.list(request, "kv", { accountId: "account" }))).not.toContain("fixture-only");
  });
  it("withholds results if an entry is removed or its final decision is revoked", async () => {
    repo.recheck.mockResolvedValue([]);
    await expect(service.list(request, "kv", { accountId: "account" })).rejects.toMatchObject({ statusCode: 403 });
    repo.recheck.mockImplementation(async (_p: unknown, _a: unknown, targets: any[]) => targets);
    let evaluations = 0;
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map(() => (++evaluations > 4 ? deny : allow)),
    );
    await expect(service.list(request, "kv", { accountId: "account" })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a stale backing project or another project owner", async () => {
    repo.scan.mockResolvedValue([{ ...row("a"), backingProject: { ...row("a").backingProject, userId: "other" } }]);
    await expect(service.list(request, "kv", { accountId: "account" })).rejects.toMatchObject({ statusCode: 403 });
    repo.scan.mockResolvedValue([row("a")]);
    repo.hydrate.mockResolvedValue([
      { ...display(row("a")), backingProject: { ...row("a").backingProject, updateTime: new Date(1000) } },
    ]);
    await expect(service.list(request, "kv", { accountId: "account" })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow evaluates without reading charges or caller identities", async () => {
    expect(await service.list(request, "kv", { accountId: "account" }, false)).toBeUndefined();
    expect(repo.hydrate).not.toHaveBeenCalled();
    expect(identities.recheck).toHaveBeenCalled();
  });
  it("declares per-record collection authorization on the instance endpoint", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/developer/developer-product-admin.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const method of ["listManagedInstances"])
      expect(routes.find((r) => r.method === method)).toMatchObject({
        coverage: "explicit",
        actions: ["quyan:developer:ListProductAccountInstances"],
        resourceKind: "collection",
        issues: [],
      });
  });
});
